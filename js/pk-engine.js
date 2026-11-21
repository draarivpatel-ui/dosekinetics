(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DoseKineticsEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Educational illustrative literature-range pharmacokinetic fixtures.
  // Explicitly marked as synthetic reference profiles for offline simulation, not clinical dosing guidance.
  const PRESET_DRUGS = [
    {
      id: "vancomycin-iv",
      name: "Glycopeptide Profile (IV Infusion)",
      route: "infusion",
      infusionDurationH: 1.0,
      defaultDoseMg: 1000,
      defaultIntervalH: 12,
      doseStepMg: 250,
      bioavailabilityF: 1.0,
      kaPerH: 2.0,
      vdLPerKg: 0.7,
      clRefLPerH: 4.5,
      crClRefMlMin: 100,
      renalFractionFr: 0.9,
      mecMgL: 10,
      mtcMgL: 40,
      troughMinMgL: 10,
      troughMaxMgL: 20,
      k12PerH: 0.65,
      k21PerH: 0.28,
      v1Fraction: 0.42,
      note: "Illustrative glycopeptide-style IV intermittent infusion fixture requiring therapeutic trough control and renal adjustment."
    },
    {
      id: "amoxicillin-oral",
      name: "Beta-Lactam Profile (Oral)",
      route: "oral",
      infusionDurationH: 0,
      defaultDoseMg: 500,
      defaultIntervalH: 8,
      doseStepMg: 250,
      bioavailabilityF: 0.85,
      kaPerH: 1.35,
      vdLPerKg: 0.32,
      clRefLPerH: 13.5,
      crClRefMlMin: 100,
      renalFractionFr: 0.75,
      mecMgL: 2.0,
      mtcMgL: 24.0,
      troughMinMgL: 1.0,
      troughMaxMgL: 8.0,
      k12PerH: 0.35,
      k21PerH: 0.45,
      v1Fraction: 0.6,
      note: "Illustrative time-above-MIC oral beta-lactam fixture demonstrating short half-life elimination and frequent dosing intervals."
    },
    {
      id: "theophylline-oral",
      name: "Methylxanthine Profile (Narrow Window)",
      route: "oral",
      infusionDurationH: 0,
      defaultDoseMg: 300,
      defaultIntervalH: 12,
      doseStepMg: 100,
      bioavailabilityF: 0.96,
      kaPerH: 0.9,
      vdLPerKg: 0.5,
      clRefLPerH: 2.8,
      crClRefMlMin: 100,
      renalFractionFr: 0.15,
      mecMgL: 10.0,
      mtcMgL: 20.0,
      troughMinMgL: 8.0,
      troughMaxMgL: 15.0,
      k12PerH: 0.25,
      k21PerH: 0.35,
      v1Fraction: 0.65,
      note: "Illustrative narrow therapeutic index oral bronchodilator fixture where small clearance shifts cross the 20 mg/L ceiling."
    },
    {
      id: "aminoglycoside-iv",
      name: "Aminoglycoside Profile (High Peak / Low Trough)",
      route: "infusion",
      infusionDurationH: 0.5,
      defaultDoseMg: 360,
      defaultIntervalH: 24,
      doseStepMg: 40,
      bioavailabilityF: 1.0,
      kaPerH: 2.5,
      vdLPerKg: 0.26,
      clRefLPerH: 4.8,
      crClRefMlMin: 100,
      renalFractionFr: 0.95,
      mecMgL: 1.0,
      mtcMgL: 22.0,
      troughMinMgL: 0.1,
      troughMaxMgL: 1.5,
      k12PerH: 0.45,
      k21PerH: 0.22,
      v1Fraction: 0.55,
      note: "Illustrative concentration-dependent extended-interval IV fixture sensitive to glomerular filtration decline."
    },
    {
      id: "lithium-nti",
      name: "Alkali Salt Profile (Long Half-Life Oral)",
      route: "oral",
      infusionDurationH: 0,
      defaultDoseMg: 450,
      defaultIntervalH: 12,
      doseStepMg: 150,
      bioavailabilityF: 0.95,
      kaPerH: 0.75,
      vdLPerKg: 0.75,
      clRefLPerH: 1.55,
      crClRefMlMin: 100,
      renalFractionFr: 0.98,
      mecMgL: 4.2,
      mtcMgL: 8.4,
      troughMinMgL: 4.2,
      troughMaxMgL: 7.0,
      k12PerH: 0.32,
      k21PerH: 0.18,
      v1Fraction: 0.5,
      note: "Illustrative high-accumulation renal fixture (units normalized to mg/L) showing why loading doses or long steady-state lead-in matter."
    }
  ];

  function assertPositive(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive finite number`);
    }
  }

  function assertNonNegative(value, name) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative finite number`);
    }
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  const MAX_DOSES = 2000;
  const MAX_GRID_STEPS = 4000000;

  /**
   * Numerically safe (1 - e^-x) / x for every x, including x = 0 and |x| tiny.
   * expm1 keeps full precision below |x| ~ 1e-5 where 1 - Math.exp(-x) cancels.
   */
  function phi1mExp(x) {
    if (x === 0) return 1;
    return -Math.expm1(-x) / x;
  }

  /**
   * Computes Devine Ideal Body Weight (kg), dosing weight (kg), and Cockcroft-Gault CrCl (mL/min).
   * Height in cm, weight in kg, age in years, serumCreatinine in mg/dL, sex in ("male" | "female").
   */
  function computePatientMetrics(patient) {
    const age = Number(patient.age);
    const weightKg = Number(patient.weightKg);
    const heightCm = Number(patient.heightCm);
    const serumCreatinine = Number(patient.serumCreatinine);
    if (patient.sex !== "female" && patient.sex !== "male") {
      throw new Error('sex must be "male" or "female"');
    }
    const sex = patient.sex;

    assertPositive(age, "age");
    assertPositive(weightKg, "weightKg");
    assertPositive(heightCm, "heightCm");
    assertPositive(serumCreatinine, "serumCreatinine");

    const heightInches = heightCm / 2.54;
    const baseIbw = sex === "female" ? 45.5 : 50.0;
    const rawIbw = baseIbw + 2.3 * (heightInches - 60);
    const idealBodyWeightKg = Math.max(30, rawIbw);

    let dosingWeightKg = weightKg;
    let weightBasis = "Actual Body Weight (ABW)";
    if (weightKg < idealBodyWeightKg) {
      dosingWeightKg = weightKg;
      weightBasis = "Actual Body Weight (ABW < IBW)";
    } else if (weightKg > 1.25 * idealBodyWeightKg) {
      dosingWeightKg = idealBodyWeightKg + 0.4 * (weightKg - idealBodyWeightKg);
      weightBasis = "Adjusted Body Weight (AdjBW = IBW + 0.4*(ABW - IBW))";
    } else {
      dosingWeightKg = idealBodyWeightKg;
      weightBasis = "Ideal Body Weight (Devine IBW)";
    }

    if (!(140 - age > 0)) {
      throw new Error("age must be below 140 years for the Cockcroft-Gault relation");
    }
    const sexFactor = sex === "female" ? 0.85 : 1.0;
    const crClMlMin = ((140 - age) * dosingWeightKg * sexFactor) / (72 * serumCreatinine);
    const bmi = weightKg / Math.pow(heightCm / 100, 2);

    return {
      sex,
      age,
      weightKg,
      heightCm,
      serumCreatinine,
      bmi,
      idealBodyWeightKg,
      dosingWeightKg,
      weightBasis,
      crClMlMin
    };
  }

  /**
   * Scales drug clearance and volume of distribution for a patient profile.
   */
  function derivePatientPK(drug, patient) {
    const metrics = computePatientMetrics(patient);
    const vdLPerKg = Number(drug.vdLPerKg);
    const clRefLPerH = Number(drug.clRefLPerH);
    const crClRefMlMin = Number(drug.crClRefMlMin ?? 100);
    const fr = clamp(Number(drug.renalFractionFr ?? 0.5), 0, 1);

    assertPositive(vdLPerKg, "vdLPerKg");
    assertPositive(clRefLPerH, "clRefLPerH");
    assertPositive(crClRefMlMin, "crClRefMlMin");

    const vdL = vdLPerKg * metrics.dosingWeightKg;
    const renalRatio = metrics.crClMlMin / crClRefMlMin;
    const clMultiplier = (1 - fr) + fr * renalRatio;
    const clLPerH = clRefLPerH * clMultiplier;
    assertPositive(clLPerH, "patient clearance clLPerH");
    const kePerH = clLPerH / vdL;
    const halfLifeH = Math.LN2 / kePerH;

    return {
      metrics,
      vdL,
      clLPerH,
      kePerH,
      halfLifeH,
      clMultiplier,
      renalRatio
    };
  }

  /**
   * Single-dose concentration contribution at elapsed time dt >= 0 for 1-compartment model.
   * Handles IV bolus, zero-order IV infusion of duration tInfH, and first-order oral absorption (with ka === ke l'Hopital limit).
   */
  const PK_ROUTES = new Set(["bolus", "infusion", "oral"]);
  function assertRoute(route) {
    if (!PK_ROUTES.has(route)) {
      throw new Error('route must be one of "bolus", "infusion", "oral"');
    }
  }

  // Caller-supplied event lists get the same fail-closed contract as generated schedules:
  // finite non-negative times (sorted order is normalized, not required) and finite positive doses.
  function validateEvents(events) {
    if (!Array.isArray(events) || events.length > MAX_DOSES) {
      throw new Error(`events list is missing or exceeds the supported ${MAX_DOSES} doses`);
    }
    for (const ev of events) {
      if (!ev || !(Number.isFinite(ev.timeH) && ev.timeH >= 0) || !(Number.isFinite(ev.doseMg) && ev.doseMg > 0)) {
        throw new Error("each event needs a finite timeH >= 0 and a finite doseMg > 0");
      }
    }
    return events.slice().sort((a, b) => a.timeH - b.timeH);
  }

  function singleDoseConc1Comp(dt, doseMg, route, params) {
    if (!(Number.isFinite(dt) && dt >= 0) || !(Number.isFinite(doseMg) && doseMg > 0)) return 0;
    const vdL = params.vdL;
    const ke = params.kePerH;
    // Fail closed: a degenerate volume or elimination rate contributes zero concentration,
    // never Infinity/NaN leaking into a superposition sum.
    if (!(vdL > 0) || !(ke > 0)) return 0;

    if (route === "bolus") {
      return (doseMg / vdL) * Math.exp(-ke * dt);
    }

    if (route === "infusion") {
      const tInf = Number(params.infusionDurationH);
      if (!(Number.isFinite(tInf) && tInf > 0)) return 0;
      const rate = doseMg / tInf;
      const cl = ke * vdL;
      if (dt <= tInf) {
        return (rate / cl) * (1 - Math.exp(-ke * dt));
      }
      const cEnd = (rate / cl) * (1 - Math.exp(-ke * tInf));
      return cEnd * Math.exp(-ke * (dt - tInf));
    }

    // First-order oral / extravascular Bateman equation. For |x| = |(ka - ke)*dt| < 0.5 it is
    // evaluated in the cancellation-free form F*D*ka/V * t * e^(-ke*t) * phi(x), which is exact
    // at ka === ke (the l'Hopital limit) and never subtracts nearly equal quantities. Outside
    // that band the plain difference loses at most a fraction of a digit, and computing each
    // exponential separately also avoids the expm1 overflow the factored form hits for ka << ke.
    const F = clamp(Number(params.bioavailabilityF ?? 1.0), 0, 1.0);
    const ka = Number(params.kaPerH ?? 1.2);
    if (!(ka > 0)) return 0;
    const x = (ka - ke) * dt;
    if (Math.abs(x) < 0.5) {
      return ((F * doseMg * ka) / vdL) * dt * Math.exp(-ke * dt) * phi1mExp(x);
    }
    return ((F * doseMg * ka) / (vdL * (ka - ke))) * (Math.exp(-ke * dt) - Math.exp(-ka * dt));
  }

  /**
   * Builds discrete dosing events (supports optional loading dose and single-dose perturbation:
   * missed dose, doubled dose, or delayed dose at perturbDoseIndex 1-based).
   */
  function buildDoseSchedule(options) {
    const doseMg = Number(options.doseMg);
    const intervalH = Number(options.intervalH);
    const numDoses = Math.round(Number(options.numDoses ?? 8));
    const loadingDoseMg = Number(options.loadingDoseMg ?? 0);
    const perturbIndex = Math.round(Number(options.perturbIndex ?? 0)); // 1-based
    const perturbType = options.perturbType || "none"; // "none" | "miss" | "double" | "delay"
    const delayHours = Math.max(0, Number(options.delayHours || 0));

    assertPositive(doseMg, "doseMg");
    assertPositive(intervalH, "intervalH");

    if (!(Number.isFinite(numDoses) && numDoses >= 0 && numDoses <= MAX_DOSES)) {
      throw new Error(`numDoses must be an integer between 0 and ${MAX_DOSES}`);
    }
    assertNonNegative(loadingDoseMg, "loadingDoseMg");

    const events = [];
    for (let i = 0; i < numDoses; i++) {
      const doseNum = i + 1;
      let tH = i * intervalH;
      let amt = i === 0 && loadingDoseMg > 0 ? loadingDoseMg : doseMg;
      let tag = i === 0 && loadingDoseMg > 0 ? "loading" : "maintenance";

      if (perturbIndex === doseNum && perturbType !== "none") {
        if (perturbType === "miss") {
          amt = 0;
          tag = "missed";
        } else if (perturbType === "double") {
          amt = amt * 2;
          tag = "doubled";
        } else if (perturbType === "delay") {
          tH += delayHours;
          tag = `delayed +${delayHours}h`;
        }
      }

      if (amt > 0) {
        events.push({ index: doseNum, timeH: tH, doseMg: amt, tag });
      }
    }
    return events;
  }

  /**
   * Computes exact closed-form 1-compartment concentration-time profile via linear superposition.
   */
  function simulate1Compartment(options) {
    const vdL = Number(options.vdL);
    const kePerH = Number(options.kePerH);
    const route = options.route ?? "oral";
    assertRoute(route);
    const intervalH = Number(options.intervalH);
    const numDoses = Math.round(Number(options.numDoses ?? 8));
    const mec = Number(options.mecMgL ?? 0);
    const mtc = options.mtcMgL === undefined ? Infinity : Number(options.mtcMgL);
    const dtH = options.dtH === undefined ? 0.1 : Number(options.dtH);
    const doseMg = Number(options.doseMg);
    const tInf = Number(options.infusionDurationH ?? 1.0);
    const totalHorizonH = options.horizonH === undefined ? numDoses * intervalH : Number(options.horizonH);

    assertPositive(vdL, "vdL");
    assertPositive(kePerH, "kePerH");
    assertPositive(intervalH, "intervalH");
    assertPositive(doseMg, "doseMg");
    assertPositive(dtH, "dtH");
    if (route === "infusion") assertPositive(tInf, "infusionDurationH");
    assertPositive(totalHorizonH, "horizonH");
    assertNonNegative(mec, "mecMgL");
    if (!(mtc > mec)) {
      throw new Error("mtcMgL must be greater than mecMgL (or omitted for an open ceiling)");
    }

    const events = validateEvents(options.events || buildDoseSchedule(options));
    const steps = Math.max(2, Math.ceil((totalHorizonH - 1e-9) / dtH));
    if (steps > MAX_GRID_STEPS || steps * Math.max(1, events.length) > MAX_GRID_STEPS) {
      throw new Error(`grid exceeds ${MAX_GRID_STEPS} steps; raise dtH or shorten the horizon`);
    }
    const points = [];
    const params = {
      vdL,
      kePerH,
      kaPerH: Number(options.kaPerH ?? 1.2),
      bioavailabilityF: Number(options.bioavailabilityF ?? 1.0),
      infusionDurationH: tInf
    };
    if (route === "oral") assertPositive(params.kaPerH, "kaPerH");

    let peakC = 0;
    let peakTimeH = 0;
    let inWindowCount = 0;
    let toxicCount = 0;
    let subTherapeuticCount = 0;
    let aucTotal = 0;

    for (let s = 0; s <= steps; s++) {
      // The grid always lands exactly on the horizon, even when horizon/dt is not an integer.
      const t = Math.min(Number((s * dtH).toPrecision(12)), totalHorizonH);
      if (points.length && t <= points[points.length - 1].timeH) break;
      let c = 0;
      for (let e = 0; e < events.length; e++) {
        if (t >= events[e].timeH) {
          c += singleDoseConc1Comp(t - events[e].timeH, events[e].doseMg, route, params);
        }
      }
      if (c > peakC) {
        peakC = c;
        peakTimeH = t;
      }
      if (s > 0) {
        const prevC = points[s - 1].conc;
        aucTotal += 0.5 * (prevC + c) * dtH;
      }
      if (c >= mec && c <= mtc) {
        inWindowCount++;
      } else if (c > mtc) {
        toxicCount++;
      } else {
        subTherapeuticCount++;
      }
      points.push({ timeH: t, conc: c });
    }

    // Analytical steady-state metrics for a constant maintenance dose & interval. IV routes are
    // fully bioavailable by definition, so F only scales the oral branch. With caller-supplied
    // events the effective dose/interval come from the last two events, not the nominal inputs.
    const F = clamp(Number(options.bioavailabilityF ?? 1.0), 0, 1.0);
    const Feff = route === "oral" ? F : 1;
    const cl = kePerH * vdL;
    const custom = Array.isArray(options.events);
    const lastEv = events.length ? events[events.length - 1] : null;
    const effDose = custom && lastEv ? lastEv.doseMg : doseMg;
    const effTau = custom && events.length > 1
      ? Math.max(1e-9, lastEv.timeH - events[events.length - 2].timeH)
      : intervalH;
    const expKeTau = Math.exp(-kePerH * effTau);
    const accumIndex = 1 / Math.max(1e-9, 1 - expKeTau);
    const cssAvg = events.length ? (Feff * effDose) / (cl * effTau) : 0;

    // Numerical steady-state peak & trough over the interval containing the last dose. Segments
    // crossing the window edge are trapezoided on their inside portion only.
    const lastIntervalStart = lastEv ? lastEv.timeH : 0;
    const lastIntervalEnd = lastIntervalStart + effTau;
    let lastIntervalPeak = 0;
    let lastIntervalTrough = Infinity;
    let lastIntervalAuc = 0;
    for (let s = 0; s < points.length; s++) {
      const pt = points[s];
      if (pt.timeH >= lastIntervalStart - 1e-6 && pt.timeH <= lastIntervalEnd + 1e-6) {
        if (pt.conc > lastIntervalPeak) lastIntervalPeak = pt.conc;
        if (pt.conc < lastIntervalTrough) lastIntervalTrough = pt.conc;
      }
      if (s > 0) {
        const p0 = points[s - 1];
        const lo = Math.max(p0.timeH, lastIntervalStart);
        const hi = Math.min(pt.timeH, lastIntervalEnd);
        const span = pt.timeH - p0.timeH;
        if (hi > lo && span > 0) {
          const c0 = p0.conc + (pt.conc - p0.conc) * ((lo - p0.timeH) / span);
          const c1 = p0.conc + (pt.conc - p0.conc) * ((hi - p0.timeH) / span);
          lastIntervalAuc += 0.5 * (c0 + c1) * (hi - lo);
        }
      }
    }
    if (!Number.isFinite(lastIntervalTrough)) lastIntervalTrough = 0;

    // Exact bolus / infusion analytical steady-state peak & trough for validation
    let cssMaxAnalytical = lastIntervalPeak;
    let cssMinAnalytical = lastIntervalTrough;
    if (route === "bolus") {
      cssMaxAnalytical = (effDose / vdL) * accumIndex;
      cssMinAnalytical = cssMaxAnalytical * expKeTau;
    } else if (route === "infusion") {
      const rate = effDose / tInf;
      if (tInf <= effTau) {
        cssMaxAnalytical = (rate / cl) * ((1 - Math.exp(-kePerH * tInf)) / (1 - expKeTau));
        cssMinAnalytical = cssMaxAnalytical * Math.exp(-kePerH * (effTau - tInf));
      }
    }

    const totalPts = points.length;
    return {
      points,
      events,
      summary: {
        peakConc: peakC,
        peakTimeH,
        lastIntervalPeak,
        lastIntervalTrough,
        lastIntervalAuc,
        aucTotal,
        cssAvg,
        cssMaxAnalytical,
        cssMinAnalytical,
        accumIndex,
        halfLifeH: Math.LN2 / kePerH,
        timeInWindowPct: (inWindowCount / totalPts) * 100,
        toxicPct: (toxicCount / totalPts) * 100,
        subTherapeuticPct: (subTherapeuticCount / totalPts) * 100
      }
    };
  }

  /**
   * Computes exact bi-exponential hybrid rate constants (alpha, beta, A, B) and runs RK4 integration
   * for a 2-compartment model (central C1 + peripheral compartment mass A2), supporting oral depot & IV bolus/infusion.
   */
  function simulate2Compartment(options) {
    const v1L = Number(options.v1L);
    const k10 = Number(options.k10PerH);
    const k12 = Number(options.k12PerH);
    const k21 = Number(options.k21PerH);
    const route = options.route ?? "bolus";
    assertRoute(route);
    const doseMg = Number(options.doseMg);
    const intervalH = Number(options.intervalH ?? 12);
    const numDoses = Math.round(Number(options.numDoses ?? 6));
    const ka = options.kaPerH === undefined ? 1.2 : Number(options.kaPerH);
    const F = clamp(Number(options.bioavailabilityF ?? 1.0), 0, 1.0);
    const tInf = Number(options.infusionDurationH ?? 1.0);
    const dtH = Number(options.dtH ?? 0.025);
    const horizonH = Number(options.horizonH ?? numDoses * intervalH);

    assertPositive(v1L, "v1L");
    assertPositive(k10, "k10PerH");
    assertNonNegative(k12, "k12PerH");
    assertNonNegative(k21, "k21PerH");
    assertPositive(doseMg, "doseMg");
    assertPositive(intervalH, "intervalH");
    if (route === "infusion") assertPositive(tInf, "infusionDurationH");
    if (route === "oral") assertPositive(ka, "kaPerH");
    assertPositive(dtH, "dtH");

    // Hybrid macro-constants from quadratic eigenvalues of compartment matrix. Astronomically
    // large rate constants overflow the discriminant into NaN territory; fail closed instead of
    // returning a confidently wrong flat curve.
    const sumRates = k10 + k12 + k21;
    const disc = Math.sqrt(Math.max(0, sumRates * sumRates - 4 * k10 * k21));
    const alpha = 0.5 * (sumRates + disc);
    const beta = 0.5 * (sumRates - disc);
    if (!(Number.isFinite(disc) && Number.isFinite(alpha) && Number.isFinite(beta))) {
      throw new Error("rate constants produced non-finite macro constants");
    }
    const alphaHalfLifeH = alpha > 0 ? Math.LN2 / alpha : Infinity;
    const betaHalfLifeH = beta > 0 ? Math.LN2 / beta : Infinity;

    const events = validateEvents(options.events || buildDoseSchedule({ ...options, doseMg, intervalH, numDoses }));
    assertPositive(horizonH, "horizonH");
    const steps = Math.max(2, Math.ceil((horizonH - 1e-9) / dtH));
    if (steps > MAX_GRID_STEPS) {
      throw new Error(`grid exceeds ${MAX_GRID_STEPS} steps; raise dtH or shorten the horizon`);
    }
    const sampleStride = Math.max(1, Math.round(0.1 / dtH));

    // Stiff-system guard: split each output step so the explicit RK4 step stays a safe
    // fraction of the fastest time constant (alpha or ka, whichever is faster).
    const fastestRate = Math.max(alpha, route === "oral" ? ka : 0);
    const subSteps = Math.max(1, Math.ceil((dtH * fastestRate) / 0.2));
    const totalIters = steps * subSteps;
    if (!Number.isFinite(totalIters) || totalIters > MAX_GRID_STEPS) {
      throw new Error(`integration needs ${totalIters} steps; raise dtH or shorten the horizon`);
    }
    const h = dtH / subSteps;

    // State: depotMg (gut), a1Mg (central), a2Mg (peripheral)
    let depot = 0;
    let a1 = 0;
    let a2 = 0;
    let eliminated = 0;
    let administered = 0;

    const points = [];
    const bolusProcessed = new Set();

    function infusionRateForStep(tPrev, tCurr) {
      if (route !== "infusion") return 0;
      const stepDur = tCurr - tPrev;
      if (stepDur <= 0) return 0;
      let rate = 0;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const overlap = Math.max(0, Math.min(tCurr, ev.timeH + tInf) - Math.max(tPrev, ev.timeH));
        if (overlap > 0) {
          rate += (ev.doseMg / tInf) * (overlap / stepDur);
        }
      }
      return rate;
    }

    // Discrete bolus/oral events are applied exactly at their scheduled time: the driver splits
    // any integration step containing an event at ev.timeH, integrates the prefix, then applies
    // the dose. The old interval-membership check fired at the step start instead, landing every
    // event up to one substep early.
    function applyDiscreteEventsAt(tNow) {
      for (let i = 0; i < events.length; i++) {
        if (bolusProcessed.has(i)) continue;
        const ev = events[i];
        if (ev.timeH <= tNow + 1e-9) {
          if (route === "bolus") {
            a1 += ev.doseMg;
            administered += ev.doseMg;
            bolusProcessed.add(i);
          } else if (route === "oral") {
            const delivered = F * ev.doseMg;
            depot += delivered;
            administered += delivered;
            bolusProcessed.add(i);
          }
        }
      }
    }

    function deriv(stepInfRate, d, x1, x2) {
      const rIn = stepInfRate + (route === "oral" ? ka * d : 0);
      const dd = route === "oral" ? -ka * d : 0;
      const dx1 = rIn - (k10 + k12) * x1 + k21 * x2;
      const dx2 = k12 * x1 - k21 * x2;
      const de = k10 * x1;
      return [dd, dx1, dx2, de];
    }

    function rk4Step(tPrev, hStep) {
      const tCurr = tPrev + hStep;
      const infRate = infusionRateForStep(tPrev, tCurr);
      administered += infRate * hStep;
      const k1 = deriv(infRate, depot, a1, a2);
      const k2 = deriv(
        infRate,
        depot + 0.5 * hStep * k1[0],
        a1 + 0.5 * hStep * k1[1],
        a2 + 0.5 * hStep * k1[2]
      );
      const k3 = deriv(
        infRate,
        depot + 0.5 * hStep * k2[0],
        a1 + 0.5 * hStep * k2[1],
        a2 + 0.5 * hStep * k2[2]
      );
      const k4 = deriv(
        infRate,
        depot + hStep * k3[0],
        a1 + hStep * k3[1],
        a2 + hStep * k3[2]
      );

      depot += (hStep / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      a1 += (hStep / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      a2 += (hStep / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
      eliminated += (hStep / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
    }

    let peakCentralConc = 0;
    let peakPeripheralMg = 0;

    // Integrate from t0 to t1 in h-sized RK4 steps, splitting any step that contains a discrete
    // event at its event time. Peaks are tracked at substep resolution so a coarse output grid
    // cannot hide the true maximum.
    function integrateTo(t0, t1) {
      let t = t0;
      while (t < t1 - 1e-9) {
        let next = Math.min(t + h, t1);
        for (let i = 0; i < events.length; i++) {
          const ev = events[i];
          if (ev.timeH > t + 1e-9 && ev.timeH < next - 1e-9) next = ev.timeH;
        }
        rk4Step(t, next - t);
        t = next;
        applyDiscreteEventsAt(t);
        const c = a1 / v1L;
        if (c > peakCentralConc) peakCentralConc = c;
        if (a2 > peakPeripheralMg) peakPeripheralMg = a2;
      }
    }

    applyDiscreteEventsAt(0);
    points.push({
      timeH: 0,
      centralConc: a1 / v1L,
      peripheralMg: a2,
      centralMg: a1,
      depotMg: depot,
      eliminatedMg: eliminated
    });

    for (let s = 1; s <= steps; s++) {
      const tPrev = (s - 1) * dtH;
      const tCurr = Math.min(s * dtH, horizonH);
      if (tCurr <= tPrev) break;
      integrateTo(tPrev, tCurr);

      if (s % sampleStride === 0 || tCurr >= horizonH - 1e-9) {
        points.push({
          timeH: Number(tCurr.toPrecision(12)),
          centralConc: Math.max(0, a1 / v1L),
          peripheralMg: Math.max(0, a2),
          centralMg: Math.max(0, a1),
          depotMg: Math.max(0, depot),
          eliminatedMg: Math.max(0, eliminated)
        });
      }
    }

    const totalAdministeredMg = administered;
    const massBalanceResidualMg = Math.abs(totalAdministeredMg - (depot + a1 + a2 + eliminated));

    return {
      points,
      macroConstants: {
        alpha,
        beta,
        alphaHalfLifeH,
        betaHalfLifeH,
        vssL: k21 > 0 ? v1L * (1 + k12 / k21) : (k12 > 0 ? Infinity : v1L)
      },
      peakCentralConc,
      peakPeripheralMg,
      totalAdministeredMg,
      massBalanceResidualMg
    };
  }

  /**
   * Sweeps practical dosing intervals and rounded unit doses to find steady-state regimens
   * satisfying therapeutic window [MEC, MTC] and trough targets, plus recommended loading dose.
   */
  function solveOptimalRegimens(drug, patient) {
    const pk = derivePatientPK(drug, patient);
    const intervals = [6, 8, 12, 24, 36, 48];
    const step = Math.max(25, Number(drug.doseStepMg || 100));
    const baseDose = Number(drug.defaultDoseMg || 500);
    const maxDose = Math.max(baseDose * 3, step * 15);
    const mec = Number(drug.mecMgL);
    const mtc = Number(drug.mtcMgL);
    const F = clamp(Number(drug.bioavailabilityF ?? 1.0), 0, 1.0);

    if (!(Number.isFinite(mec) && mec >= 0 && Number.isFinite(mtc) && mtc > mec)) {
      throw new Error("therapeutic window requires finite mecMgL >= 0 and mtcMgL > mecMgL");
    }

    const candidates = [];
    for (let i = 0; i < intervals.length; i++) {
      const tau = intervals[i];
      // Analytical ideal maintenance dose for midpoint steady-state average. For F = 0 no dose
      // is absorbable, so the sweep just exercises the largest deliverable dose and stays honest.
      const targetMid = 0.5 * (mec + mtc);
      const Feff = drug.route === "oral" ? F : 1; // IV routes are fully bioavailable
      const idealDose = Feff > 0 ? (targetMid * pk.clLPerH * tau) / Feff : maxDose;
      const centerStep = Math.max(step, Math.round(idealDose / step) * step);

      const tried = new Set();
      for (let delta = -3; delta <= 3; delta++) {
        const d = clamp(centerStep + delta * step, step, maxDose);
        if (tried.has(d)) continue;
        tried.add(d);

        const sim = simulate1Compartment({
          vdL: pk.vdL,
          kePerH: pk.kePerH,
          kaPerH: drug.kaPerH,
          bioavailabilityF: F,
          route: drug.route,
          infusionDurationH: drug.infusionDurationH,
          doseMg: d,
          intervalH: tau,
          numDoses: Math.max(6, Math.ceil((5 * pk.halfLifeH) / tau) + 1),
          mecMgL: mec,
          mtcMgL: mtc,
          dtH: 0.1
        });

        const peak = sim.summary.lastIntervalPeak;
        const trough = sim.summary.lastIntervalTrough;
        const inWindow = peak <= mtc && trough >= mec;
        const marginToToxic = mtc - peak;
        const marginToEffective = trough - mec;
        const minMargin = Math.min(marginToToxic, marginToEffective);
        const loadingRaw = d / Math.max(1e-6, 1 - Math.exp(-pk.kePerH * tau));
        const loadingRounded = Math.round(loadingRaw / step) * step;

        candidates.push({
          doseMg: d,
          intervalH: tau,
          dailyDoseMg: (d * 24) / tau,
          loadingDoseMg: Math.max(d, loadingRounded),
          cssPeak: peak,
          cssTrough: trough,
          cssAvg: sim.summary.cssAvg,
          accumIndex: sim.summary.accumIndex,
          timeInWindowPct: sim.summary.timeInWindowPct,
          inWindow,
          score: (inWindow ? 1000 : 0) + sim.summary.timeInWindowPct * 2 + minMargin * 5
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score || a.dailyDoseMg - b.dailyDoseMg);
    return {
      pk,
      best: candidates[0] || null,
      topCandidates: candidates.slice(0, 6)
    };
  }

  // Cells can only ever carry plain numbers. A finite check keeps NaN/Infinity from reaching
  // the file, and staying strictly numeric means no cell can start with =, +, - or @, which is
  // what a spreadsheet would otherwise execute as a formula on import.
  function csvNum(v, digits) {
    return Number.isFinite(v) ? v.toFixed(digits) : "";
  }

  function exportSeriesToCsv(simResult, comparisonResult) {
    const header = comparisonResult
      ? "time_h,nominal_conc_mg_l,comparison_conc_mg_l"
      : "time_h,nominal_conc_mg_l";
    const lines = [header];
    const pts = simResult && simResult.points ? simResult.points : [];
    const cmp = comparisonResult && comparisonResult.points ? comparisonResult.points : [];
    for (let i = 0; i < pts.length; i++) {
      const t = csvNum(pts[i].timeH, 2);
      const c1 = csvNum(pts[i].conc, 4);
      if (comparisonResult) {
        const c2 = cmp[i] ? csvNum(cmp[i].conc, 4) : "";
        lines.push(`${t},${c1},${c2}`);
      } else {
        lines.push(`${t},${c1}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * Canonical JSON per ECMA-262: every object key is emitted in sorted order at every depth, so
   * the same payload always serializes to the same bytes and hashes deterministically.
   */
  function canonicalJson(value) {
    const walk = (v) => {
      if (v === null || typeof v !== "object") return v;
      if (Array.isArray(v)) return v.map(walk);
      const out = Object.create(null); // a __proto__ key must not silently rewrite the prototype
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      return out;
    };
    return JSON.stringify(walk(value));
  }

  // Small self-contained SHA-256 (FIPS 180-4) so exports keep their integrity digest offline,
  // with no dependency on crypto.subtle being present (it is absent in some non-secure contexts).
  function sha256Hex(text) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const rr = (x, n) => (x >>> n) | (x << (32 - n));
    const bytes = [];
    if (typeof TextEncoder !== "undefined") {
      const u8 = new TextEncoder().encode(text);
      for (let i = 0; i < u8.length; i++) bytes.push(u8[i]);
    } else {
      const s = unescape(encodeURIComponent(text));
      for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
    }
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 4294967296);
    const lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
    bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Int32Array(64);
    for (let blk = 0; blk < bytes.length; blk += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = (bytes[blk + i * 4] << 24) | (bytes[blk + i * 4 + 1] << 16) | (bytes[blk + i * 4 + 2] << 8) | bytes[blk + i * 4 + 3];
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }

  /**
   * Serialize a report payload: canonical bytes plus a SHA-256 digest field, so a downloaded
   * JSON report proves byte-level integrity when re-opened or attached to a lab notebook.
   */
  function exportReportJson(payload) {
    const body = Object.assign({}, payload);
    const canonical = canonicalJson(body);
    body.integrity = { algorithm: "SHA-256", canonicalJsonSha256: sha256Hex(canonical) };
    return { json: JSON.stringify(body, null, 2), canonical, sha256: body.integrity.canonicalJsonSha256 };
  }

  return {
    PRESET_DRUGS,
    computePatientMetrics,
    derivePatientPK,
    singleDoseConc1Comp,
    buildDoseSchedule,
    simulate1Compartment,
    simulate2Compartment,
    solveOptimalRegimens,
    exportSeriesToCsv,
    canonicalJson,
    sha256Hex,
    exportReportJson
  };
});
