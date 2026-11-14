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

  /**
   * Computes Devine Ideal Body Weight (kg), dosing weight (kg), and Cockcroft-Gault CrCl (mL/min).
   * Height in cm, weight in kg, age in years, serumCreatinine in mg/dL, sex in ("male" | "female").
   */
  function computePatientMetrics(patient) {
    const age = Number(patient.age);
    const weightKg = Number(patient.weightKg);
    const heightCm = Number(patient.heightCm);
    const serumCreatinine = Number(patient.serumCreatinine);
    const sex = patient.sex === "female" ? "female" : "male";

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
    const crClRefMlMin = Number(drug.crClRefMlMin || 100);
    const fr = clamp(Number(drug.renalFractionFr ?? 0.5), 0, 1);

    assertPositive(vdLPerKg, "vdLPerKg");
    assertPositive(clRefLPerH, "clRefLPerH");
    assertPositive(crClRefMlMin, "crClRefMlMin");

    const vdL = vdLPerKg * metrics.dosingWeightKg;
    const renalRatio = metrics.crClMlMin / crClRefMlMin;
    const clMultiplier = (1 - fr) + fr * renalRatio;
    const clLPerH = clRefLPerH * clMultiplier;
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
  function singleDoseConc1Comp(dt, doseMg, route, params) {
    if (dt < 0 || doseMg <= 0) return 0;
    const vdL = params.vdL;
    const ke = params.kePerH;

    if (route === "bolus") {
      return (doseMg / vdL) * Math.exp(-ke * dt);
    }

    if (route === "infusion") {
      const tInf = Math.max(0.05, Number(params.infusionDurationH || 1.0));
      const rate = doseMg / tInf;
      const cl = ke * vdL;
      if (dt <= tInf) {
        return (rate / cl) * (1 - Math.exp(-ke * dt));
      }
      const cEnd = (rate / cl) * (1 - Math.exp(-ke * tInf));
      return cEnd * Math.exp(-ke * (dt - tInf));
    }

    // First-order oral / extravascular Bateman equation
    const F = clamp(Number(params.bioavailabilityF ?? 1.0), 0.01, 1.0);
    const ka = Number(params.kaPerH || 1.2);
    if (Math.abs(ka - ke) < 1e-5) {
      return ((F * doseMg) / vdL) * ke * dt * Math.exp(-ke * dt);
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
    const numDoses = Math.max(1, Math.round(Number(options.numDoses || 8)));
    const loadingDoseMg = Number(options.loadingDoseMg || 0);
    const perturbIndex = Math.round(Number(options.perturbIndex || 0)); // 1-based
    const perturbType = options.perturbType || "none"; // "none" | "miss" | "double" | "delay"
    const delayHours = Math.max(0, Number(options.delayHours || 0));

    assertPositive(doseMg, "doseMg");
    assertPositive(intervalH, "intervalH");

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
    const route = options.route || "oral";
    const intervalH = Number(options.intervalH);
    const numDoses = Math.max(1, Math.round(Number(options.numDoses || 8)));
    const mec = Number(options.mecMgL ?? 0);
    const mtc = Number(options.mtcMgL ?? Infinity);
    const dtH = options.dtH === undefined ? 0.1 : Number(options.dtH);
    const totalHorizonH = options.horizonH === undefined ? numDoses * intervalH : Number(options.horizonH);

    assertPositive(vdL, "vdL");
    assertPositive(kePerH, "kePerH");
    assertPositive(intervalH, "intervalH");
    assertPositive(dtH, "dtH");

    const events = options.events || buildDoseSchedule(options);
    const steps = Math.max(2, Math.round(totalHorizonH / dtH));
    const points = [];
    const params = {
      vdL,
      kePerH,
      kaPerH: Number(options.kaPerH || 1.2),
      bioavailabilityF: Number(options.bioavailabilityF ?? 1.0),
      infusionDurationH: Number(options.infusionDurationH || 1.0)
    };

    let peakC = 0;
    let peakTimeH = 0;
    let inWindowCount = 0;
    let toxicCount = 0;
    let subTherapeuticCount = 0;
    let aucTotal = 0;

    for (let s = 0; s <= steps; s++) {
      const t = Number((s * dtH).toFixed(4));
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

    // Analytical steady-state metrics for constant maintenance dose & interval
    const doseMg = Number(options.doseMg);
    const F = clamp(Number(options.bioavailabilityF ?? 1.0), 0.01, 1.0);
    const cl = kePerH * vdL;
    const expKeTau = Math.exp(-kePerH * intervalH);
    const accumIndex = 1 / Math.max(1e-9, 1 - expKeTau);
    const cssAvg = (F * doseMg) / (cl * intervalH);

    // Numerical steady-state peak & trough over the last dosing interval of nominal schedule
    const lastIntervalStart = (numDoses - 1) * intervalH;
    let lastIntervalPeak = 0;
    let lastIntervalTrough = Infinity;
    let lastIntervalAuc = 0;
    for (let s = 0; s < points.length; s++) {
      const pt = points[s];
      if (pt.timeH >= lastIntervalStart - 1e-6 && pt.timeH <= lastIntervalStart + intervalH + 1e-6) {
        if (pt.conc > lastIntervalPeak) lastIntervalPeak = pt.conc;
        if (pt.conc < lastIntervalTrough) lastIntervalTrough = pt.conc;
        if (s > 0 && points[s - 1].timeH >= lastIntervalStart - 1e-6) {
          lastIntervalAuc += 0.5 * (points[s - 1].conc + pt.conc) * dtH;
        }
      }
    }
    if (!Number.isFinite(lastIntervalTrough)) lastIntervalTrough = 0;

    // Exact bolus / infusion analytical steady-state peak & trough for validation
    let cssMaxAnalytical = lastIntervalPeak;
    let cssMinAnalytical = lastIntervalTrough;
    if (route === "bolus") {
      cssMaxAnalytical = (doseMg / vdL) * accumIndex;
      cssMinAnalytical = cssMaxAnalytical * expKeTau;
    } else if (route === "infusion") {
      const tInf = Math.max(0.05, Number(options.infusionDurationH || 1.0));
      const rate = doseMg / tInf;
      if (tInf <= intervalH) {
        cssMaxAnalytical = (rate / cl) * ((1 - Math.exp(-kePerH * tInf)) / (1 - expKeTau));
        cssMinAnalytical = cssMaxAnalytical * Math.exp(-kePerH * (intervalH - tInf));
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
    const route = options.route || "bolus";
    const doseMg = Number(options.doseMg);
    const intervalH = Number(options.intervalH || 12);
    const numDoses = Math.max(1, Math.round(Number(options.numDoses || 6)));
    const ka = Number(options.kaPerH || 1.2);
    const F = clamp(Number(options.bioavailabilityF ?? 1.0), 0.01, 1.0);
    const tInf = Math.max(0.05, Number(options.infusionDurationH || 1.0));
    const dtH = Number(options.dtH || 0.025);
    const horizonH = Number(options.horizonH || numDoses * intervalH);

    assertPositive(v1L, "v1L");
    assertPositive(k10, "k10PerH");
    assertNonNegative(k12, "k12PerH");
    assertNonNegative(k21, "k21PerH");
    assertPositive(doseMg, "doseMg");
    assertPositive(dtH, "dtH");

    // Hybrid macro-constants from quadratic eigenvalues of compartment matrix
    const sumRates = k10 + k12 + k21;
    const disc = Math.sqrt(Math.max(0, sumRates * sumRates - 4 * k10 * k21));
    const alpha = 0.5 * (sumRates + disc);
    const beta = 0.5 * (sumRates - disc);
    const alphaHalfLifeH = alpha > 0 ? Math.LN2 / alpha : Infinity;
    const betaHalfLifeH = beta > 0 ? Math.LN2 / beta : Infinity;

    const events = options.events || buildDoseSchedule(options);
    const steps = Math.max(2, Math.round(horizonH / dtH));
    const sampleStride = Math.max(1, Math.round(0.1 / dtH));

    // State: depotMg (gut), a1Mg (central), a2Mg (peripheral)
    let depot = 0;
    let a1 = 0;
    let a2 = 0;
    let eliminated = 0;

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

    function applyDiscreteEvents(tPrev, tCurr) {
      for (let i = 0; i < events.length; i++) {
        if (bolusProcessed.has(i)) continue;
        const ev = events[i];
        if (ev.timeH <= tCurr + 1e-9 && ev.timeH >= tPrev - 1e-9) {
          if (route === "bolus") {
            a1 += ev.doseMg;
            bolusProcessed.add(i);
          } else if (route === "oral") {
            depot += F * ev.doseMg;
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

    applyDiscreteEvents(-1e-9, 0);
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
      const tCurr = s * dtH;
      applyDiscreteEvents(tPrev, tCurr);

      const infRate = infusionRateForStep(tPrev, tCurr);
      const k1 = deriv(infRate, depot, a1, a2);
      const k2 = deriv(
        infRate,
        depot + 0.5 * dtH * k1[0],
        a1 + 0.5 * dtH * k1[1],
        a2 + 0.5 * dtH * k1[2]
      );
      const k3 = deriv(
        infRate,
        depot + 0.5 * dtH * k2[0],
        a1 + 0.5 * dtH * k2[1],
        a2 + 0.5 * dtH * k2[2]
      );
      const k4 = deriv(
        infRate,
        depot + dtH * k3[0],
        a1 + dtH * k3[1],
        a2 + dtH * k3[2]
      );

      depot += (dtH / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      a1 += (dtH / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      a2 += (dtH / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
      eliminated += (dtH / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);

      if (s % sampleStride === 0 || s === steps) {
        points.push({
          timeH: Number(tCurr.toFixed(4)),
          centralConc: Math.max(0, a1 / v1L),
          peripheralMg: Math.max(0, a2),
          centralMg: Math.max(0, a1),
          depotMg: Math.max(0, depot),
          eliminatedMg: Math.max(0, eliminated)
        });
      }
    }

    let peakCentralConc = 0;
    let peakPeripheralMg = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i].centralConc > peakCentralConc) peakCentralConc = points[i].centralConc;
      if (points[i].peripheralMg > peakPeripheralMg) peakPeripheralMg = points[i].peripheralMg;
    }

    const totalAdministeredMg = events.reduce((acc, ev) => acc + (route === "oral" ? F * ev.doseMg : ev.doseMg), 0);
    const massBalanceResidualMg = Math.abs(totalAdministeredMg - (depot + a1 + a2 + eliminated));

    return {
      points,
      macroConstants: {
        alpha,
        beta,
        alphaHalfLifeH,
        betaHalfLifeH,
        vssL: v1L * (1 + (k21 > 0 ? k12 / k21 : 0))
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
    const F = clamp(Number(drug.bioavailabilityF ?? 1.0), 0.01, 1.0);

    const candidates = [];
    for (let i = 0; i < intervals.length; i++) {
      const tau = intervals[i];
      // Analytical ideal maintenance dose for midpoint steady-state average
      const targetMid = 0.5 * (mec + mtc);
      const idealDose = (targetMid * pk.clLPerH * tau) / F;
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

  function exportSeriesToCsv(simResult, comparisonResult) {
    const header = comparisonResult
      ? "time_h,nominal_conc_mg_l,comparison_conc_mg_l"
      : "time_h,nominal_conc_mg_l";
    const lines = [header];
    const pts = simResult.points || [];
    const cmp = comparisonResult ? comparisonResult.points || [] : [];
    for (let i = 0; i < pts.length; i++) {
      const t = pts[i].timeH.toFixed(2);
      const c1 = pts[i].conc.toFixed(4);
      if (comparisonResult) {
        const c2 = cmp[i] ? cmp[i].conc.toFixed(4) : "";
        lines.push(`${t},${c1},${c2}`);
      } else {
        lines.push(`${t},${c1}`);
      }
    }
    return lines.join("\n");
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
    exportSeriesToCsv
  };
});
