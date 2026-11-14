(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DoseKineticsSvg = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, text) {
    if (typeof document === "undefined") return null;
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, String(v));
      }
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render1CompChart(svg, opts) {
    if (!svg || typeof document === "undefined") return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const nominal = opts.nominal.points || [];
    const compare = opts.comparison ? opts.comparison.points || [] : [];
    const mec = Number(opts.mecMgL || 0);
    const mtc = Number(opts.mtcMgL || 1);
    const events = opts.nominal.events || [];

    const W = 820;
    const H = 340;
    const padL = 60;
    const padR = 24;
    const padT = 22;
    const padB = 42;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxT = Math.max(1, nominal.length ? nominal[nominal.length - 1].timeH : 48);
    let maxY = Math.max(mtc * 1.25, 5);
    for (let i = 0; i < nominal.length; i++) maxY = Math.max(maxY, nominal[i].conc * 1.12);
    for (let i = 0; i < compare.length; i++) maxY = Math.max(maxY, compare[i].conc * 1.12);

    const xOf = (t) => padL + (t / maxT) * plotW;
    const yOf = (c) => padT + plotH - (c / maxY) * plotH;

    // Background grid
    const gridG = el("g", { class: "chart-grid" });
    for (let i = 0; i <= 5; i++) {
      const yVal = (maxY * i) / 5;
      const yPx = yOf(yVal);
      gridG.appendChild(el("line", { x1: padL, y1: yPx, x2: W - padR, y2: yPx, stroke: "#1f2a38", "stroke-width": 1 }));
      gridG.appendChild(el("text", { x: padL - 8, y: yPx + 4, "text-anchor": "end", fill: "#7d8fa3", "font-size": 11 }, yVal.toFixed(1)));
    }
    const tickStepH = maxT <= 24 ? 4 : maxT <= 72 ? 12 : 24;
    for (let t = 0; t <= maxT + 1e-6; t += tickStepH) {
      const xPx = xOf(t);
      gridG.appendChild(el("line", { x1: xPx, y1: padT, x2: xPx, y2: H - padB, stroke: "#16202b", "stroke-width": 1 }));
      gridG.appendChild(el("text", { x: xPx, y: H - padB + 18, "text-anchor": "middle", fill: "#7d8fa3", "font-size": 11 }, `${Math.round(t)}h`));
    }
    svg.appendChild(gridG);

    // Therapeutic window shaded band [MEC, MTC]
    const yTop = yOf(Math.min(mtc, maxY));
    const yBot = yOf(Math.max(mec, 0));
    if (yBot > yTop) {
      svg.appendChild(
        el("rect", {
          x: padL,
          y: yTop,
          width: plotW,
          height: yBot - yTop,
          fill: "rgba(45, 212, 191, 0.10)"
        })
      );
    }

    // MEC & MTC threshold dashed lines
    svg.appendChild(el("line", { x1: padL, y1: yOf(mec), x2: W - padR, y2: yOf(mec), stroke: "#2dd4bf", "stroke-dasharray": "5 4", "stroke-width": 1.4 }));
    svg.appendChild(el("text", { x: W - padR - 4, y: yOf(mec) - 5, "text-anchor": "end", fill: "#2dd4bf", "font-size": 11 }, `MEC ${mec.toFixed(1)} mg/L`));

    svg.appendChild(el("line", { x1: padL, y1: yOf(mtc), x2: W - padR, y2: yOf(mtc), stroke: "#f59e0b", "stroke-dasharray": "5 4", "stroke-width": 1.4 }));
    svg.appendChild(el("text", { x: W - padR - 4, y: yOf(mtc) - 5, "text-anchor": "end", fill: "#f59e0b", "font-size": 11 }, `MTC ${mtc.toFixed(1)} mg/L`));

    // Dose event ticks along baseline
    for (let i = 0; i < events.length; i++) {
      const xPx = xOf(events[i].timeH);
      if (xPx >= padL && xPx <= W - padR) {
        svg.appendChild(el("line", { x1: xPx, y1: H - padB, x2: xPx, y2: H - padB + 6, stroke: "#38bdf8", "stroke-width": 2 }));
      }
    }

    // Comparison curve (if active)
    if (compare.length > 1) {
      const dCmp = compare
        .map((p, idx) => `${idx === 0 ? "M" : "L"}${xOf(p.timeH).toFixed(2)},${yOf(p.conc).toFixed(2)}`)
        .join(" ");
      svg.appendChild(el("path", { d: dCmp, fill: "none", stroke: "#fb7185", "stroke-width": 2.2, "stroke-dasharray": "6 3" }));
    }

    // Nominal curve
    if (nominal.length > 1) {
      const dNom = nominal
        .map((p, idx) => `${idx === 0 ? "M" : "L"}${xOf(p.timeH).toFixed(2)},${yOf(p.conc).toFixed(2)}`)
        .join(" ");
      svg.appendChild(el("path", { d: dNom, fill: "none", stroke: "#38bdf8", "stroke-width": 2.6 }));
    }

    // Axes labels
    svg.appendChild(el("text", { x: padL + plotW / 2, y: H - 6, "text-anchor": "middle", fill: "#94a3b8", "font-size": 12 }, "Elapsed Time (hours)"));
    svg.appendChild(
      el(
        "text",
        {
          x: 16,
          y: padT + plotH / 2,
          "text-anchor": "middle",
          fill: "#94a3b8",
          "font-size": 12,
          transform: `rotate(-90 16 ${padT + plotH / 2})`
        },
        "Plasma Conc (mg/L)"
      )
    );
  }

  function render2CompChart(svg, sim2) {
    if (!svg || typeof document === "undefined") return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const pts = sim2.points || [];
    const W = 820;
    const H = 320;
    const padL = 60;
    const padR = 64;
    const padT = 22;
    const padB = 40;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxT = Math.max(1, pts.length ? pts[pts.length - 1].timeH : 48);
    let maxConc = 1;
    let maxPeriph = 1;
    for (let i = 0; i < pts.length; i++) {
      maxConc = Math.max(maxConc, pts[i].centralConc * 1.12);
      maxPeriph = Math.max(maxPeriph, pts[i].peripheralMg * 1.12);
    }

    const xOf = (t) => padL + (t / maxT) * plotW;
    const yConc = (c) => padT + plotH - (c / maxConc) * plotH;
    const yPer = (m) => padT + plotH - (m / maxPeriph) * plotH;

    for (let i = 0; i <= 4; i++) {
      const yPx = padT + (plotH * i) / 4;
      svg.appendChild(el("line", { x1: padL, y1: yPx, x2: W - padR, y2: yPx, stroke: "#1f2a38", "stroke-width": 1 }));
      const cLab = maxConc * (1 - i / 4);
      const pLab = maxPeriph * (1 - i / 4);
      svg.appendChild(el("text", { x: padL - 8, y: yPx + 4, "text-anchor": "end", fill: "#38bdf8", "font-size": 11 }, cLab.toFixed(1)));
      svg.appendChild(el("text", { x: W - padR + 8, y: yPx + 4, "text-anchor": "start", fill: "#a78bfa", "font-size": 11 }, pLab.toFixed(0)));
    }

    const dCentral = pts.map((p, idx) => `${idx === 0 ? "M" : "L"}${xOf(p.timeH).toFixed(2)},${yConc(p.centralConc).toFixed(2)}`).join(" ");
    const dPeriph = pts.map((p, idx) => `${idx === 0 ? "M" : "L"}${xOf(p.timeH).toFixed(2)},${yPer(p.peripheralMg).toFixed(2)}`).join(" ");

    svg.appendChild(el("path", { d: dPeriph, fill: "none", stroke: "#a78bfa", "stroke-width": 2.2, "stroke-dasharray": "5 3" }));
    svg.appendChild(el("path", { d: dCentral, fill: "none", stroke: "#38bdf8", "stroke-width": 2.6 }));

    svg.appendChild(el("text", { x: padL + plotW / 2, y: H - 6, "text-anchor": "middle", fill: "#94a3b8", "font-size": 12 }, "Elapsed Time (hours)"));
    svg.appendChild(el("text", { x: padL + 6, y: padT + 14, fill: "#38bdf8", "font-size": 11 }, "Central Plasma C1 (mg/L)"));
    svg.appendChild(el("text", { x: W - padR - 6, y: padT + 14, "text-anchor": "end", fill: "#a78bfa", "font-size": 11 }, "Peripheral Compartment A2 (mg)"));
  }

  return { render1CompChart, render2CompChart };
});
