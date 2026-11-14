(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DoseKineticsApp = factory(root.DoseKineticsEngine, root.DoseKineticsSvg);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine, Svg) {
  "use strict";

  function createController(doc) {
    const d = doc || (typeof document !== "undefined" ? document : null);
    if (!d) return null;

    const state = {
      drugId: Engine.PRESET_DRUGS[0].id,
      route: Engine.PRESET_DRUGS[0].route,
      doseMg: Engine.PRESET_DRUGS[0].defaultDoseMg,
      intervalH: Engine.PRESET_DRUGS[0].defaultIntervalH,
      numDoses: 8,
      loadingDoseMg: 0,
      infusionDurationH: Engine.PRESET_DRUGS[0].infusionDurationH || 1.0,
      kaPerH: Engine.PRESET_DRUGS[0].kaPerH,
      bioavailabilityF: Engine.PRESET_DRUGS[0].bioavailabilityF,
      mecMgL: Engine.PRESET_DRUGS[0].mecMgL,
      mtcMgL: Engine.PRESET_DRUGS[0].mtcMgL,
      sex: "male",
      age: 48,
      weightKg: 76,
      heightCm: 175,
      serumCreatinine: 1.0,
      perturbType: "none",
      perturbIndex: 4,
      delayHours: 4
    };

    const $ = (id) => d.getElementById(id);

    function currentDrug() {
      return Engine.PRESET_DRUGS.find((x) => x.id === state.drugId) || Engine.PRESET_DRUGS[0];
    }

    function applyPreset(drugId) {
      const drug = Engine.PRESET_DRUGS.find((x) => x.id === drugId);
      if (!drug) return;
      state.drugId = drug.id;
      state.route = drug.route;
      state.doseMg = drug.defaultDoseMg;
      state.intervalH = drug.defaultIntervalH;
      state.infusionDurationH = drug.infusionDurationH || 1.0;
      state.kaPerH = drug.kaPerH;
      state.bioavailabilityF = drug.bioavailabilityF;
      state.mecMgL = drug.mecMgL;
      state.mtcMgL = drug.mtcMgL;
      state.loadingDoseMg = 0;
      syncInputsFromState();
      render();
    }

    function syncInputsFromState() {
      const map = {
        "drug-select": state.drugId,
        "route-select": state.route,
        "dose-input": state.doseMg,
        "interval-select": String(state.intervalH),
        "num-doses-input": state.numDoses,
        "loading-input": state.loadingDoseMg,
        "mec-input": state.mecMgL,
        "mtc-input": state.mtcMgL,
        "sex-select": state.sex,
        "age-input": state.age,
        "weight-input": state.weightKg,
        "height-input": state.heightCm,
        "scr-input": state.serumCreatinine,
        "perturb-type": state.perturbType,
        "perturb-index": state.perturbIndex,
        "delay-hours": state.delayHours
      };
      for (const [id, val] of Object.entries(map)) {
        const node = $(id);
        if (node) node.value = String(val);
      }
    }

    function bindTabs() {
      const tabs = d.querySelectorAll(".tab");
      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          tabs.forEach((t) => t.setAttribute("aria-selected", "false"));
          tab.setAttribute("aria-selected", "true");
          const target = tab.getAttribute("aria-controls");
          d.querySelectorAll(".panel").forEach((p) => {
            p.classList.toggle("is-active", p.id === target);
          });
        });
      });
    }

    function bindInputs() {
      const onChange = (id, fn) => {
        const el = $(id);
        if (el) {
          el.addEventListener("input", () => { fn(el.value); render(); });
          el.addEventListener("change", () => { fn(el.value); render(); });
        }
      };

      const drugSel = $("drug-select");
      if (drugSel) {
        drugSel.addEventListener("change", () => applyPreset(drugSel.value));
      }

      onChange("route-select", (v) => { state.route = v; });
      onChange("dose-input", (v) => { state.doseMg = Math.max(25, Number(v) || 250); });
      onChange("interval-select", (v) => { state.intervalH = Math.max(4, Number(v) || 12); });
      onChange("num-doses-input", (v) => { state.numDoses = Math.min(20, Math.max(2, Math.round(Number(v) || 8))); });
      onChange("loading-input", (v) => { state.loadingDoseMg = Math.max(0, Number(v) || 0); });
      onChange("mec-input", (v) => { state.mecMgL = Math.max(0.1, Number(v) || 1); });
      onChange("mtc-input", (v) => { state.mtcMgL = Math.max(state.mecMgL + 0.5, Number(v) || 20); });
      onChange("sex-select", (v) => { state.sex = v; });
      onChange("age-input", (v) => { state.age = Math.min(100, Math.max(18, Number(v) || 40)); });
      onChange("weight-input", (v) => { state.weightKg = Math.min(220, Math.max(35, Number(v) || 70)); });
      onChange("height-input", (v) => { state.heightCm = Math.min(220, Math.max(130, Number(v) || 170)); });
      onChange("scr-input", (v) => { state.serumCreatinine = Math.min(10, Math.max(0.4, Number(v) || 1.0)); });
      onChange("perturb-type", (v) => { state.perturbType = v; });
      onChange("perturb-index", (v) => { state.perturbIndex = Math.max(1, Math.round(Number(v) || 4)); });
      onChange("delay-hours", (v) => { state.delayHours = Math.max(1, Number(v) || 4); });

      const loadBtn = $("btn-auto-loading");
      if (loadBtn) {
        loadBtn.addEventListener("click", () => {
          const drug = currentDrug();
          const pk = Engine.derivePatientPK(drug, state);
          const rec = Math.round((state.doseMg / (1 - Math.exp(-pk.kePerH * state.intervalH))) / 50) * 50;
          state.loadingDoseMg = rec;
          syncInputsFromState();
          render();
        });
      }

      const csvBtn = $("btn-export-csv");
      if (csvBtn) {
        csvBtn.addEventListener("click", () => {
          const out = buildCurrentSimulation();
          const csv = Engine.exportSeriesToCsv(out.nominal, out.hasCompare ? out.comparison : null);
          triggerDownload("dosekinetics_curve.csv", csv, "text/csv");
        });
      }

      const jsonBtn = $("btn-export-json");
      if (jsonBtn) {
        jsonBtn.addEventListener("click", () => {
          const out = buildCurrentSimulation();
          const payload = {
            disclaimer: "Educational pharmacokinetic simulation fixture output only. Not medical advice.",
            drug: currentDrug().name,
            patient: out.pk.metrics,
            derivedPK: {
              vdL: Number(out.pk.vdL.toFixed(2)),
              clLPerH: Number(out.pk.clLPerH.toFixed(3)),
              kePerH: Number(out.pk.kePerH.toFixed(4)),
              halfLifeH: Number(out.pk.halfLifeH.toFixed(2))
            },
            regimen: {
              route: state.route,
              doseMg: state.doseMg,
              loadingDoseMg: state.loadingDoseMg,
              intervalH: state.intervalH,
              numDoses: state.numDoses
            },
            summary: out.nominal.summary
          };
          triggerDownload("dosekinetics_report.json", JSON.stringify(payload, null, 2), "application/json");
        });
      }
    }

    function triggerDownload(filename, content, mime) {
      if (typeof Blob === "undefined" || !d.createElement) return;
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = d.createElement("a");
      a.href = url;
      a.download = filename;
      d.body.appendChild(a);
      a.click();
      d.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function buildCurrentSimulation() {
      const drug = currentDrug();
      const pk = Engine.derivePatientPK(drug, state);
      const nominal = Engine.simulate1Compartment({
        vdL: pk.vdL,
        kePerH: pk.kePerH,
        kaPerH: state.kaPerH,
        bioavailabilityF: state.bioavailabilityF,
        route: state.route,
        infusionDurationH: state.infusionDurationH,
        doseMg: state.doseMg,
        loadingDoseMg: state.loadingDoseMg,
        intervalH: state.intervalH,
        numDoses: state.numDoses,
        mecMgL: state.mecMgL,
        mtcMgL: state.mtcMgL,
        dtH: 0.1
      });

      const hasCompare = state.perturbType !== "none";
      const comparison = hasCompare
        ? Engine.simulate1Compartment({
            vdL: pk.vdL,
            kePerH: pk.kePerH,
            kaPerH: state.kaPerH,
            bioavailabilityF: state.bioavailabilityF,
            route: state.route,
            infusionDurationH: state.infusionDurationH,
            doseMg: state.doseMg,
            loadingDoseMg: state.loadingDoseMg,
            intervalH: state.intervalH,
            numDoses: state.numDoses,
            mecMgL: state.mecMgL,
            mtcMgL: state.mtcMgL,
            perturbType: state.perturbType,
            perturbIndex: state.perturbIndex,
            delayHours: state.delayHours,
            dtH: 0.1
          })
        : null;

      const v1Fraction = clampFrac(drug.v1Fraction || 0.5);
      const v1L = pk.vdL * v1Fraction;
      const k10PerH = pk.clLPerH / v1L;
      const sim2 = Engine.simulate2Compartment({
        v1L,
        k10PerH,
        k12PerH: drug.k12PerH,
        k21PerH: drug.k21PerH,
        route: state.route,
        kaPerH: state.kaPerH,
        bioavailabilityF: state.bioavailabilityF,
        infusionDurationH: state.infusionDurationH,
        doseMg: state.doseMg,
        intervalH: state.intervalH,
        numDoses: Math.min(6, state.numDoses),
        dtH: 0.05
      });

      const optimizer = Engine.solveOptimalRegimens(
        Object.assign({}, drug, {
          route: state.route,
          mecMgL: state.mecMgL,
          mtcMgL: state.mtcMgL
        }),
        state
      );

      return { drug, pk, nominal, comparison, hasCompare, sim2, optimizer };
    }

    function clampFrac(x) {
      return Math.min(0.95, Math.max(0.2, Number(x) || 0.5));
    }

    function setText(id, val) {
      const node = $(id);
      if (node) node.textContent = val;
    }

    function render() {
      const { drug, pk, nominal, comparison, hasCompare, sim2, optimizer } = buildCurrentSimulation();
      const s = nominal.summary;

      setText("kpi-crcl", `${pk.metrics.crClMlMin.toFixed(1)} mL/min`);
      setText("kpi-crcl-sub", `${pk.metrics.weightBasis} (${pk.metrics.dosingWeightKg.toFixed(1)} kg)`);
      setText("kpi-halflife", `${s.halfLifeH.toFixed(2)} h`);
      setText("kpi-halflife-sub", `CL ${pk.clLPerH.toFixed(2)} L/h | Vd ${pk.vdL.toFixed(1)} L`);
      setText("kpi-css", `${s.lastIntervalPeak.toFixed(1)} / ${s.lastIntervalTrough.toFixed(1)} mg/L`);
      setText("kpi-css-sub", `Avg ${s.cssAvg.toFixed(1)} mg/L | R_acc ${s.accumIndex.toFixed(2)}x`);
      setText("kpi-tiw", `${s.timeInWindowPct.toFixed(1)}%`);
      setText("kpi-tiw-sub", `Toxic ${s.toxicPct.toFixed(1)}% | Sub-MEC ${s.subTherapeuticPct.toFixed(1)}%`);

      setText("drug-note", drug.note);

      if (Svg) {
        Svg.render1CompChart($("chart-1comp"), {
          nominal,
          comparison: hasCompare ? comparison : null,
          mecMgL: state.mecMgL,
          mtcMgL: state.mtcMgL
        });
        Svg.render2CompChart($("chart-2comp"), sim2);
      }

      // 2-compartment telemetry
      const m = sim2.macroConstants;
      setText("two-alpha", `${m.alpha.toFixed(3)} /h (t1/2 ${m.alphaHalfLifeH.toFixed(2)} h)`);
      setText("two-beta", `${m.beta.toFixed(3)} /h (t1/2 ${m.betaHalfLifeH.toFixed(2)} h)`);
      setText("two-vss", `${m.vssL.toFixed(1)} L`);
      setText("two-mass", `${sim2.massBalanceResidualMg.toExponential(2)} mg residual`);

      // Renal & formula breakdown
      setText("calc-ibw", `IBW = ${pk.metrics.idealBodyWeightKg.toFixed(1)} kg (Devine ${pk.metrics.sex}, ${state.heightCm} cm)`);
      setText("calc-crcl", `CrCl = ((140 - ${state.age}) * ${pk.metrics.dosingWeightKg.toFixed(1)} * ${state.sex === "female" ? "0.85" : "1.00"}) / (72 * ${state.serumCreatinine}) = ${pk.metrics.crClMlMin.toFixed(1)} mL/min`);
      setText("calc-cl", `CL_pt = ${drug.clRefLPerH.toFixed(2)} * [(1 - ${drug.renalFractionFr}) + ${drug.renalFractionFr} * (${pk.metrics.crClMlMin.toFixed(1)} / ${drug.crClRefMlMin})] = ${pk.clLPerH.toFixed(2)} L/h`);
      setText("calc-ke", `ke = CL_pt / Vd = ${pk.clLPerH.toFixed(2)} / ${pk.vdL.toFixed(1)} = ${pk.kePerH.toFixed(4)} /h (t1/2 = ${pk.halfLifeH.toFixed(2)} h)`);

      // Optimizer table
      const optBody = $("optimizer-body");
      if (optBody) {
        optBody.innerHTML = "";
        optimizer.topCandidates.forEach((cand, idx) => {
          const tr = d.createElement("tr");
          tr.innerHTML = `
            <td>${idx + 1}</td>
            <td>${cand.doseMg} mg q${cand.intervalH}h</td>
            <td>${cand.loadingDoseMg} mg</td>
            <td>${cand.cssPeak.toFixed(1)}</td>
            <td>${cand.cssTrough.toFixed(1)}</td>
            <td>${cand.timeInWindowPct.toFixed(0)}%</td>
            <td><span class="${cand.inWindow ? "pill-ok" : "pill-warn"}">${cand.inWindow ? "In Window" : "Out of Band"}</span></td>
          `;
          optBody.appendChild(tr);
        });
      }

      // What-if comparison readout
      if (hasCompare && comparison) {
        const diffPeak = comparison.summary.peakConc - nominal.summary.peakConc;
        const diffTiw = comparison.summary.timeInWindowPct - nominal.summary.timeInWindowPct;
        setText(
          "perturb-summary",
          `Comparison (${state.perturbType} at dose #${state.perturbIndex}): Peak ${comparison.summary.peakConc.toFixed(1)} mg/L (${diffPeak >= 0 ? "+" : ""}${diffPeak.toFixed(1)}), Time in Window ${comparison.summary.timeInWindowPct.toFixed(1)}% (${diffTiw >= 0 ? "+" : ""}${diffTiw.toFixed(1)}%).`
        );
      } else {
        setText("perturb-summary", "No perturbation active. Select Miss, Double, or Delay on a dose number to overlay the perturbed plasma curve.");
      }

      // Accessible curve sample table (every 4 hours)
      const curveBody = $("curve-table-body");
      if (curveBody) {
        curveBody.innerHTML = "";
        const stride = Math.max(1, Math.round(4 / 0.1));
        for (let i = 0; i < nominal.points.length; i += stride) {
          const p = nominal.points[i];
          const cp = hasCompare && comparison.points[i] ? comparison.points[i].conc.toFixed(2) : "-";
          const zone = p.conc > state.mtcMgL ? "Above MTC" : p.conc < state.mecMgL ? "Below MEC" : "Therapeutic";
          const tr = d.createElement("tr");
          tr.innerHTML = `<td>${p.timeH.toFixed(1)} h</td><td>${p.conc.toFixed(2)} mg/L</td><td>${cp}</td><td>${zone}</td>`;
          curveBody.appendChild(tr);
        }
      }
    }

    function init() {
      const sel = $("drug-select");
      if (sel && sel.options.length === 0) {
        Engine.PRESET_DRUGS.forEach((drug) => {
          const opt = d.createElement("option");
          opt.value = drug.id;
          opt.textContent = drug.name;
          sel.appendChild(opt);
        });
      }
      bindTabs();
      bindInputs();
      syncInputsFromState();
      render();
    }

    return { init, render, applyPreset, state };
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      const ctrl = createController(document);
      if (ctrl) ctrl.init();
    });
  }

  return { createController };
});
