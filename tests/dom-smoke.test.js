const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Lightweight deterministic DOM mock verifying index.html + app.js + pk-engine.js integration with zero network calls.
function makeMockElement(tag, id = "") {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    options: [],
    children: [],
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._set.has(c)) this._set.delete(c);
          else this._set.add(c);
        } else if (force) this._set.add(c);
        else this._set.delete(c);
      },
      contains(c) { return this._set.has(c); }
    },
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    addEventListener(ev, fn) {
      listeners[ev] = listeners[ev] || [];
      listeners[ev].push(fn);
    },
    dispatchEvent(ev) {
      for (const fn of listeners[ev.type] || []) fn(ev);
    },
    appendChild(child) {
      this.children.push(child);
      if (this.tagName === "SELECT" && child.tagName === "OPTION") {
        this.options.push(child);
      }
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
    },
    get firstChild() {
      return this.children[0] || null;
    }
  };
  return el;
}

test("DOM smoke: index.html loads all expected control IDs and DoseKineticsApp binds & renders cleanly", () => {
  const rootDir = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");

  const requiredIds = [
    "drug-select", "route-select", "dose-input", "interval-select", "num-doses-input",
    "loading-input", "mec-input", "mtc-input", "sex-select", "age-input", "weight-input",
    "height-input", "scr-input", "perturb-type", "perturb-index", "delay-hours",
    "btn-auto-loading", "btn-export-csv", "btn-export-json",
    "kpi-crcl", "kpi-halflife", "kpi-css", "kpi-tiw",
    "chart-1comp", "chart-2comp", "optimizer-body", "curve-table-body", "perturb-summary"
  ];

  const byId = new Map();
  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `Missing element #${id} in index.html`);
    const tag = id.includes("select") ? "select" : id.includes("input") ? "input" : id.includes("btn") ? "button" : id.includes("chart") ? "svg" : "div";
    byId.set(id, makeMockElement(tag, id));
  }

  const tabs = ["tab-curves", "tab-twocomp", "tab-renal", "tab-optimizer"].map((id, idx) => {
    const t = makeMockElement("button", id);
    t.setAttribute("aria-controls", ["panel-curves", "panel-twocomp", "panel-renal", "panel-optimizer"][idx]);
    t.setAttribute("aria-selected", idx === 0 ? "true" : "false");
    return t;
  });
  const panels = ["panel-curves", "panel-twocomp", "panel-renal", "panel-optimizer"].map((id, idx) => {
    const p = makeMockElement("div", id);
    if (idx === 0) p.classList.add("is-active");
    return p;
  });

  const doc = {
    body: makeMockElement("body"),
    getElementById(id) { return byId.get(id) || null; },
    createElement(tag) { return makeMockElement(tag); },
    createElementNS(_ns, tag) { return makeMockElement(tag); },
    querySelectorAll(sel) {
      if (sel === ".tab") return tabs;
      if (sel === ".panel") return panels;
      return [];
    },
    addEventListener() {}
  };

  const Engine = require("../js/pk-engine.js");
  const svgCtx = { document: doc, Math, Number, Object, String };
  svgCtx.globalThis = svgCtx;
  vm.runInNewContext(fs.readFileSync(path.join(rootDir, "js/ui-svg.js"), "utf8"), svgCtx);
  const Svg = svgCtx.DoseKineticsSvg;

  // Load app.js via factory with mock Engine & Svg
  const sandbox = { document: doc, Math, Number, Object, String, URL, Blob: function () {} };
  sandbox.globalThis = sandbox;
  sandbox.DoseKineticsEngine = Engine;
  sandbox.DoseKineticsSvg = Svg;
  vm.runInNewContext(fs.readFileSync(path.join(rootDir, "js/app.js"), "utf8"), sandbox);

  const ctrl = sandbox.DoseKineticsApp.createController(doc);
  ctrl.init();

  assert.equal(byId.get("drug-select").options.length, 5);
  assert.ok(byId.get("kpi-crcl").textContent.includes("mL/min"));
  assert.ok(byId.get("kpi-halflife").textContent.includes("h"));
  assert.ok(byId.get("kpi-css").textContent.includes("mg/L"));
  assert.ok(byId.get("chart-1comp").children.length > 5);
  assert.ok(byId.get("chart-2comp").children.length > 4);
  assert.equal(byId.get("optimizer-body").children.length, 6);
  assert.ok(byId.get("curve-table-body").children.length > 10);

  // Switch preset and solve loading dose
  ctrl.applyPreset("theophylline-oral");
  assert.equal(byId.get("dose-input").value, "300");
  byId.get("btn-auto-loading").dispatchEvent({ type: "click" });
  assert.ok(Number(byId.get("loading-input").value) >= 300);

  // Activate missed dose perturbation
  byId.get("perturb-type").value = "miss";
  byId.get("perturb-type").dispatchEvent({ type: "change" });
  assert.ok(byId.get("perturb-summary").textContent.includes("miss at dose"));

  // Switch tabs
  tabs[2].dispatchEvent({ type: "click" });
  assert.equal(tabs[2].getAttribute("aria-selected"), "true");
  assert.ok(panels[2].classList.contains("is-active"));
});
