const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../js/pk-engine.js");

test("PRESET_DRUGS includes 5 complete literature-range fixtures", () => {
  assert.equal(Engine.PRESET_DRUGS.length, 5);
  for (const d of Engine.PRESET_DRUGS) {
    assert.ok(d.id && d.name);
    assert.ok(d.vdLPerKg > 0 && d.clRefLPerH > 0);
    assert.ok(d.mecMgL < d.mtcMgL);
  }
});

test("computePatientMetrics computes Devine IBW and Cockcroft-Gault CrCl for male non-obese patient", () => {
  const m = Engine.computePatientMetrics({
    sex: "male",
    age: 48,
    weightKg: 76,
    heightCm: 175,
    serumCreatinine: 1.0
  });
  // 175 cm = 68.8976 in; IBW = 50 + 2.3*(8.8976) = 70.46 kg
  assert.ok(Math.abs(m.idealBodyWeightKg - 70.4646) < 0.05);
  assert.equal(m.dosingWeightKg, m.idealBodyWeightKg);
  const expectedCrCl = ((140 - 48) * m.dosingWeightKg) / 72;
  assert.ok(Math.abs(m.crClMlMin - expectedCrCl) < 1e-6);
});

test("computePatientMetrics applies 0.85 factor for female and ABW when below IBW", () => {
  const m = Engine.computePatientMetrics({
    sex: "female",
    age: 60,
    weightKg: 48,
    heightCm: 170,
    serumCreatinine: 1.2
  });
  assert.equal(m.dosingWeightKg, 48);
  assert.ok(m.weightBasis.includes("Actual"));
  const expectedCrCl = ((140 - 60) * 48 * 0.85) / (72 * 1.2);
  assert.ok(Math.abs(m.crClMlMin - expectedCrCl) < 1e-6);
});

test("computePatientMetrics uses Adjusted Body Weight when ABW > 1.25 * IBW", () => {
  const m = Engine.computePatientMetrics({
    sex: "male",
    age: 50,
    weightKg: 120,
    heightCm: 170,
    serumCreatinine: 1.0
  });
  const expectedAdj = m.idealBodyWeightKg + 0.4 * (120 - m.idealBodyWeightKg);
  assert.ok(Math.abs(m.dosingWeightKg - expectedAdj) < 1e-6);
  assert.ok(m.weightBasis.includes("Adjusted"));
});

test("computePatientMetrics rejects non-positive inputs", () => {
  assert.throws(() => Engine.computePatientMetrics({ sex: "male", age: 0, weightKg: 70, heightCm: 170, serumCreatinine: 1 }));
  assert.throws(() => Engine.computePatientMetrics({ sex: "male", age: 40, weightKg: 70, heightCm: 170, serumCreatinine: 0 }));
});

test("derivePatientPK reduces clearance proportionally to renalFractionFr on renal impairment", () => {
  const drug = Engine.PRESET_DRUGS[0]; // fr = 0.90
  const normal = Engine.derivePatientPK(drug, { sex: "male", age: 40, weightKg: 70, heightCm: 175, serumCreatinine: 1.0 });
  const impaired = Engine.derivePatientPK(drug, { sex: "male", age: 40, weightKg: 70, heightCm: 175, serumCreatinine: 2.0 });
  assert.ok(impaired.metrics.crClMlMin < normal.metrics.crClMlMin * 0.51);
  assert.ok(impaired.clLPerH < normal.clLPerH);
  assert.ok(impaired.halfLifeH > normal.halfLifeH);
});

test("singleDoseConc1Comp handles bolus initial C0 and exact half-life decay", () => {
  const params = { vdL: 50, kePerH: Math.LN2 / 6 };
  assert.ok(Math.abs(Engine.singleDoseConc1Comp(0, 500, "bolus", params) - 10) < 1e-9);
  assert.ok(Math.abs(Engine.singleDoseConc1Comp(6, 500, "bolus", params) - 5) < 1e-9);
  assert.equal(Engine.singleDoseConc1Comp(-1, 500, "bolus", params), 0);
});

test("singleDoseConc1Comp handles IV infusion peak at end of infusion and post-infusion decay", () => {
  const ke = 0.1;
  const vdL = 40;
  const cl = ke * vdL;
  const dose = 800;
  const tInf = 2.0;
  const params = { vdL, kePerH: ke, infusionDurationH: tInf };
  const cEnd = Engine.singleDoseConc1Comp(2.0, dose, "infusion", params);
  const expected = ((dose / tInf) / cl) * (1 - Math.exp(-ke * tInf));
  assert.ok(Math.abs(cEnd - expected) < 1e-9);
  const cPost = Engine.singleDoseConc1Comp(5.0, dose, "infusion", params);
  assert.ok(Math.abs(cPost - cEnd * Math.exp(-ke * 3.0)) < 1e-9);
});

test("singleDoseConc1Comp handles oral Bateman equation and ka === ke l'Hopital limit smoothly", () => {
  const paramsDiff = { vdL: 40, kePerH: 0.2, kaPerH: 1.5, bioavailabilityF: 0.8 };
  assert.equal(Engine.singleDoseConc1Comp(0, 400, "oral", paramsDiff), 0);
  const cPeak = Engine.singleDoseConc1Comp(1.55, 400, "oral", paramsDiff);
  assert.ok(cPeak > 0 && cPeak < 8);

  const paramsEqual = { vdL: 40, kePerH: 0.5, kaPerH: 0.5, bioavailabilityF: 1.0 };
  const cEqual = Engine.singleDoseConc1Comp(2.0, 400, "oral", paramsEqual);
  const expectedLimit = (400 / 40) * 0.5 * 2.0 * Math.exp(-0.5 * 2.0);
  assert.ok(Math.abs(cEqual - expectedLimit) < 1e-6);

  const paramsNear = { vdL: 40, kePerH: 0.5, kaPerH: 0.500001, bioavailabilityF: 1.0 };
  assert.ok(Math.abs(Engine.singleDoseConc1Comp(2.0, 400, "oral", paramsNear) - cEqual) < 1e-4);
});

test("simulate1Compartment steady-state bolus accumulation matches analytical Css,max and Css,min", () => {
  const ke = Math.LN2 / 8;
  const sim = Engine.simulate1Compartment({
    vdL: 40,
    kePerH: ke,
    route: "bolus",
    doseMg: 400,
    intervalH: 8,
    numDoses: 12,
    mecMgL: 5,
    mtcMgL: 25,
    dtH: 0.1
  });
  assert.ok(Math.abs(sim.summary.accumIndex - 2.0) < 1e-6);
  assert.ok(Math.abs(sim.summary.cssMaxAnalytical - 20.0) < 1e-6);
  assert.ok(Math.abs(sim.summary.cssMinAnalytical - 10.0) < 1e-6);
  assert.ok(Math.abs(sim.summary.lastIntervalPeak - 20.0) < 0.05);
  assert.ok(Math.abs(sim.summary.lastIntervalTrough - 10.0) < 0.25);
});

test("simulate1Compartment loading dose reaches steady-state peak on first dose", () => {
  const ke = 0.1;
  const intervalH = 12;
  const doseMg = 500;
  const loadingDoseMg = doseMg / (1 - Math.exp(-ke * intervalH));
  const sim = Engine.simulate1Compartment({
    vdL: 50,
    kePerH: ke,
    route: "bolus",
    doseMg,
    loadingDoseMg,
    intervalH,
    numDoses: 8,
    mecMgL: 4,
    mtcMgL: 20,
    dtH: 0.1
  });
  const firstPeak = sim.points[0].conc;
  assert.ok(Math.abs(firstPeak - sim.summary.cssMaxAnalytical) < 1e-4);
});

test("buildDoseSchedule and perturbation correctly model missed, doubled, and delayed doses", () => {
  const missEv = Engine.buildDoseSchedule({ doseMg: 500, intervalH: 12, numDoses: 5, perturbType: "miss", perturbIndex: 3 });
  assert.equal(missEv.length, 4);
  assert.ok(!missEv.some((e) => e.index === 3));

  const dblEv = Engine.buildDoseSchedule({ doseMg: 500, intervalH: 12, numDoses: 5, perturbType: "double", perturbIndex: 2 });
  assert.equal(dblEv.find((e) => e.index === 2).doseMg, 1000);

  const dlyEv = Engine.buildDoseSchedule({ doseMg: 500, intervalH: 12, numDoses: 5, perturbType: "delay", perturbIndex: 4, delayHours: 5 });
  assert.equal(dlyEv.find((e) => e.index === 4).timeH, 3 * 12 + 5);
});

test("simulate2Compartment conserves mass to machine tolerance for bolus, infusion, and oral", () => {
  for (const route of ["bolus", "infusion", "oral"]) {
    const sim2 = Engine.simulate2Compartment({
      v1L: 20,
      k10PerH: 0.25,
      k12PerH: 0.6,
      k21PerH: 0.3,
      route,
      kaPerH: 1.4,
      bioavailabilityF: 0.85,
      infusionDurationH: 1.0,
      doseMg: 600,
      intervalH: 12,
      numDoses: 4,
      dtH: 0.025
    });
    assert.ok(sim2.massBalanceResidualMg < 1e-3, `mass balance failed for ${route}: ${sim2.massBalanceResidualMg}`);
    assert.ok(sim2.macroConstants.alpha > sim2.macroConstants.beta);
    assert.ok(sim2.macroConstants.vssL > 20);
    assert.ok(sim2.peakPeripheralMg > 0);
  }
});

test("solveOptimalRegimens finds in-window dosing regimen and adjusts down for impaired renal function", () => {
  const drug = Engine.PRESET_DRUGS[0]; // Vancomycin profile
  const normal = Engine.solveOptimalRegimens(drug, { sex: "male", age: 35, weightKg: 75, heightCm: 178, serumCreatinine: 0.9 });
  const impaired = Engine.solveOptimalRegimens(drug, { sex: "male", age: 72, weightKg: 75, heightCm: 178, serumCreatinine: 2.8 });
  assert.ok(normal.best && normal.best.inWindow);
  assert.ok(impaired.best);
  assert.ok(impaired.best.dailyDoseMg < normal.best.dailyDoseMg);
});

test("exportSeriesToCsv formats nominal and comparison curves cleanly", () => {
  const sim = Engine.simulate1Compartment({ vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 400, intervalH: 12, numDoses: 2, dtH: 1 });
  const csv1 = Engine.exportSeriesToCsv(sim, null);
  assert.ok(csv1.startsWith("time_h,nominal_conc_mg_l\n"));
  const csv2 = Engine.exportSeriesToCsv(sim, sim);
  assert.ok(csv2.startsWith("time_h,nominal_conc_mg_l,comparison_conc_mg_l\n"));
  assert.equal(csv2.trim().split("\n").length, sim.points.length + 1);
});
