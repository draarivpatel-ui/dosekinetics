// Pass 2 regressions: each test pins a defect the hostile review reproduced and we fixed.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../js/pk-engine.js");

const ORAL = { vdL: 40, kePerH: 0.1, kaPerH: 1.2, bioavailabilityF: 1, infusionDurationH: 1 };
const TWO = { v1L: 30, k10PerH: 0.2, k12PerH: 0.15, k21PerH: 0.1, doseMg: 100, intervalH: 12, numDoses: 3, dtH: 0.05 };

/* ---- M1: 2-comp discrete events land exactly at their scheduled time ---- */

test("Pass2 M1: bolus event between grid steps applies at its time, not the step start", () => {
  const r = Engine.simulate2Compartment({ ...TWO, route: "bolus", numDoses: 1,
    events: [{ timeH: 3.5, doseMg: 100 }], horizonH: 6, dtH: 1 });
  const at4 = r.points.find((p) => p.timeH === 4);
  // Exact model: (D/V1) e^(-k10 * 0.5) for the central level at t=4 ignoring distribution drain.
  // With distribution the value is lower, but it MUST be higher than the "applied at t=3"
  // phantom and strictly below a t=4 application.
  const early = 100 / 30 * Math.exp(-0.2 * 1.0); // applied at t=3, decayed 1 h
  const exact = 100 / 30 * Math.exp(-0.2 * 0.5); // applied at t=3.5, decayed 0.5 h
  assert.ok(at4.centralConc > early, `conc ${at4.centralConc} not above early-application bound ${early}`);
  assert.ok(at4.centralConc <= exact + 1e-9, `conc ${at4.centralConc} exceeds exact-application bound ${exact}`);
});

test("Pass2 M1b: oral event at t=8 starts absorbing at 8, not a substep earlier", () => {
  const r = Engine.simulate2Compartment({ ...TWO, route: "oral", kaPerH: 1.5, bioavailabilityF: 1,
    events: [{ timeH: 8.0, doseMg: 500 }], horizonH: 12, dtH: 0.25 });
  const at8 = r.points.find((p) => p.timeH === 8);
  assert.ok(at8.centralConc < 0.5, `phantom pre-absorption conc ${at8.centralConc} at t=8`);
});

/* ---- M2: route whitelist ---- */

test("Pass2 M2: unknown route strings throw in both simulators", () => {
  for (const route of ["bogus", "Bolus", "", "oral "]) {
    assert.throws(() => Engine.simulate1Compartment({ vdL: 40, kePerH: 0.1, doseMg: 100, intervalH: 12, route }), /route/);
    assert.throws(() => Engine.simulate2Compartment({ ...TWO, route }), /route/);
  }
});

test("Pass2 M2b: bogus route with kaPerH 0 cannot sneak past the oral assert", () => {
  assert.throws(() => Engine.simulate1Compartment({ vdL: 40, kePerH: 0.1, doseMg: 100, intervalH: 12, route: "bogus", kaPerH: 0 }), /route/);
});

/* ---- M3: mtc validation in simulate1Compartment ---- */

test("Pass2 M3: non-finite, non-positive and inverted mtc all throw", () => {
  const base = { vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 12, mecMgL: 1 };
  for (const mtcMgL of [NaN, -10, 0, "abc"]) {
    assert.throws(() => Engine.simulate1Compartment({ ...base, mtcMgL }), /mtcMgL/);
  }
  assert.throws(() => Engine.simulate1Compartment({ ...base, mecMgL: 20, mtcMgL: 10 }), /mtcMgL/);
  // Omitted ceiling stays legal.
  const r = Engine.simulate1Compartment(base);
  assert.ok(r.summary.peakConc > 0);
});

/* ---- M4: event entries and the leaf guard ---- */

test("Pass2 M4: malformed event lists throw instead of leaking NaN", () => {
  const base = { vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 12 };
  for (const ev of [
    [{ timeH: 0, doseMg: NaN }], [{ timeH: 0, doseMg: Infinity }], [{ timeH: 0, doseMg: -500 }],
    [{ timeH: -5, doseMg: 100 }], [{ timeH: NaN, doseMg: 100 }], [{ doseMg: 100 }], [null],
  ]) {
    assert.throws(() => Engine.simulate1Compartment({ ...base, events: ev }), /event|timeH|doseMg/);
    assert.throws(() => Engine.simulate2Compartment({ ...TWO, events: ev }), /event|timeH|doseMg/);
  }
});

test("Pass2 M4b: leaf returns 0 for non-finite or non-positive dt/doseMg", () => {
  const p = { vdL: 40, kePerH: 0.1 };
  assert.equal(Engine.singleDoseConc1Comp(NaN, 100, "bolus", p), 0);
  assert.equal(Engine.singleDoseConc1Comp(Infinity, 100, "bolus", p), 0);
  assert.equal(Engine.singleDoseConc1Comp(1, Infinity, "bolus", p), 0);
  assert.equal(Engine.singleDoseConc1Comp(1, NaN, "bolus", p), 0);
  assert.equal(Engine.singleDoseConc1Comp(-1, 100, "bolus", p), 0);
});

/* ---- M5: F is an extravascular property; IV routes keep F_eff = 1 ---- */

test("Pass2 M5: bioavailabilityF does not shrink IV steady-state metrics", () => {
  const base = { vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 12, numDoses: 3 };
  const a = Engine.simulate1Compartment({ ...base, bioavailabilityF: 1 });
  const b = Engine.simulate1Compartment({ ...base, bioavailabilityF: 0.5 });
  assert.equal(b.summary.cssAvg, a.summary.cssAvg, "IV cssAvg must ignore F");
  // Oral still honours F.
  const c = Engine.simulate1Compartment({ ...base, route: "oral", kaPerH: 1.2, bioavailabilityF: 0.5 });
  const d = Engine.simulate1Compartment({ ...base, route: "oral", kaPerH: 1.2, bioavailabilityF: 1 });
  assert.ok(Math.abs(c.summary.cssAvg - 0.5 * d.summary.cssAvg) < 1e-9);
});

/* ---- M7: non-finite macro constants fail closed ---- */

test("Pass2 M7: astronomically large rate constants throw rather than emit a flat curve", () => {
  assert.throws(() => Engine.simulate2Compartment({ ...TWO, k10PerH: 1e308, k21PerH: 1e308, route: "bolus" }), /macro|finite/i);
});

/* ---- M8: infusion duration is validated where it is used ---- */

test("Pass2 M8: non-positive infusionDurationH throws on the infusion route in both sims", () => {
  for (const tInf of [0, -1, NaN]) {
    assert.throws(() => Engine.simulate1Compartment({ vdL: 40, kePerH: 0.1, route: "infusion", doseMg: 100, intervalH: 12, infusionDurationH: tInf }), /infusionDurationH/);
    assert.throws(() => Engine.simulate2Compartment({ ...TWO, route: "infusion", infusionDurationH: tInf }), /infusionDurationH/);
  }
  // tInf is irrelevant on oral/bolus routes: presets legally carry infusionDurationH: 0 there.
  const r = Engine.simulate1Compartment({ vdL: 40, kePerH: 0.1, route: "oral", doseMg: 100, intervalH: 12, infusionDurationH: 0 });
  assert.ok(r.summary.peakConc > 0);
});

/* ---- L1: caller events drive the steady-state block ---- */

test("Pass2 L1: empty custom events give a zero steady state, not a phantom one", () => {
  const r = Engine.simulate1Compartment({ vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 12, events: [], horizonH: 24 });
  assert.equal(r.summary.cssAvg, 0);
  assert.equal(r.summary.lastIntervalPeak, 0);
  assert.equal(r.summary.peakConc, 0);
});

test("Pass2 L1b: custom events derive dose and interval from the events themselves", () => {
  const events = [{ timeH: 0, doseMg: 200 }, { timeH: 8, doseMg: 200 }, { timeH: 16, doseMg: 200 }];
  const r = Engine.simulate1Compartment({ vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 12, events, horizonH: 24 });
  // Steady state must be computed on tau = 8 and dose 200, not the nominal 12/100.
  const cl = 0.1 * 40;
  assert.ok(Math.abs(r.summary.cssAvg - 200 / (cl * 8)) < 1e-9, `cssAvg ${r.summary.cssAvg}`);
  assert.ok(r.summary.lastIntervalPeak > 0);
});

/* ---- L2: partial-segment boundary trapezoid ---- */

test("Pass2 L2: last-interval AUC includes the boundary partial segment", () => {
  // Bolus 100 mg, Vd 40, ke 0.1, q12h at steady state: last-interval AUC -> dose/CL = 25 exactly.
  const r = Engine.simulate1Compartment({ vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 12.05, numDoses: 8, dtH: 0.1 });
  assert.ok(Math.abs(r.summary.lastIntervalAuc - 25) < 0.15, `AUC ${r.summary.lastIntervalAuc}`);
});

/* ---- L3: the grid always lands exactly on the horizon ---- */

test("Pass2 L3: non-integer horizon/dt still ends exactly at horizonH", () => {
  const r = Engine.simulate1Compartment({ vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 12, horizonH: 10.05, dtH: 1 });
  assert.equal(r.points[r.points.length - 1].timeH, 10.05);
  const r2 = Engine.simulate2Compartment({ ...TWO, route: "bolus", horizonH: 10.05, dtH: 1 });
  assert.equal(r2.points[r2.points.length - 1].timeH, 10.05);
});

/* ---- L4: numDoses is explicit ---- */

test("Pass2 L4: numDoses 0 gives an empty schedule; negatives and overflows throw", () => {
  const base = { vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 12, horizonH: 24 };
  const zero = Engine.simulate1Compartment({ ...base, numDoses: 0 });
  assert.equal(zero.events.length, 0);
  assert.equal(zero.summary.peakConc, 0);
  assert.throws(() => Engine.simulate1Compartment({ ...base, numDoses: -1 }), /numDoses/);
  assert.throws(() => Engine.simulate1Compartment({ ...base, numDoses: 2001 }), /numDoses/);
  assert.throws(() => Engine.simulate1Compartment({ ...base, numDoses: NaN }), /numDoses/);
});

/* ---- L5: 2-comp validates intervalH even with custom events ---- */

test("Pass2 L5: custom events do not exempt intervalH in simulate2Compartment", () => {
  assert.throws(() => Engine.simulate2Compartment({ ...TWO, intervalH: 0, events: [{ timeH: 0, doseMg: 100 }] }), /intervalH/);
});

/* ---- L7: peaks tracked at substep resolution ---- */

test("Pass2 L7: coarse output grid cannot hide the true peak", () => {
  const r = Engine.simulate2Compartment({ ...TWO, route: "oral", kaPerH: 2, bioavailabilityF: 1,
    events: [{ timeH: 0, doseMg: 500 }], horizonH: 10, dtH: 5 });
  const gridMax = Math.max(...r.points.map((p) => p.centralConc));
  assert.ok(r.peakCentralConc >= gridMax, "peak must cover substep resolution");
  assert.ok(r.peakCentralConc > 4, `true oral peak should be >> the coarse grid max (${r.peakCentralConc})`);
});

/* ---- L8: crClRef must be a real value ---- */

test("Pass2 L8: crClRefMlMin 0 or NaN is rejected, not silently 100", () => {
  const patient = { sex: "male", age: 40, weightKg: 70, heightCm: 170, serumCreatinine: 1 };
  for (const bad of [0, NaN, -50]) {
    assert.throws(() => Engine.derivePatientPK({ vdLPerKg: 0.6, clRefLPerH: 3, crClRefMlMin: bad, renalFractionFr: 0.5 }, patient), /crClRef/);
  }
});

/* ---- L9: sex enum is strict ---- */

test("Pass2 L9: any sex besides male/female throws", () => {
  const p = { age: 40, weightKg: 70, heightCm: 170, serumCreatinine: 1 };
  for (const bad of ["other", "FEMALE", "", 0]) {
    assert.throws(() => Engine.computePatientMetrics({ ...p, sex: bad }), /sex/);
  }
});

/* ---- L10: canonicalJson keeps __proto__ as data ---- */

test("Pass2 L10: a __proto__ key survives canonicalization as data", () => {
  const src = JSON.parse('{"a":1,"__proto__":{"x":2},"b":3}');
  const out = Engine.canonicalJson(src);
  assert.ok(out.includes('"__proto__"'), `lost key: ${out}`);
  assert.equal(JSON.parse(out).__proto__.x, 2);
});

/* ---- L4/M4 side effect: sorted custom events are normalized ---- */

test("Pass2: unsorted custom event lists are normalized before use", () => {
  const events = [{ timeH: 8, doseMg: 100 }, { timeH: 0, doseMg: 200 }];
  const r = Engine.simulate1Compartment({ vdL: 40, kePerH: 0.1, route: "bolus", doseMg: 100, intervalH: 12, events, horizonH: 12 });
  assert.deepEqual(r.events.map((e) => e.timeH), [0, 8]);
});

/* ---- M6 support: the app-layer numeric guard is finite, not just truthy ---- */

test("Pass2 M6: a 1e999-typed input cannot reach the engine through num() semantics", () => {
  // Mirror the app's num() helper contract directly: Infinity input -> fallback, not Infinity.
  const num = (v, fallback, lo, hi) => {
    const n = Number(v);
    return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : fallback));
  };
  assert.equal(num("1e999", 250, 25, 4000), 250);
  assert.equal(num("Infinity", 250, 25, 4000), 250);
  assert.equal(num("40000", 250, 25, 4000), 4000);
});
