// Wave 4 shipped-surface suite: strict CSP, WCAG 2.1.4/2.4.7 affordances, no markup-injection
// sinks, hygiene invariants, and DOM-level behaviour of the tab bar and export buttons.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(rootDir, p), "utf8");
const html = read("index.html");
const css = read("styles.css");
const appSrc = read("js/app.js");
const svgSrc = read("js/ui-svg.js");
const engineSrc = read("js/pk-engine.js");

/* ------------------------------------------------------------------ */
/* Content Security Policy                                              */
/* ------------------------------------------------------------------ */

test("index.html ships a Content-Security-Policy meta tag", () => {
  assert.ok(/<meta\s+http-equiv="Content-Security-Policy"/i.test(html));
});

test("CSP default-src falls back to self only", () => {
  const csp = /content="([^"]+)"/.exec(/<meta\s+http-equiv="Content-Security-Policy"[^>]+>/.exec(html)[0])[1];
  assert.ok(/default-src 'self'/.test(csp));
});

test("CSP restricts script-src to self with no unsafe-inline", () => {
  const csp = /content="([^"]+)"/.exec(/<meta\s+http-equiv="Content-Security-Policy"[^>]+>/.exec(html)[0])[1];
  assert.ok(/script-src 'self'/.test(csp));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "script-src must not allow inline");
  assert.ok(!/unsafe-eval/.test(csp));
});

test("CSP blocks plugins and cross-origin form posts", () => {
  const csp = /content="([^"]+)"/.exec(/<meta\s+http-equiv="Content-Security-Policy"[^>]+>/.exec(html)[0])[1];
  assert.ok(/object-src 'none'/.test(csp));
  assert.ok(/form-action 'none'/.test(csp));
});

test("CSP allows the inline SVG data: favicon only", () => {
  const csp = /content="([^"]+)"/.exec(/<meta\s+http-equiv="Content-Security-Policy"[^>]+>/.exec(html)[0])[1];
  assert.ok(/img-src 'self' data:/.test(csp));
});

test("CSP blocks all network connections (the app is offline)", () => {
  const csp = /content="([^"]+)"/.exec(/<meta\s+http-equiv="Content-Security-Policy"[^>]+>/.exec(html)[0])[1];
  assert.ok(/connect-src 'none'/.test(csp));
});

/* ------------------------------------------------------------------ */
/* Injection sinks                                                      */
/* ------------------------------------------------------------------ */

test("app.js never assigns to innerHTML", () => {
  assert.ok(!/\.innerHTML\s*=[^=]/.test(appSrc), "innerHTML assignment found in app.js");
});

test("ui-svg.js never assigns to innerHTML", () => {
  assert.ok(!/\.innerHTML\s*=[^=]/.test(svgSrc));
});

test("no eval, Function constructor or document.write anywhere", () => {
  for (const [name, src] of [["app.js", appSrc], ["ui-svg.js", svgSrc], ["pk-engine.js", engineSrc]]) {
    assert.ok(!/\beval\s*\(/.test(src), `eval in ${name}`);
    assert.ok(!/new\s+Function\s*\(/.test(src), `Function() in ${name}`);
    assert.ok(!/document\.write/.test(src), `document.write in ${name}`);
  }
});

test("engine values reach the DOM only through textContent/DOM nodes", () => {
  // addCell must be the only path that writes cell text in the two data tables.
  assert.ok(/td\.textContent = text/.test(appSrc));
  assert.ok(!/insertAdjacentHTML/.test(appSrc));
});

test("index.html has no inline event handler attributes", () => {
  assert.ok(!/\son(click|load|error|keydown|keyup|keypress|input|change|mouseover|focus|blur)\s*=/i.test(html));
});

test("index.html loads only same-directory scripts", () => {
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0);
  for (const s of srcs) assert.ok(/^js\//.test(s), `unexpected script src ${s}`);
});

test("index.html links only the local stylesheet", () => {
  const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  for (const h of hrefs) {
    assert.ok(h === "styles.css" || h.startsWith("data:"), `unexpected link href ${h}`);
  }
});

/* ------------------------------------------------------------------ */
/* Accessibility affordances                                            */
/* ------------------------------------------------------------------ */

test("styles.css defines a visible :focus-visible outline (WCAG 2.4.7)", () => {
  assert.ok(/:focus-visible\s*\{[^}]*outline\s*:/s.test(css));
});

test("index.html has no accesskey attribute (WCAG 2.1.4)", () => {
  assert.ok(!/accesskey\s*=/i.test(html));
});

test("tab bar uses tablist/tab/tabpanel roles with aria wiring", () => {
  assert.ok(/role="tablist"/.test(html));
  assert.ok((html.match(/role="tab"/g) || []).length >= 4);
  assert.ok((html.match(/role="tabpanel"/g) || []).length >= 4);
  assert.ok(/aria-controls="panel-/.test(html));
  assert.ok(/aria-labelledby="tab-/.test(html));
});

test("tabs support arrow-key navigation per the APG tabs pattern", () => {
  assert.ok(/ArrowRight/.test(appSrc) && /ArrowLeft/.test(appSrc));
  assert.ok(/"Home"/.test(appSrc) && /"End"/.test(appSrc));
});

test("tabs implement a roving tabindex", () => {
  assert.ok(/tabindex",\s*t === tab \? "0" : "-1"/.test(appSrc));
});

test("all interactive tabs are real buttons with type=button", () => {
  const tabs = [...html.matchAll(/<button[^>]*class="tab"[^>]*>/g)];
  assert.ok(tabs.length >= 4);
  for (const t of tabs) assert.ok(/type="button"/.test(t[0]), `tab without type: ${t[0]}`);
});

test("every form control has a label or aria-label", () => {
  const ids = [...html.matchAll(/<(input|select)[^>]*id="([^"]+)"/g)].map((m) => m[2]);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.ok(html.includes(`for="${id}"`), `control #${id} has no <label for>`);
  }
});

test("charts expose role=img with an aria-label", () => {
  const charts = [...html.matchAll(/<svg[^>]*class="chart-svg"[^>]*>/g)];
  assert.ok(charts.length >= 2);
  for (const c of charts) {
    assert.ok(/role="img"/.test(c[0]));
    assert.ok(/aria-label="[^"]+"/.test(c[0]));
  }
});

test("page has one h1 and labelled sections", () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.ok((html.match(/<h2\b/g) || []).length >= 4);
});

test("html element declares lang and a responsive viewport", () => {
  assert.ok(/<html lang="en"/.test(html));
  assert.ok(/<meta name="viewport" content="width=device-width, initial-scale=1"/.test(html));
});

/* ------------------------------------------------------------------ */
/* Educational framing (clinical disclaimers)                           */
/* ------------------------------------------------------------------ */

test("page discloses the educational-only scope", () => {
  assert.ok(/Educational Scope Notice/i.test(html));
  assert.ok(/not clinical medical advice/i.test(html));
});

test("every preset drug is labelled illustrative, not clinical", () => {
  for (const d of require("../js/pk-engine.js").PRESET_DRUGS) {
    assert.ok(/illustrative|fixture|educational/i.test(d.note || d.name), `${d.id} lacks a disclaimer`);
  }
});

test("export payload carries the educational disclaimer", () => {
  assert.ok(/Educational pharmacokinetic simulation fixture output only\. Not medical advice\./.test(appSrc));
});

/* ------------------------------------------------------------------ */
/* Hygiene invariants                                                   */
/* ------------------------------------------------------------------ */

const shipped = [
  ["index.html", html],
  ["styles.css", css],
  ["js/app.js", appSrc],
  ["js/ui-svg.js", svgSrc],
  ["js/pk-engine.js", engineSrc],
];

for (const [name, text] of shipped) {
  test(`${name} contains no em or en dashes`, () => {
    assert.equal(text.includes("\u2014"), false, `${name} has an em dash`);
    assert.equal(text.includes("\u2013"), false, `${name} has an en dash`);
  });
}

test("no shipped file has a smooth-scroll rule", () => {
  for (const [name, text] of shipped) {
    assert.equal(/scroll-behavior:\s*smooth/.test(text), false, `${name} scrolls smoothly`);
  }
});

test("no AI or model mentions in shipped text", () => {
  const modelNames = /\b(GPT|LLM|ChatGPT|Copilot|Gemini)\b|artificial intelligence/i;
  for (const [name, text] of shipped) {
    const ai = /\bAI\b/.exec(text);
    assert.equal(ai, null, `${name} mentions "${ai && ai[0]}"`);
    const m = modelNames.exec(text);
    assert.equal(m, null, `${name} mentions "${m && m[0]}"`);
  }
});

test("no uppercase eyebrow, kicker or tagline is shipped", () => {
  assert.equal(/text-transform:\s*uppercase/i.test(css), false);
  assert.equal(/class="[^"]*(eyebrow|kicker|tagline|subtitle)[^"]*"/i.test(html), false);
});

/* ------------------------------------------------------------------ */
/* DOM-level behaviour                                                  */
/* ------------------------------------------------------------------ */

function makeEl(tag, id = "") {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(),
    id,
    value: "",
    textContent: "",
    options: [],
    children: [],
    focused: false,
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) {
        const has = this._set.has(c);
        const on = force === undefined ? !has : force;
        if (on) this._set.add(c); else this._set.delete(c);
      },
      contains(c) { return this._set.has(c); }
    },
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    dispatchEvent(ev) { for (const fn of listeners[ev.type] || []) fn(ev); },
    appendChild(c) { this.children.push(c); if (this.tagName === "SELECT" && c.tagName === "OPTION") this.options.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    focus() { this.focused = true; },
    click() { this.dispatchEvent({ type: "click" }); },
  };
}

function buildDom() {
  const byId = new Map();
  const ids = [
    "drug-select", "route-select", "dose-input", "interval-select", "num-doses-input",
    "loading-input", "mec-input", "mtc-input", "sex-select", "age-input", "weight-input",
    "height-input", "scr-input", "perturb-type", "perturb-index", "delay-hours",
    "btn-auto-loading", "btn-export-csv", "btn-export-json",
    "kpi-crcl", "kpi-halflife", "kpi-css", "kpi-tiw",
    "chart-1comp", "chart-2comp", "optimizer-body", "curve-table-body", "perturb-summary",
    "kpi-crcl-sub", "kpi-halflife-sub", "kpi-css-sub", "kpi-tiw-sub", "drug-note",
    "two-alpha", "two-beta", "two-vss", "two-mass",
    "calc-ibw", "calc-crcl", "calc-cl", "calc-ke",
  ];
  for (const id of ids) {
    const tag = id.includes("select") ? "select" : id.includes("input") ? "input" : id.startsWith("btn") ? "button" : id.includes("chart") ? "svg" : "div";
    byId.set(id, makeEl(tag, id));
  }
  const tabs = ["tab-curves", "tab-twocomp", "tab-renal", "tab-optimizer"].map((id, i) => {
    const t = makeEl("button", id);
    t.setAttribute("aria-controls", ["panel-curves", "panel-twocomp", "panel-renal", "panel-optimizer"][i]);
    t.setAttribute("aria-selected", i === 0 ? "true" : "false");
    return t;
  });
  const panels = ["panel-curves", "panel-twocomp", "panel-renal", "panel-optimizer"].map((id, i) => {
    const p = makeEl("div", id);
    if (i === 0) p.classList.add("is-active");
    return p;
  });
  const doc = {
    body: makeEl("body"),
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => makeEl(tag),
    createElementNS: (_ns, tag) => makeEl(tag),
    querySelectorAll(sel) {
      if (sel === ".tab") return tabs;
      if (sel === ".panel") return panels;
      return [];
    },
    addEventListener() {},
  };
  return { doc, byId, tabs, panels };
}

function loadController(doc) {
  const Engine = require("../js/pk-engine.js");
  const svgCtx = { document: doc, Math, Number, Object, String };
  svgCtx.globalThis = svgCtx;
  vm.runInNewContext(read("js/ui-svg.js"), svgCtx);
  const captured = { downloads: [] };
  const FakeBlob = function (parts) { captured.downloads.push(parts.join("")); };
  const FakeURL = { createObjectURL: () => "blob:mock", revokeObjectURL: () => {} };
  const sandbox = { document: doc, Math, Number, Object, String, URL: FakeURL, Blob: FakeBlob };
  sandbox.globalThis = sandbox;
  sandbox.DoseKineticsEngine = Engine;
  sandbox.DoseKineticsSvg = svgCtx.DoseKineticsSvg;
  vm.runInNewContext(read("js/app.js"), sandbox);
  const ctrl = sandbox.DoseKineticsApp.createController(doc);
  return { ctrl, captured };
}

test("roving tabindex: exactly one tab is tabbable at boot", () => {
  const { doc, tabs } = buildDom();
  const { ctrl } = loadController(doc);
  ctrl.init();
  const tabbable = tabs.filter((t) => t.getAttribute("tabindex") === "0");
  assert.equal(tabbable.length, 1);
  assert.equal(tabbable[0].id, "tab-curves");
});

test("ArrowRight on a tab moves selection and focus forward", () => {
  const { doc, tabs, panels } = buildDom();
  const { ctrl } = loadController(doc);
  ctrl.init();
  tabs[0].dispatchEvent({ type: "keydown", key: "ArrowRight", preventDefault() {} });
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(tabs[1].getAttribute("tabindex"), "0");
  assert.equal(tabs[0].getAttribute("tabindex"), "-1");
  assert.ok(tabs[1].focused);
  assert.ok(panels[1].classList.contains("is-active"));
});

test("ArrowLeft on the first tab wraps to the last", () => {
  const { doc, tabs } = buildDom();
  const { ctrl } = loadController(doc);
  ctrl.init();
  tabs[0].dispatchEvent({ type: "keydown", key: "ArrowLeft", preventDefault() {} });
  assert.equal(tabs[3].getAttribute("aria-selected"), "true");
});

test("Home and End jump to the first and last tabs", () => {
  const { doc, tabs } = buildDom();
  const { ctrl } = loadController(doc);
  ctrl.init();
  tabs[1].dispatchEvent({ type: "keydown", key: "End", preventDefault() {} });
  assert.equal(tabs[3].getAttribute("aria-selected"), "true");
  tabs[3].dispatchEvent({ type: "keydown", key: "Home", preventDefault() {} });
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
});

test("optimizer table cells carry text, never markup", () => {
  const { doc, byId } = buildDom();
  const { ctrl } = loadController(doc);
  ctrl.init();
  const body = byId.get("optimizer-body");
  assert.ok(body.children.length > 0);
  for (const tr of body.children) {
    assert.ok(tr.children.length === 7, `row has ${tr.children.length} cells`);
    for (const td of tr.children) {
      assert.equal(typeof td.textContent, "string");
      assert.ok(!/</.test(td.textContent) || td.children.length > 0);
    }
  }
});

test("JSON export produces a downloadable report with an integrity digest", () => {
  const { doc, byId } = buildDom();
  const { ctrl, captured } = loadController(doc);
  ctrl.init();
  byId.get("btn-export-json").click();
  assert.equal(captured.downloads.length, 1);
  const report = JSON.parse(captured.downloads[0]);
  assert.equal(report.integrity.algorithm, "SHA-256");
  assert.ok(/^[0-9a-f]{64}$/.test(report.integrity.canonicalJsonSha256));
  assert.ok(/not medical advice/i.test(report.disclaimer));
});

test("CSV export produces a downloadable numeric series", () => {
  const { doc, byId } = buildDom();
  const { ctrl, captured } = loadController(doc);
  ctrl.init();
  byId.get("btn-export-csv").click();
  assert.equal(captured.downloads.length, 1);
  const csv = captured.downloads[0];
  assert.ok(csv.startsWith("time_h,nominal_conc_mg_l"));
  assert.ok(csv.split("\n").length > 100);
});
