// app.js - the Cite 3 page. Levels 1 and 2 run in the browser; level 3 calls the live judge.
import { parseText } from "./parse.js";
import { makeSources } from "./sources.js";
import { checkReference } from "./check.js";
import { LIVE_URL, MAILTO } from "./config.js";

const $ = (s) => document.querySelector(s);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

// ---------- examples ----------
const REFS = {
  attention: "[1] Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A., Kaiser, L., & Polosukhin, I. (2017). Attention is all you need. arXiv. https://doi.org/10.48550/arXiv.1706.03762",
  adam: "[2] Kingma, D. P., & Ba, J. (2014). Adam: A method for stochastic optimization. arXiv. https://doi.org/10.48550/arXiv.1412.6980",
  resnet: "[3] He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. CVPR. https://doi.org/10.1109/CVPR.2016.90",
};
const EXAMPLES = [
  {
    name: "Clean essay",
    text: [
      "The Transformer is based solely on attention mechanisms, with no recurrence or convolutions [1]. Adam adapts the step size of each parameter using estimates of the moments of the gradient [2]. Residual connections make very deep networks easier to train [3].",
      "",
      "References",
      REFS.attention,
      REFS.adam,
      REFS.resnet,
    ].join("\n"),
  },
  {
    name: "A made-up source",
    text: [
      "The Transformer is based solely on attention mechanisms, with no recurrence or convolutions [1]. Composting in dense cities measurably alters spacetime curvature [2].",
      "",
      "References",
      REFS.attention,
      "[2] Okoye, B., & Mensah, K. (2021). Quantum gravity effects in urban composting. Journal of Imaginary Results. https://doi.org/10.1038/s99999-021-00000-0",
    ].join("\n"),
  },
  {
    name: "Real paper, wrong claim",
    text: [
      "Adam was shown to be slower than plain gradient descent on every benchmark [1]. Residual networks were introduced to improve speech recognition [2]. Deep learning lets models learn representations at several levels of abstraction [3].",
      "",
      "References",
      REFS.adam.replace("[2]", "[1]"),
      REFS.resnet.replace("[3]", "[2]"),
      "[3] LeCun, Y., Bengio, Y., & Hinton, G. (2019). Deep learning. Nature. https://doi.org/10.1038/nature14539",
    ].join("\n"),
  },
];

// ---------- live judge (level 3) ----------
async function judgeRemote({ claim, title, abstract }) {
  if (!LIVE_URL) return { verdict: "error", reason: "the live judge is not connected yet" };
  try {
    const res = await fetch(LIVE_URL, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ claim, title, abstract }) });
    const j = await res.json();
    if (!res.ok) return { verdict: "error", reason: j.error || "judge error " + res.status };
    return { verdict: j.verdict, reason: j.reason || "" };
  } catch {
    return { verdict: "error", reason: "could not reach the live judge" };
  }
}

// ---------- rendering ----------
const TONE_LABEL = { ok: "OK", warn: "Check", bad: "Problem", off: "n/a" };
function pill(tone, text) {
  return h("span", { class: "pill " + tone }, text);
}

function levelRows(r) {
  const rows = [];
  const l1 = r.level1;
  if (l1.status === "found") rows.push(["1 Exists?", "ok", l1.how === "doi" ? "Found by DOI" : "Found by title"]);
  else if (l1.status === "not_found") rows.push(["1 Exists?", "bad", "Not found in Crossref or OpenAlex"]);
  else if (l1.status === "uncertain") rows.push(["1 Exists?", "warn", "Only a close match: " + (l1.candidate || "")]);
  else rows.push(["1 Exists?", "off", "Could not look it up" + (l1.note ? " (" + l1.note + ")" : "")]);

  const l2 = r.level2;
  if (l2.status === "ok") rows.push(["2 Details?", "ok", "Title, year and first author match"]);
  else if (l2.status === "skipped") rows.push(["2 Details?", "off", "Skipped: no record to compare with"]);
  else rows.push(["2 Details?", l2.status === "wrong" ? "bad" : "warn", l2.issues.map((i) => i.detail).join("; ")]);

  const l3 = r.level3;
  const reason = l3.reason ? " (" + l3.reason + ")" : "";
  if (l3.status === "supports") rows.push(["3 Says that?", "ok", "The abstract supports the sentence" + reason]);
  else if (l3.status === "partial") rows.push(["3 Says that?", "warn", "Related, but the sentence says more than the abstract" + reason]);
  else if (l3.status === "contradicts") rows.push(["3 Says that?", "bad", "The abstract says the opposite" + reason]);
  else if (l3.status === "unrelated") rows.push(["3 Says that?", "bad", "The paper is about something else" + reason]);
  else if (l3.status === "unverifiable") rows.push(["3 Says that?", "off", "Cannot verify: " + (l3.reason || "no verdict")]);
  else rows.push(["3 Says that?", "off", l3.reason || "Skipped"]);
  return rows;
}

const VERDICT_TEXT = { ok: "Looks right", warn: "Worth a second look", bad: "Problem found", unknown: "Could not fully check" };

function pendingCard(ref) {
  return h("div", { class: "card pending" }, h("p", { class: "ref" }, "[" + ref.id + "] " + ref.raw), h("p", { class: "muted" }, "Checking..."));
}

function resultCard(r, claims) {
  const claim = claims && claims[0] ? h("p", { class: "claim" }, "Cited for: " + claims[0]) : null;
  return h(
    "div",
    { class: "card " + r.overall },
    h("p", { class: "verdict" }, VERDICT_TEXT[r.overall] || r.overall),
    h("p", { class: "ref" }, "[" + r.id + "] " + r.raw),
    claim,
    levelRows(r).map(([name, tone, text]) => h("div", { class: "lv" }, h("span", { class: "name" }, name), h("span", {}, pill(tone, TONE_LABEL[tone]), " ", text)))
  );
}

// ---------- run ----------
const sources = makeSources({ mailto: MAILTO });
let running = false;

async function run() {
  if (running) return;
  const out = $("#out");
  const status = $("#status");
  const go = $("#go");
  const parsed = parseText($("#input").value);
  out.replaceChildren();
  if (!parsed.refs.length) {
    out.append(h("p", { class: "note" }, "I could not find a reference list. Add a line that says References, then lines starting with [1], [2], and so on."));
    return;
  }
  running = true;
  go.disabled = true;
  const counts = { ok: 0, warn: 0, bad: 0, unknown: 0 };
  const refs = parsed.refs.slice(0, 15);
  try {
    for (let i = 0; i < refs.length; i++) {
      status.textContent = `Checking ${i + 1} of ${refs.length}...`;
      const ref = refs[i];
      const pend = pendingCard(ref);
      out.append(pend);
      const r = await checkReference(ref, parsed.claims[ref.id], { sources, judge: judgeRemote });
      counts[r.overall]++;
      pend.replaceWith(resultCard(r, parsed.claims[ref.id]));
    }
    const bits = [];
    if (counts.bad) bits.push(counts.bad + " with a problem");
    if (counts.warn) bits.push(counts.warn + " to look at again");
    if (counts.unknown) bits.push(counts.unknown + " not fully checked");
    if (counts.ok) bits.push(counts.ok + " look right");
    status.textContent = bits.join(", ") + (parsed.refs.length > 15 ? ". Only the first 15 were checked." : ".");
  } catch (e) {
    status.textContent = "Something went wrong: " + String(e.message).slice(0, 100);
  } finally {
    running = false;
    go.disabled = false;
  }
}

function setupExamples() {
  const box = $("#examples");
  for (const ex of EXAMPLES) {
    box.append(h("button", { class: "chip", type: "button", "aria-pressed": "false", onclick: (ev) => { $("#input").value = ex.text; $("#out").replaceChildren(); $("#status").textContent = ""; box.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", "false")); ev.currentTarget.setAttribute("aria-pressed", "true"); } }, ex.name));
  }
  $("#input").value = EXAMPLES[1].text;
  $("#go").addEventListener("click", run);
}

// ---------- results ----------
const TYPE_INFO = {
  correct: ["Correct references", "false alarms: lower is better"],
  fabricated: ["Fabricated references", "caught: higher is better"],
  wrong_details: ["Wrong year, author or title", "caught: higher is better"],
  misused: ["Real paper, unrelated to the sentence", "caught: higher is better"],
  contradicted: ["Real paper, sentence says the opposite", "caught: higher is better"],
};
const VARIANTS = [["L1", "v1", "1 Exists?"], ["L1L2", "v2", "1 + 2 Details"], ["L1L2L3", "v3", "1 + 2 + 3 Claim"], ["ANY", "v4", "Any alert"]];

function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
const pct = (k, n) => (n ? Math.round((100 * k) / n) : 0);

function vsRow(label, a, b, hint) {
  return h(
    "div",
    { class: "vs" },
    h("div", { class: "vs-label" }, label, hint ? h("span", { class: "hint" }, " " + hint) : null),
    h("div", { class: "bar" }, h("span", { class: "who" }, "Existence only"), h("div", { class: "track" }, h("div", { class: "fill v1", "data-w": String(a) })), h("span", { class: "val" }, a + "%")),
    h("div", { class: "bar" }, h("span", { class: "who" }, "Cite 3"), h("div", { class: "track" }, h("div", { class: "fill v3", "data-w": String(b) })), h("span", { class: "val" }, b + "%"))
  );
}

function detailBars(t) {
  const bars = h("div", { class: "bars" });
  for (const type of Object.keys(TYPE_INFO)) {
    const row = t[type];
    const block = h("div", { class: "type" }, h("h3", {}, TYPE_INFO[type][0], " ", h("span", { class: "hint" }, "(" + TYPE_INFO[type][1] + ", " + row.valid + " cases)")));
    for (const [key, cls, label] of VARIANTS) {
      if (row.flagged[key] === undefined) continue;
      const k = row.flagged[key];
      const [lo, hi] = wilson(k, row.valid);
      block.append(
        h("div", { class: "bar" }, h("span", { class: "who" }, label), h("div", { class: "track" }, h("div", { class: "fill " + cls, "data-w": String(pct(k, row.valid)) })), h("span", { class: "val" }, `${pct(k, row.valid)}% (${Math.round(lo * 100)}-${Math.round(hi * 100)})`))
      );
    }
    bars.append(block);
  }
  return bars;
}

function renderResults(data) {
  const body = $("#results-body");
  const { summary, meta } = data;
  const t = summary.byType;
  const rate = (type, v) => pct(t[type].flagged[v], t[type].valid);
  const both = (v) => pct(t.misused.flagged[v] + t.contradicted.flagged[v], t.misused.valid + t.contradicted.valid);

  const headline = h("p", { class: "headline" }, `Checking only that a source exists misses ${100 - both("L1")}% of real papers cited for something they do not say. Cite 3 catches ${both("L1L2L3")}% of them.`);
  const chart = h(
    "div",
    { class: "vs-chart" },
    vsRow("Invented source", rate("fabricated", "L1"), rate("fabricated", "L1L2L3")),
    vsRow("Real source, wrong year or author", rate("wrong_details", "L1"), rate("wrong_details", "L1L2L3")),
    vsRow("Real paper that does not say that", both("L1"), both("L1L2L3")),
    vsRow("Correct source flagged by mistake", rate("correct", "L1"), rate("correct", "L1L2L3"), "(lower is better)")
  );
  const unv = Object.values(t).reduce((n, r) => n + (r.unverifiable || 0), 0);
  const detailsBox = h(
    "details",
    { class: "more" },
    h("summary", {}, "All the numbers"),
    h("p", { class: "muted" }, `${meta.cases} test cases built from real papers. Judge: ${meta.models}. Run on ${meta.date}. Brackets show the 95% confidence interval. "Any alert" also counts yellow warnings such as a close but not exact title match.`),
    detailBars(t),
    unv ? h("p", { class: "muted" }, `${unv} case(s) could not be judged at level 3 because no abstract was available. They count as not flagged.`) : null
  );
  body.replaceChildren(
    ...[
      headline,
      chart,
      h("p", { class: "muted small" }, `Test set: ${meta.cases} short texts built from real papers, with the right answer known.`),
      detailsBox,
    ].filter(Boolean)
  );
  const grow = () => body.querySelectorAll(".fill").forEach((f) => (f.style.width = f.dataset.w + "%"));
  const target = body.querySelector(".vs-chart");
  const openDetails = () => grow();
  detailsBox.addEventListener("toggle", openDetails);
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        grow();
        io.disconnect();
      }
    }, { threshold: 0.1 });
    io.observe(target);
  } else grow();
}

async function loadResults() {
  const body = $("#results-body");
  try {
    const res = await fetch("results.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("no results yet");
    renderResults(await res.json());
  } catch {
    body.replaceChildren(h("p", { class: "note" }, "The benchmark has not been run yet. Results appear here as soon as it finishes."));
  }
}

setupExamples();
loadResults();
