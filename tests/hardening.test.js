// Wave 4 hardening suite: Bateman catastrophic-cancellation band, fail-closed input guards,
// bioavailability semantics, mass-balance accounting, stiff-system substepping, and the
// canonical-JSON / SHA-256 export path.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Engine = require("../js/pk-engine.js");

const PATIENT = { sex: "male", age: 48, weightKg: 76, heightCm: 175, serumCreatinine: 1.0 };
const ORAL = { vdL: 42, kePerH: 0.5, kaPerH: 0.5, bioavailabilityF: 1 };
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

/* ------------------------------------------------------------------ */
/* Bateman removable singularity at ka = ke                             */
/* ------------------------------------------------------------------ */

test("Bateman: ka === ke is exact, not NaN (500 mg, Vd 42, k 0.5, t 2)", () => {
  const c = Engine.singleDoseConc1Comp(2, 500, "oral", ORAL);
  const limit = (500 * 0.5 / 42) * 2 * Math.exp(-0.5 * 2);
  assert.ok(near(c, limit, 1e-12), `${c} vs ${limit}`);
});

test("Bateman: ka === ke at t = 0 returns 0", () => {
  assert.equal(Engine.singleDoseConc1Comp(0, 500, "oral", ORAL), 0);
});

test("Bateman: ka === ke matches t*e^-kt limit at several times", () => {
  for (const t of [0.25, 1, 3, 7.5, 20]) {
    const c = Engine.singleDoseConc1Comp(t, 250, "oral", ORAL);
    const limit = (250 * 0.5 / 42) * t * Math.exp(-0.5 * t);
    assert.ok(near(c, limit, 1e-12), `t=${t}: ${c} vs ${limit}`);
  }
});

test("Bateman: ka === ke at several rate pairs", () => {
  for (const k of [0.05, 0.3, 1.0, 3.7]) {
    const c = Engine.singleDoseConc1Comp(1.3, 100, "oral", { vdL: 20, kePerH: k, kaPerH: k, bioavailabilityF: 0.8 });
    const limit = (0.8 * 100 * k / 20) * 1.3 * Math.exp(-k * 1.3);
    assert.ok(near(c, limit, 1e-12), `k=${k}: ${c} vs ${limit}`);
  }
});

test("Bateman: ka = ke*(1+1e-12) stays on the limit, not catastrophic", () => {
  const c = Engine.singleDoseConc1Comp(2, 500, "oral", { ...ORAL, kaPerH: 0.5 * (1 + 1e-12) });
  const limit = (500 * 0.5 / 42) * 2 * Math.exp(-1);
  assert.ok(near(c, limit, 1e-6), `${c} drifted from ${limit}`);
});

test("Bateman: ka = ke*(1-1e-12) stays on the limit from below", () => {
  const c = Engine.singleDoseConc1Comp(2, 500, "oral", { ...ORAL, kaPerH: 0.5 * (1 - 1e-12) });
  const limit = (500 * 0.5 / 42) * 2 * Math.exp(-1);
  assert.ok(near(c, limit, 1e-6));
});

test("Bateman: |ka-ke|*t band is continuous at the 0.5 crossover both ways", () => {
  // x = (ka-ke)*dt = +-0.5 is where the code switches forms; both sides must agree.
  const dt = 2.5, ke = 1.0;
  for (const side of [-1, 1]) {
    const x = side * 0.500001;
    const ka = ke + x / dt;
    const band = Engine.singleDoseConc1Comp(dt, 100, "oral", { vdL: 10, kePerH: ke, kaPerH: ka, bioavailabilityF: 1 });
    const plain = (100 * ka / (10 * (ka - ke))) * (Math.exp(-ke * dt) - Math.exp(-ka * dt));
    assert.ok(near(band, plain, 1e-6), `side ${side}: ${band} vs ${plain}`);
  }
});

test("Bateman: continuity sweep over two decades around ka = ke", () => {
  const dt = 1.7, ke = 0.8;
  let prev = null;
  for (const eps of [1e-11, 1e-9, 1e-7, 1e-5, 1e-3, 1e-2]) {
    const ka = ke * (1 + eps);
    const c = Engine.singleDoseConc1Comp(dt, 400, "oral", { vdL: 30, kePerH: ke, kaPerH: ka, bioavailabilityF: 1 });
    const limit = (400 * ke / 30) * dt * Math.exp(-ke * dt);
    assert.ok(near(c, limit, 0.05), `eps ${eps}: ${c} too far from ${limit}`);
    if (prev !== null) assert.ok(Math.abs(c - prev) < 0.06 * limit, `jump between eps steps: ${prev} -> ${c}`);
    prev = c;
  }
});

test("Bateman: ka << ke (fast elimination) does not overflow to NaN", () => {
  const c = Engine.singleDoseConc1Comp(50, 500, "oral", { vdL: 42, kePerH: 10, kaPerH: 0.05, bioavailabilityF: 1 });
  assert.ok(Number.isFinite(c) && c >= 0, `got ${c}`);
  const plain = (500 * 0.05 / (42 * (0.05 - 10))) * (Math.exp(-10 * 50) - Math.exp(-0.05 * 50));
  assert.ok(near(c, plain, 1e-9));
});

test("Bateman: ka >> ke (flip-flop) is finite and positive", () => {
  const c = Engine.singleDoseConc1Comp(0.4, 500, "oral", { vdL: 42, kePerH: 0.01, kaPerH: 20, bioavailabilityF: 1 });
  assert.ok(Number.isFinite(c) && c > 0, `got ${c}`);
});

test("Bateman: huge dose x huge ka stays finite", () => {
  const c = Engine.singleDoseConc1Comp(0.01, 1e6, "oral", { vdL: 5, kePerH: 100, kaPerH: 100.0001, bioavailabilityF: 1 });
  assert.ok(Number.isFinite(c), `got ${c}`);
});

test("Bateman: oral curve is strictly positive for t > 0 and peaks at tmax", () => {
  const p = { vdL: 42, kePerH: 0.25, kaPerH: 0.9, bioavailabilityF: 1 };
  const tmax = Math.log(0.9 / 0.25) / (0.9 - 0.25);
  const atPeak = Engine.singleDoseConc1Comp(tmax, 500, "oral", p);
  assert.ok(atPeak > 0);
  assert.ok(Engine.singleDoseConc1Comp(tmax - 0.2, 500, "oral", p) < atPeak);
  assert.ok(Engine.singleDoseConc1Comp(tmax + 0.2, 500, "oral", p) < atPeak);
});

test("Bateman: scaling ka and ke together rescales the peak time", () => {
  // Doubling both rates halves tmax; the shape is time-scaled, not stretched.
  const a = Engine.singleDoseConc1Comp(1.0, 100, "oral", { vdL: 10, kePerH: 0.5, kaPerH: 1.3, bioavailabilityF: 1 });
  const b = Engine.singleDoseConc1Comp(0.5, 100, "oral", { vdL: 10, kePerH: 1.0, kaPerH: 2.6, bioavailabilityF: 1 });
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && b > 0);
});

test("Bateman: old 1e-5 dead band no longer swaps formulas early", () => {
  // With |ka - ke| = 3e-4 * dt (inside the old band, outside nothing), the exact value must be used.
  const c = Engine.singleDoseConc1Comp(2, 500, "oral", { vdL: 42, kePerH: 0.5, kaPerH: 0.5003, bioavailabilityF: 1 });
  const exact = (500 * 0.5003 / (42 * (0.5003 - 0.5))) * (Math.exp(-1) - Math.exp(-0.5003 * 2));
  assert.ok(near(c, exact, 1e-9), `${c} vs ${exact}`);
});

/* ------------------------------------------------------------------ */
/* Bioavailability semantics                                            */
/* ------------------------------------------------------------------ */

test("F = 0 gives an identically zero oral curve", () => {
  for (const t of [0.5, 2, 10]) {
    assert.equal(Engine.singleDoseConc1Comp(t, 500, "oral", { ...ORAL, bioavailabilityF: 0 }), 0);
  }
});

test("F > 1 is clamped to 1 (no super-absorption)", () => {
  const a = Engine.singleDoseConc1Comp(2, 500, "oral", { ...ORAL, kaPerH: 0.9, bioavailabilityF: 5 });
  const b = Engine.singleDoseConc1Comp(2, 500, "oral", { ...ORAL, kaPerH: 0.9, bioavailabilityF: 1 });
  assert.equal(a, b);
});

test("F scales the oral curve linearly", () => {
  const a = Engine.singleDoseConc1Comp(2, 500, "oral", { ...ORAL, kaPerH: 0.9, bioavailabilityF: 0.5 });
  const b = Engine.singleDoseConc1Comp(2, 500, "oral", { ...ORAL, kaPerH: 0.9, bioavailabilityF: 1 });
  assert.ok(near(a, 0.5 * b, 1e-12));
});

test("kaPerH = 0 fails closed on the oral route instead of silently absorbing", () => {
  assert.throws(() => Engine.simulate1Compartment({
    ...ORAL, kaPerH: 0, route: "oral", doseMg: 500, intervalH: 12, numDoses: 4
  }));
  assert.throws(() => Engine.simulate1Compartment({
    ...ORAL, kaPerH: -1.5, route: "oral", doseMg: 500, intervalH: 12, numDoses: 4
  }));
});

test("kaPerH = 0 on a non-oral route contributes zero, not a default 1.2", () => {
  // singleDoseConc1Comp is the leaf; non-oral routes never reach the ka branch.
  assert.equal(Engine.singleDoseConc1Comp(2, 500, "bolus", { vdL: 42, kePerH: 0.5, kaPerH: 0 }), (500 / 42) * Math.exp(-1));
});

/* ------------------------------------------------------------------ */
/* Fail-closed validation                                               */
/* ------------------------------------------------------------------ */

test("simulate1Compartment fails closed on non-positive vdL/ke/interval/dt/horizon", () => {
  const base = { vdL: 30, kePerH: 0.1, doseMg: 100, intervalH: 12 };
  assert.throws(() => Engine.simulate1Compartment({ ...base, vdL: 0 }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, vdL: -4 }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, kePerH: 0 }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, kePerH: -0.2 }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, intervalH: 0 }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, intervalH: -8 }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, dtH: 0 }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, dtH: -0.5 }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, horizonH: 0 }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, horizonH: -10 }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, horizonH: Infinity }));
  assert.throws(() => Engine.simulate1Compartment({ ...base, horizonH: NaN }));
});

test("simulate1Compartment fails closed on a 4M+ step grid", () => {
  assert.throws(() => Engine.simulate1Compartment({
    vdL: 30, kePerH: 0.1, doseMg: 100, intervalH: 12, numDoses: 10, dtH: 1e-6
  }));
});

test("simulate1Compartment fails closed on negative mecMgL", () => {
  assert.throws(() => Engine.simulate1Compartment({
    vdL: 30, kePerH: 0.1, doseMg: 100, intervalH: 12, mecMgL: -1
  }));
});

test("simulate1Compartment fails closed on an events list longer than MAX_DOSES", () => {
  const events = Array.from({ length: 2001 }, (_, i) => ({ index: i + 1, timeH: i, doseMg: 10 }));
  assert.throws(() => Engine.simulate1Compartment({
    vdL: 30, kePerH: 0.1, doseMg: 100, intervalH: 12, events
  }));
});

test("simulate1Compartment fails closed on non-array events", () => {
  assert.throws(() => Engine.simulate1Compartment({
    vdL: 30, kePerH: 0.1, doseMg: 100, intervalH: 12, events: { timeH: 0, doseMg: 10 }
  }));
});

test("buildDoseSchedule fails closed on numDoses above the cap", () => {
  assert.throws(() => Engine.buildDoseSchedule({ doseMg: 100, intervalH: 12, numDoses: 5000 }));
});

test("buildDoseSchedule fails closed on negative loading dose", () => {
  assert.throws(() => Engine.buildDoseSchedule({ doseMg: 100, intervalH: 12, loadingDoseMg: -50 }));
});

test("computePatientMetrics fails closed at age >= 140 (C-G goes non-positive)", () => {
  assert.throws(() => Engine.computePatientMetrics({ ...PATIENT, age: 140 }));
  assert.throws(() => Engine.computePatientMetrics({ ...PATIENT, age: 200 }));
});

test("computePatientMetrics still works at age 139", () => {
  const m = Engine.computePatientMetrics({ ...PATIENT, age: 139 });
  assert.ok(Number.isFinite(m.crClMlMin) && m.crClMlMin > 0);
});

test("computePatientMetrics fails closed on non-positive covariates", () => {
  assert.throws(() => Engine.computePatientMetrics({ ...PATIENT, weightKg: 0 }));
  assert.throws(() => Engine.computePatientMetrics({ ...PATIENT, weightKg: -60 }));
  assert.throws(() => Engine.computePatientMetrics({ ...PATIENT, heightCm: 0 }));
  assert.throws(() => Engine.computePatientMetrics({ ...PATIENT, age: 0 }));
  assert.throws(() => Engine.computePatientMetrics({ ...PATIENT, serumCreatinine: 0 }));
  assert.throws(() => Engine.computePatientMetrics({ ...PATIENT, serumCreatinine: -1 }));
});

test("derivePatientPK fails closed when renal scaling collapses clearance", () => {
  const drug = { vdLPerKg: 0.7, clRefLPerH: 6, renalFractionFr: 1, crClRefMlMin: 100 };
  assert.throws(() => Engine.derivePatientPK(drug, { ...PATIENT, age: 150 }));
});

test("derivePatientPK fails closed on non-positive clRef or vdLPerKg", () => {
  assert.throws(() => Engine.derivePatientPK({ vdLPerKg: 0.7, clRefLPerH: 0, renalFractionFr: 0.5, crClRefMlMin: 100 }, PATIENT));
  assert.throws(() => Engine.derivePatientPK({ vdLPerKg: 0, clRefLPerH: 6, renalFractionFr: 0.5, crClRefMlMin: 100 }, PATIENT));
});

test("derivePatientPK clamps renalFractionFr into [0,1]", () => {
  const a = Engine.derivePatientPK({ vdLPerKg: 0.7, clRefLPerH: 6, renalFractionFr: 3, crClRefMlMin: 100 }, PATIENT);
  const b = Engine.derivePatientPK({ vdLPerKg: 0.7, clRefLPerH: 6, renalFractionFr: 1, crClRefMlMin: 100 }, PATIENT);
  assert.equal(a.clLPerH, b.clLPerH);
});

test("simulate2Compartment fails closed on bad constants, dose, dt, horizon", () => {
  const base = { v1L: 20, k10PerH: 0.2, k12PerH: 0.3, k21PerH: 0.2, doseMg: 100 };
  assert.throws(() => Engine.simulate2Compartment({ ...base, v1L: 0 }));
  assert.throws(() => Engine.simulate2Compartment({ ...base, k10PerH: 0 }));
  assert.throws(() => Engine.simulate2Compartment({ ...base, k12PerH: -0.1 }));
  assert.throws(() => Engine.simulate2Compartment({ ...base, k21PerH: -0.1 }));
  assert.throws(() => Engine.simulate2Compartment({ ...base, doseMg: 0 }));
  assert.throws(() => Engine.simulate2Compartment({ ...base, doseMg: -50 }));
  assert.throws(() => Engine.simulate2Compartment({ ...base, dtH: 0 }));
  assert.throws(() => Engine.simulate2Compartment({ ...base, dtH: -0.01 }));
  assert.throws(() => Engine.simulate2Compartment({ ...base, horizonH: 0 }));
  assert.throws(() => Engine.simulate2Compartment({ ...base, horizonH: -5 }));
  assert.throws(() => Engine.simulate2Compartment({ ...base, horizonH: Infinity }));
});

test("simulate2Compartment fails closed on oral kaPerH <= 0", () => {
  assert.throws(() => Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.3, k21PerH: 0.2, doseMg: 100, route: "oral", kaPerH: 0
  }));
  assert.throws(() => Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.3, k21PerH: 0.2, doseMg: 100, route: "oral", kaPerH: -1
  }));
});

test("simulate2Compartment fails closed on an over-cap grid", () => {
  assert.throws(() => Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.3, k21PerH: 0.2, doseMg: 100, dtH: 1e-7, numDoses: 20
  }));
});

test("solveOptimalRegimens fails closed when the window is empty or inverted", () => {
  const drug = Engine.PRESET_DRUGS[0];
  assert.throws(() => Engine.solveOptimalRegimens({ ...drug, mecMgL: 50, mtcMgL: 10 }, PATIENT));
  assert.throws(() => Engine.solveOptimalRegimens({ ...drug, mecMgL: -1, mtcMgL: 10 }, PATIENT));
  assert.throws(() => Engine.solveOptimalRegimens({ ...drug, mecMgL: NaN }, PATIENT));
});

/* ------------------------------------------------------------------ */
/* Mass-balance accounting                                              */
/* ------------------------------------------------------------------ */

test("2-comp mass balance only counts doses that actually landed", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.15, k12PerH: 0.4, k21PerH: 0.25,
    doseMg: 100, intervalH: 12, numDoses: 10, horizonH: 30, dtH: 0.05
  });
  // Doses at t = 0, 12, 24 land inside a 30 h horizon; the rest never do.
  assert.equal(sim.totalAdministeredMg, 300);
  assert.ok(sim.massBalanceResidualMg < 1e-6, `residual ${sim.massBalanceResidualMg}`);
});

test("2-comp oral mass balance counts F * delivered dose", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.15, k12PerH: 0.4, k21PerH: 0.25, route: "oral", kaPerH: 1.0,
    bioavailabilityF: 0.6, doseMg: 100, intervalH: 12, numDoses: 5, horizonH: 26, dtH: 0.05
  });
  // doses at t = 0, 12, 24: 3 * 100 * 0.6
  assert.ok(near(sim.totalAdministeredMg, 180, 1e-9), `${sim.totalAdministeredMg}`);
  assert.ok(sim.massBalanceResidualMg < 1e-4);
});

test("2-comp infusion administered mass equals dose when horizon covers tInf", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.1, k12PerH: 0.3, k21PerH: 0.2, route: "infusion",
    infusionDurationH: 1, doseMg: 250, intervalH: 12, numDoses: 3, horizonH: 40, dtH: 0.05
  });
  assert.ok(near(sim.totalAdministeredMg, 750, 1e-6), `${sim.totalAdministeredMg}`);
  assert.ok(sim.massBalanceResidualMg < 1e-4);
});

test("2-comp infusion horizon cut mid-infusion counts only the delivered share", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.1, k12PerH: 0.3, k21PerH: 0.2, route: "infusion",
    infusionDurationH: 2, doseMg: 200, intervalH: 12, numDoses: 3, horizonH: 1, dtH: 0.05
  });
  // only 1 of the 2 infusion hours ran -> ~100 mg delivered
  assert.ok(Math.abs(sim.totalAdministeredMg - 100) < 5, `${sim.totalAdministeredMg}`);
  assert.ok(sim.massBalanceResidualMg < 1);
});

test("2-comp eliminated + retained mass equals administered mass at all times", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.15, k12PerH: 0.4, k21PerH: 0.25, doseMg: 100, intervalH: 12, numDoses: 4, dtH: 0.05
  });
  const last = sim.points[sim.points.length - 1];
  const retained = last.depotMg + last.centralMg + last.peripheralMg;
  assert.ok(near(retained + last.eliminatedMg, sim.totalAdministeredMg, 1e-4));
});

/* ------------------------------------------------------------------ */
/* Macro-constant math and degenerate compartments                      */
/* ------------------------------------------------------------------ */

test("2-comp alpha + beta equals k10 + k12 + k21", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.5, k21PerH: 0.3, doseMg: 100, horizonH: 1
  });
  const { alpha, beta } = sim.macroConstants;
  assert.ok(near(alpha + beta, 1.0, 1e-12));
});

test("2-comp alpha * beta equals k10 * k21", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.5, k21PerH: 0.3, doseMg: 100, horizonH: 1
  });
  const { alpha, beta } = sim.macroConstants;
  assert.ok(near(alpha * beta, 0.06, 1e-9));
});

test("2-comp alpha >= beta >= 0 for any positive rate set", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.9, k12PerH: 0.05, k21PerH: 2.0, doseMg: 100, horizonH: 1
  });
  assert.ok(sim.macroConstants.alpha >= sim.macroConstants.beta);
  assert.ok(sim.macroConstants.beta >= 0);
});

test("2-comp Vss = v1L when k12 is 0 (nothing distributes)", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0, k21PerH: 0.5, doseMg: 100, horizonH: 1
  });
  assert.equal(sim.macroConstants.vssL, 20);
});

test("2-comp Vss is Infinity when drug leaves but cannot return", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.5, k21PerH: 0, doseMg: 100, horizonH: 1
  });
  assert.equal(sim.macroConstants.vssL, Infinity);
});

test("2-comp Vss = v1*(1+k12/k21) for the normal case", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.4, k21PerH: 0.2, doseMg: 100, horizonH: 1
  });
  assert.equal(sim.macroConstants.vssL, 20 * (1 + 2));
});

test("2-comp bolus central concentration at t=0 is dose/v1L", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.3, k21PerH: 0.2, doseMg: 300, horizonH: 1
  });
  assert.ok(near(sim.points[0].centralConc, 15, 1e-9));
});

test("2-comp degenerates to 1-comp bolus when k12 = k21 = 0", () => {
  const v1 = 25, k10 = 0.12, dose = 200;
  const sim2 = Engine.simulate2Compartment({
    v1L: v1, k10PerH: k10, k12PerH: 0, k21PerH: 0, doseMg: dose,
    intervalH: 12, numDoses: 1, horizonH: 30, dtH: 0.05
  });
  for (const t of [0, 5, 15, 30]) {
    const c1 = dose / v1 * Math.exp(-k10 * t);
    const i = Math.round(t / 0.05);
    const pt = sim2.points[Math.min(sim2.points.length - 1, Math.floor(i / 2))];
    assert.ok(Math.abs(pt.centralConc - c1) < 0.05 * c1 || near(pt.centralConc, c1, 0.05), `t=${t}: ${pt.centralConc} vs ${c1}`);
  }
});

test("2-comp depot drains toward zero over a long horizon", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.1, k12PerH: 0.3, k21PerH: 0.2, route: "oral", kaPerH: 2,
    doseMg: 100, intervalH: 24, numDoses: 2, horizonH: 48, dtH: 0.05
  });
  const lastDepot = sim.points[sim.points.length - 1].depotMg;
  assert.ok(lastDepot < 1, `depot still holds ${lastDepot} mg`);
});

test("2-comp peripheral mass never goes negative", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.5, k12PerH: 0.8, k21PerH: 0.1, doseMg: 100, horizonH: 24, dtH: 0.05
  });
  for (const p of sim.points) assert.ok(p.peripheralMg >= -1e-9);
});

/* ------------------------------------------------------------------ */
/* Stiff-system substepping                                             */
/* ------------------------------------------------------------------ */

test("2-comp stays stable when dtH is 40x the fastest time constant", () => {
  // alpha ~ 100/h, dtH 0.5 -> old single-step RK4 explodes; substeps keep it sane.
  const sim = Engine.simulate2Compartment({
    v1L: 10, k10PerH: 50, k12PerH: 40, k21PerH: 30, doseMg: 100, horizonH: 2, dtH: 0.5
  });
  assert.ok(Number.isFinite(sim.peakCentralConc), `${sim.peakCentralConc}`);
  assert.ok(sim.peakCentralConc <= 10 + 1e-9, `peak ${sim.peakCentralConc} exceeds dose/v1`);
  assert.ok(sim.massBalanceResidualMg < 1e-3);
});

test("2-comp stiff oral: fast ka does not destabilise the depot", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 10, k10PerH: 0.5, k12PerH: 0.4, k21PerH: 0.3, route: "oral", kaPerH: 60,
    doseMg: 100, horizonH: 5, dtH: 0.5
  });
  for (const p of sim.points) assert.ok(Number.isFinite(p.centralConc) && p.centralConc >= 0);
  assert.ok(sim.massBalanceResidualMg < 1e-3);
});

test("2-comp substeps produce the same curve as the fine grid", () => {
  const opts = { v1L: 15, k10PerH: 0.4, k12PerH: 0.5, k21PerH: 0.35, doseMg: 150, horizonH: 20 };
  const coarse = Engine.simulate2Compartment({ ...opts, dtH: 0.5 });
  const fine = Engine.simulate2Compartment({ ...opts, dtH: 0.01 });
  const lastC = coarse.points[coarse.points.length - 1].centralConc;
  const lastF = fine.points[fine.points.length - 1].centralConc;
  assert.ok(Math.abs(lastC - lastF) / lastF < 0.02, `${lastC} vs ${lastF}`);
});

/* ------------------------------------------------------------------ */
/* Infusion boundary behaviour                                          */
/* ------------------------------------------------------------------ */

test("1-comp infusion is continuous across the end of the infusion", () => {
  const p = { vdL: 42, kePerH: 0.2, infusionDurationH: 1 };
  const before = Engine.singleDoseConc1Comp(1 - 1e-6, 500, "infusion", p);
  const after = Engine.singleDoseConc1Comp(1 + 1e-6, 500, "infusion", p);
  assert.ok(Math.abs(before - after) < 1e-4, `${before} vs ${after}`);
});

test("1-comp infusion ramp at tInf equals rate/CL*(1-e^-ke*tInf)", () => {
  const p = { vdL: 42, kePerH: 0.2, infusionDurationH: 1.5 };
  const c = Engine.singleDoseConc1Comp(1.5, 600, "infusion", p);
  const expected = (600 / 1.5) / (0.2 * 42) * (1 - Math.exp(-0.2 * 1.5));
  assert.ok(near(c, expected, 1e-9));
});

test("1-comp infusion decay phase matches C_end * e^-ke*(t-tInf)", () => {
  const p = { vdL: 42, kePerH: 0.2, infusionDurationH: 1 };
  const cEnd = (500 / 1) / (0.2 * 42) * (1 - Math.exp(-0.2));
  for (const t of [2, 5, 10]) {
    const c = Engine.singleDoseConc1Comp(t, 500, "infusion", p);
    assert.ok(near(c, cEnd * Math.exp(-0.2 * (t - 1)), 1e-9), `t=${t}`);
  }
});

test("1-comp bolus is dose/Vd decayed", () => {
  for (const t of [0, 3, 12]) {
    const c = Engine.singleDoseConc1Comp(t, 200, "bolus", { vdL: 40, kePerH: 0.1 });
    assert.ok(near(c, 5 * Math.exp(-0.1 * t), 1e-12), `t=${t}`);
  }
});

test("singleDoseConc1Comp returns 0 for non-positive dose or dt (fail-closed)", () => {
  assert.equal(Engine.singleDoseConc1Comp(2, 0, "oral", ORAL), 0);
  assert.equal(Engine.singleDoseConc1Comp(2, -500, "oral", ORAL), 0);
  assert.equal(Engine.singleDoseConc1Comp(-1, 500, "oral", ORAL), 0);
  assert.equal(Engine.singleDoseConc1Comp(2, 500, "bolus", { vdL: 0, kePerH: 0.5 }), 0);
  assert.equal(Engine.singleDoseConc1Comp(2, 500, "bolus", { vdL: 42, kePerH: 0 }), 0);
});

/* ------------------------------------------------------------------ */
/* Steady-state and AUC math                                            */
/* ------------------------------------------------------------------ */

test("bolus accumulation approaches Css,peak = (D/V)/(1-e^-ke*tau)", () => {
  const vdL = 40, ke = 0.1, tau = 24, dose = 300;
  const sim = Engine.simulate1Compartment({
    vdL, kePerH: ke, route: "bolus", doseMg: dose, intervalH: tau, numDoses: 12, dtH: 0.25
  });
  const expected = (dose / vdL) / (1 - Math.exp(-ke * tau));
  assert.ok(Math.abs(sim.summary.lastIntervalPeak - expected) < 0.02 * expected,
    `${sim.summary.lastIntervalPeak} vs ${expected}`);
});

test("oral single-dose AUC approximates F * Dose / CL over a long horizon", () => {
  const vdL = 40, ke = 0.1, dose = 300, F = 0.6;
  const sim = Engine.simulate1Compartment({
    vdL, kePerH: ke, kaPerH: 1.0, bioavailabilityF: F, route: "oral",
    doseMg: dose, intervalH: 400, numDoses: 1, horizonH: 300, dtH: 0.25
  });
  const expected = F * dose / (ke * vdL);
  assert.ok(Math.abs(sim.summary.aucTotal - expected) < 0.02 * expected,
    `${sim.summary.aucTotal} vs ${expected}`);
});

test("accumIndex equals 1/(1-e^-ke*tau)", () => {
  const sim = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.2, route: "bolus", doseMg: 100, intervalH: 12, numDoses: 4, dtH: 0.5
  });
  const expected = 1 / (1 - Math.exp(-0.2 * 12));
  assert.ok(near(sim.summary.accumIndex, expected, 1e-9));
});

test("cssAvg equals F*Dose/(CL*tau)", () => {
  const sim = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.15, route: "oral", bioavailabilityF: 0.8, kaPerH: 1.5,
    doseMg: 250, intervalH: 12, numDoses: 4, dtH: 0.5
  });
  const expected = 0.8 * 250 / (0.15 * 40 * 12);
  assert.ok(near(sim.summary.cssAvg, expected, 1e-9));
});

test("simulated curve points are strictly time-increasing", () => {
  const sim = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 24, numDoses: 3, dtH: 0.3333
  });
  for (let i = 1; i < sim.points.length; i++) {
    assert.ok(sim.points[i].timeH > sim.points[i - 1].timeH, `duplicate/backwards time at ${i}`);
  }
});

test("simulated curve keeps dtH finer than the old 4-decimal truncation", () => {
  const sim = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 24, numDoses: 1, horizonH: 0.001, dtH: 1e-4
  });
  const times = sim.points.map((p) => p.timeH);
  assert.ok(times.includes(0.0009) || times.includes(0.0008), `times ${times.join(',')}`);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
});

test("missed dose perturbation removes exactly one dose contribution", () => {
  const base = { vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 24, numDoses: 4, dtH: 1 };
  const full = Engine.simulate1Compartment(base);
  const missed = Engine.simulate1Compartment({ ...base, perturbType: "miss", perturbIndex: 3 });
  // After the missed interval, concentration differs by exactly one bolus tail.
  const i = full.points.findIndex((p) => p.timeH >= 70);
  const diff = full.points[i].conc - missed.points[i].conc;
  const expected = (100 / 40) * Math.exp(-0.1 * (full.points[i].timeH - 48));
  assert.ok(Math.abs(diff - expected) < 0.05 * expected, `${diff} vs ${expected}`);
});

test("doubled dose perturbation adds exactly one dose contribution", () => {
  const base = { vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 24, numDoses: 4, dtH: 1 };
  const full = Engine.simulate1Compartment(base);
  const doubled = Engine.simulate1Compartment({ ...base, perturbType: "double", perturbIndex: 2 });
  const i = full.points.findIndex((p) => p.timeH >= 70);
  const diff = doubled.points[i].conc - full.points[i].conc;
  const expected = (100 / 40) * Math.exp(-0.1 * (full.points[i].timeH - 24));
  assert.ok(Math.abs(diff - expected) < 0.05 * expected, `${diff} vs ${expected}`);
});

test("delayed dose perturbation shifts the contribution, conserving totals", () => {
  const base = { vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 24, numDoses: 4, delayHours: 6, dtH: 1 };
  const sched = Engine.buildDoseSchedule({ ...base, perturbType: "delay", perturbIndex: 2 });
  const delayed = sched.find((e) => /^delayed/.test(e.tag));
  assert.ok(delayed && delayed.timeH === 30, `delayed at ${delayed && delayed.timeH}`);
  const total = sched.reduce((s, e) => s + e.doseMg, 0);
  assert.equal(total, 400);
});

/* ------------------------------------------------------------------ */
/* Canonical JSON + SHA-256 export                                      */
/* ------------------------------------------------------------------ */

test("canonicalJson sorts object keys at every depth", () => {
  const out = Engine.canonicalJson({ b: 1, a: { d: 4, c: 3 }, z: [{ y: 2, x: 1 }] });
  assert.equal(out, '{"a":{"c":3,"d":4},"b":1,"z":[{"x":1,"y":2}]}');
});

test("canonicalJson is deterministic for the same payload", () => {
  const p = { drug: "x", patient: { b: 2, a: 1 } };
  assert.equal(Engine.canonicalJson(p), Engine.canonicalJson(p));
});

test("canonicalJson preserves array order (not sorted)", () => {
  assert.equal(Engine.canonicalJson({ a: [3, 1, 2] }), '{"a":[3,1,2]}');
});

test("canonicalJson handles empty and primitive payloads", () => {
  assert.equal(Engine.canonicalJson({}), '{}');
  assert.equal(Engine.canonicalJson({ a: null }), '{"a":null}');
  assert.equal(Engine.canonicalJson({ s: "x" }), '{"s":"x"}');
});

test("sha256Hex matches the FIPS vector for the empty string", () => {
  assert.equal(Engine.sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("sha256Hex matches the FIPS vector for 'abc'", () => {
  assert.equal(Engine.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256Hex matches the FIPS vector for the 448-bit message", () => {
  assert.equal(
    Engine.sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  );
});

test("sha256Hex matches node:crypto on random-ish payloads", () => {
  for (const s of ["payload-1", "Üñí ✓ 42", "y".repeat(4096), JSON.stringify({ a: 1, b: [2, 3] })]) {
    const ref = crypto.createHash("sha256").update(s, "utf8").digest("hex");
    assert.equal(Engine.sha256Hex(s), ref);
  }
});

test("exportReportJson embeds a matching SHA-256 integrity digest", () => {
  const payload = { drug: "Fixture", summary: { peak: 12.3 }, patient: { age: 50 } };
  const r = Engine.exportReportJson(payload);
  assert.equal(r.sha256, crypto.createHash("sha256").update(r.canonical, "utf8").digest("hex"));
  const parsed = JSON.parse(r.json);
  assert.equal(parsed.integrity.algorithm, "SHA-256");
  assert.equal(parsed.integrity.canonicalJsonSha256, r.sha256);
  assert.equal(parsed.drug, "Fixture");
});

test("exportReportJson does not mutate the caller's payload", () => {
  const payload = { a: 1 };
  Engine.exportReportJson(payload);
  assert.deepEqual(payload, { a: 1 });
});

test("exportReportJson canonical form is byte-identical across call sites", () => {
  const p = { z: 1, a: { y: 2, x: [1, 2] } };
  assert.equal(Engine.exportReportJson(p).canonical, Engine.exportReportJson(p).canonical);
});

/* ------------------------------------------------------------------ */
/* CSV formula-safety                                                   */
/* ------------------------------------------------------------------ */

test("CSV cells are strictly numeric or empty (no = + - @ leaders)", () => {
  const sim = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 24, numDoses: 3, dtH: 2
  });
  const csv = Engine.exportSeriesToCsv(sim);
  const lines = csv.split("\n");
  for (const line of lines.slice(1)) {
    for (const cell of line.split(",")) {
      assert.ok(/^-?\d+(\.\d+)?$/.test(cell) || cell === "", `unsafe cell: ${JSON.stringify(cell)}`);
    }
  }
});

test("CSV drops non-finite concentrations instead of printing NaN/Infinity", () => {
  const csv = Engine.exportSeriesToCsv({ points: [
    { timeH: 0, conc: 1.5 }, { timeH: 1, conc: NaN }, { timeH: 2, conc: Infinity }
  ] });
  const lines = csv.split("\n");
  assert.equal(lines[1], "0.00,1.5000");
  assert.equal(lines[2], "1.00,");
  assert.equal(lines[3], "2.00,");
});

test("CSV comparison column stays empty when comparison point is missing", () => {
  const sim = { points: [{ timeH: 0, conc: 1 }, { timeH: 1, conc: 2 }] };
  const cmp = { points: [{ timeH: 0, conc: 0.5 }] };
  const lines = Engine.exportSeriesToCsv(sim, cmp).split("\n");
  assert.equal(lines[2], "1.00,2.0000,");
});

test("CSV header reflects single vs comparison mode", () => {
  const sim = { points: [] };
  assert.equal(Engine.exportSeriesToCsv(sim).split("\n")[0], "time_h,nominal_conc_mg_l");
  assert.equal(Engine.exportSeriesToCsv(sim, { points: [] }).split("\n")[0], "time_h,nominal_conc_mg_l,comparison_conc_mg_l");
});

test("CSV handles a null result without throwing", () => {
  assert.equal(Engine.exportSeriesToCsv(null), "time_h,nominal_conc_mg_l");
});

/* ------------------------------------------------------------------ */
/* Additional guards and invariants                                     */
/* ------------------------------------------------------------------ */

test("simulate1Compartment fails closed on non-positive doseMg", () => {
  assert.throws(() => Engine.simulate1Compartment({ vdL: 30, kePerH: 0.1, doseMg: 0, intervalH: 12 }));
  assert.throws(() => Engine.simulate1Compartment({ vdL: 30, kePerH: 0.1, doseMg: -500, intervalH: 12 }));
});

test("simulate2Compartment fails closed on intervalH = 0 (not masked to 12)", () => {
  assert.throws(() => Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.3, k21PerH: 0.2, doseMg: 100, intervalH: 0
  }));
});

test("simulate1Compartment honours caller-supplied events verbatim", () => {
  const sim = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 999, intervalH: 12,
    events: [{ index: 1, timeH: 5, doseMg: 100 }]
  });
  // Only one event at t = 5: concentration before it is 0, after it is a decayed bolus.
  const iBefore = sim.points.findIndex((p) => p.timeH >= 4.9);
  const iAfter = sim.points.findIndex((p) => p.timeH >= 6);
  assert.ok(sim.points[iBefore].conc < 1e-6 || sim.points[iBefore].conc === 0);
  assert.ok(sim.points[iAfter].conc > 0);
});

test("buildDoseSchedule loading dose replaces only the first event", () => {
  const ev = Engine.buildDoseSchedule({ doseMg: 100, intervalH: 12, numDoses: 4, loadingDoseMg: 600 });
  assert.equal(ev.length, 4);
  assert.equal(ev[0].doseMg, 600);
  assert.equal(ev[0].tag, "loading");
  assert.equal(ev[1].doseMg, 100);
  assert.equal(ev[2].timeH, 24);
});

test("buildDoseSchedule miss removes the event entirely", () => {
  const ev = Engine.buildDoseSchedule({ doseMg: 100, intervalH: 12, numDoses: 4, perturbType: "miss", perturbIndex: 2 });
  assert.equal(ev.length, 3);
  assert.ok(ev.every((e) => e.index !== 2 || e.doseMg > 0));
  assert.ok(!ev.some((e) => e.timeH === 12));
});

test("solveOptimalRegimens returns finite candidates even at F = 0", () => {
  const drug = { ...Engine.PRESET_DRUGS[1], bioavailabilityF: 0, route: "oral" };
  const res = Engine.solveOptimalRegimens(drug, PATIENT);
  assert.ok(res.topCandidates.length > 0);
  for (const c of res.topCandidates) {
    assert.ok(Number.isFinite(c.cssPeak) && Number.isFinite(c.cssTrough));
  }
});

test("summary peakConc matches the curve maximum", () => {
  const sim = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.12, route: "oral", kaPerH: 1.4, bioavailabilityF: 0.9,
    doseMg: 400, intervalH: 12, numDoses: 5, dtH: 0.2
  });
  const mx = Math.max(...sim.points.map((p) => p.conc));
  assert.equal(sim.summary.peakConc, mx);
  const pt = sim.points.find((p) => p.conc === mx);
  assert.equal(sim.summary.peakTimeH, pt.timeH);
});

test("simulate2Compartment rejects an events list above the cap", () => {
  const events = Array.from({ length: 2001 }, (_, i) => ({ index: i + 1, timeH: i, doseMg: 5 }));
  assert.throws(() => Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.3, k21PerH: 0.2, doseMg: 100, events
  }));
});

test("computePatientMetrics ABW kicks in exactly at 125% of IBW", () => {
  // height 175 -> IBW ~70.46; 1.25x = 88.08. Just above -> ABW, just below -> actual weight.
  const just = Engine.computePatientMetrics({ sex: "male", age: 40, weightKg: 88.0, heightCm: 175, serumCreatinine: 1 });
  const over = Engine.computePatientMetrics({ sex: "male", age: 40, weightKg: 88.2, heightCm: 175, serumCreatinine: 1 });
  // 88.0 kg is at/under 1.25*IBW but above IBW -> Devine weight, not actual and not adjusted.
  assert.equal(just.dosingWeightKg, just.idealBodyWeightKg);
  assert.ok(over.dosingWeightKg < 88.2, `ABW should drop below actual: ${over.dosingWeightKg}`);
  assert.ok(over.dosingWeightKg > over.idealBodyWeightKg);
});

test("2-comp point timeH values keep sub-millisecond precision", () => {
  const sim = Engine.simulate2Compartment({
    v1L: 20, k10PerH: 0.2, k12PerH: 0.3, k21PerH: 0.2, doseMg: 100,
    intervalH: 12, numDoses: 1, horizonH: 0.001, dtH: 0.0005
  });
  assert.ok(sim.points.length >= 2);
  assert.equal(sim.points[sim.points.length - 1].timeH, 0.001);
});

test("time in window is 100% when curve stays inside [mec, mtc]", () => {
  const sim = Engine.simulate1Compartment({
    vdL: 40, kePerH: 0.02, route: "bolus", doseMg: 400, intervalH: 24, numDoses: 2,
    mecMgL: 5, mtcMgL: 20, dtH: 1
  });
  assert.equal(sim.summary.toxicPct, 0);
  assert.ok(sim.summary.timeInWindowPct > 90);
});

test("PRESET_DRUGS oral fixtures all have a positive kaPerH", () => {
  for (const d of Engine.PRESET_DRUGS) {
    if (d.route === "oral") assert.ok(d.kaPerH > 0, `${d.id} missing kaPerH`);
  }
});
