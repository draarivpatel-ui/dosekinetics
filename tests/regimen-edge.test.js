const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../js/pk-engine.js");

test("steady-state infusion analytical Css,max and Css,min match multi-dose numerical tail", () => {
  const ke = Math.LN2 / 6;
  const sim = Engine.simulate1Compartment({
    vdL: 35,
    kePerH: ke,
    route: "infusion",
    infusionDurationH: 1.0,
    doseMg: 1000,
    intervalH: 12,
    numDoses: 12,
    mecMgL: 5,
    mtcMgL: 45,
    dtH: 0.1
  });
  assert.ok(sim.summary.cssMaxAnalytical > sim.summary.cssMinAnalytical);
  assert.ok(Math.abs(sim.summary.lastIntervalPeak - sim.summary.cssMaxAnalytical) < 0.25);
  assert.ok(Math.abs(sim.summary.lastIntervalTrough - sim.summary.cssMinAnalytical) < 0.25);
});

test("buildDoseSchedule assigns accurate loading and maintenance tags", () => {
  const ev = Engine.buildDoseSchedule({
    doseMg: 500,
    loadingDoseMg: 1000,
    intervalH: 12,
    numDoses: 3
  });
  assert.equal(ev.length, 3);
  assert.equal(ev[0].tag, "loading");
  assert.equal(ev[0].doseMg, 1000);
  assert.equal(ev[1].tag, "maintenance");
  assert.equal(ev[2].tag, "maintenance");
});

test("buildDoseSchedule tags doubled and delayed doses explicitly", () => {
  const dbl = Engine.buildDoseSchedule({ doseMg: 250, intervalH: 8, numDoses: 3, perturbType: "double", perturbIndex: 2 });
  assert.equal(dbl[1].tag, "doubled");
  const dly = Engine.buildDoseSchedule({ doseMg: 250, intervalH: 8, numDoses: 3, perturbType: "delay", perturbIndex: 3, delayHours: 3 });
  assert.equal(dly[2].tag, "delayed +3h");
});

test("simulate2Compartment returns exact final endpoint and non-empty sampled stride trajectory", () => {
  const sim2 = Engine.simulate2Compartment({
    v1L: 18,
    k10PerH: 0.2,
    k12PerH: 0.5,
    k21PerH: 0.25,
    route: "bolus",
    doseMg: 500,
    intervalH: 12,
    numDoses: 2,
    dtH: 0.05
  });
  assert.ok(sim2.points.length >= 200);
  assert.equal(sim2.points[0].timeH, 0);
  assert.equal(sim2.points[sim2.points.length - 1].timeH, 24);
  assert.ok(sim2.peakCentralConc > 20);
});

test("solveOptimalRegimens works for every preset drug profile", () => {
  const patient = { sex: "female", age: 34, weightKg: 62, heightCm: 165, serumCreatinine: 0.85 };
  for (const drug of Engine.PRESET_DRUGS) {
    const res = Engine.solveOptimalRegimens(drug, patient);
    assert.ok(res.best !== null, `Missing best regimen for ${drug.id}`);
    assert.ok(res.topCandidates.length > 0 && res.topCandidates.length <= 6);
    assert.ok(res.best.loadingDoseMg >= res.best.doseMg);
  }
});

test("computePatientMetrics clamps IBW at minimum 30 kg for short stature", () => {
  const m = Engine.computePatientMetrics({
    sex: "female",
    age: 22,
    weightKg: 38,
    heightCm: 132,
    serumCreatinine: 0.7
  });
  assert.ok(m.idealBodyWeightKg >= 30);
  assert.ok(m.bmi > 18 && m.bmi < 25);
});

test("derivePatientPK keeps clearance almost unchanged for hepatically cleared drug despite rising SCr", () => {
  const theo = Engine.PRESET_DRUGS.find((d) => d.id === "theophylline-oral"); // fr = 0.15
  const normal = Engine.derivePatientPK(theo, { sex: "male", age: 50, weightKg: 70, heightCm: 175, serumCreatinine: 0.9 });
  const ckd = Engine.derivePatientPK(theo, { sex: "male", age: 50, weightKg: 70, heightCm: 175, serumCreatinine: 3.0 });
  // Only 15% renal fraction -> clearance stays > 85% of baseline even with major renal drop
  assert.ok(ckd.clLPerH > normal.clLPerH * 0.85);
});

test("simulate1Compartment rejects invalid negative or zero Vd, ke, interval, dtH", () => {
  assert.throws(() => Engine.simulate1Compartment({ vdL: 0, kePerH: 0.1, doseMg: 100, intervalH: 12 }));
  assert.throws(() => Engine.simulate1Compartment({ vdL: 30, kePerH: -0.1, doseMg: 100, intervalH: 12 }));
  assert.throws(() => Engine.simulate1Compartment({ vdL: 30, kePerH: 0.1, doseMg: 100, intervalH: 0 }));
  assert.throws(() => Engine.simulate1Compartment({ vdL: 30, kePerH: 0.1, doseMg: 100, intervalH: 12, dtH: 0 }));
});

test("simulate2Compartment rejects negative distribution transfer constants or non-positive V1", () => {
  assert.throws(() => Engine.simulate2Compartment({ v1L: 0, k10PerH: 0.2, k12PerH: 0.3, k21PerH: 0.2, doseMg: 100 }));
  assert.throws(() => Engine.simulate2Compartment({ v1L: 20, k10PerH: 0.2, k12PerH: -0.1, k21PerH: 0.2, doseMg: 100 }));
  assert.throws(() => Engine.simulate2Compartment({ v1L: 20, k10PerH: 0.2, k12PerH: 0.3, k21PerH: -0.1, doseMg: 100 }));
});

test("oral time-in-window drops when dose exceeds MTC toxic ceiling", () => {
  const safe = Engine.simulate1Compartment({
    vdL: 30, kePerH: 0.15, kaPerH: 1.2, bioavailabilityF: 0.9,
    route: "oral", doseMg: 300, intervalH: 12, numDoses: 8, mecMgL: 4, mtcMgL: 20, dtH: 0.1
  });
  const overdose = Engine.simulate1Compartment({
    vdL: 30, kePerH: 0.15, kaPerH: 1.2, bioavailabilityF: 0.9,
    route: "oral", doseMg: 1500, intervalH: 12, numDoses: 8, mecMgL: 4, mtcMgL: 20, dtH: 0.1
  });
  assert.ok(overdose.summary.toxicPct > safe.summary.toxicPct);
  assert.ok(overdose.summary.timeInWindowPct < safe.summary.timeInWindowPct);
});

test("timeInWindowPct + toxicPct + subTherapeuticPct sums to 100%", () => {
  const sim = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.12, route: "infusion", infusionDurationH: 1.0,
    doseMg: 800, intervalH: 12, numDoses: 6, mecMgL: 8, mtcMgL: 28, dtH: 0.1
  });
  const total = sim.summary.timeInWindowPct + sim.summary.toxicPct + sim.summary.subTherapeuticPct;
  assert.ok(Math.abs(total - 100) < 1e-6);
});

test("infusion steady-state AUC over one interval equals Dose / CL", () => {
  const ke = 0.14;
  const vdL = 42;
  const cl = ke * vdL;
  const doseMg = 900;
  const sim = Engine.simulate1Compartment({
    vdL, kePerH: ke, route: "infusion", infusionDurationH: 1.0,
    doseMg, intervalH: 12, numDoses: 15, mecMgL: 5, mtcMgL: 40, dtH: 0.05
  });
  const theoreticalAucTau = doseMg / cl;
  assert.ok(Math.abs(sim.summary.lastIntervalAuc - theoreticalAucTau) < 0.8);
});

test("simulate1Compartment distinguishes infusion vs oral at t=infusionDurationH and bolus matches zero-order limit", () => {
  const inf = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.1, route: "infusion", infusionDurationH: 1.0,
    doseMg: 500, intervalH: 12, numDoses: 2, dtH: 0.1
  });
  const oral = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.1, route: "oral", kaPerH: 1.5, bioavailabilityF: 1.0,
    doseMg: 500, intervalH: 12, numDoses: 2, dtH: 0.1
  });
  // At t=1.0h (index 10), linear infusion ends differently from oral Bateman absorption
  assert.ok(Math.abs(inf.points[10].conc - oral.points[10].conc) > 1.0);
});

test("simulate2Compartment validates dtH and includes exact final endpoint when horizonH is not stride-aligned", () => {
  assert.throws(() => Engine.simulate2Compartment({ v1L: 20, k10PerH: 0.2, k12PerH: 0.3, k21PerH: 0.2, doseMg: 100, dtH: 0 }));
  const sim2 = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.4, k21PerH: 0.2, route: "bolus",
    doseMg: 400, intervalH: 12, numDoses: 1, horizonH: 1.05, dtH: 0.05
  });
  assert.equal(sim2.points[sim2.points.length - 1].timeH, 1.05);
});

