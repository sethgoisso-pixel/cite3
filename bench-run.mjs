// bench-run.mjs - runs in GitHub Actions (needs internet and LLM_API_KEY).
//   node bench-run.mjs smoke   quick check that Crossref, OpenAlex and Gemini all answer
//   node bench-run.mjs run     build the test set and measure the three levels
import fs from "node:fs";
import { makeSources } from "./sources.js";
import { makeJudge, DEFAULT_MODELS } from "./judge.js";
import { checkReference } from "./check.js";
import { parseText } from "./parse.js";
import { buildCases, summarize, toMarkdown } from "./cases.js";

const mode = process.argv[2] || "smoke";
const apiKey = process.env.LLM_API_KEY || "";
const mailto = process.env.MAILTO || "";
const perType = Math.max(1, Math.min(60, Number(process.env.N_PER_TYPE) || 40));
const seed = Number(process.env.SEED) || 1;
const models = (process.env.MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
const useModels = models.length ? models : DEFAULT_MODELS;

const sources = makeSources({ mailto });
const log = (m) => console.log(m);

async function smoke() {
  const lines = ["## Cite 3 smoke test", ""];
  let failed = 0;
  const step = async (name, fn) => {
    try {
      const out = await fn();
      lines.push(`- PASS ${name}: ${out}`);
    } catch (e) {
      failed++;
      lines.push(`- FAIL ${name}: ${String(e.message).slice(0, 200)}`);
    }
  };
  await step("Crossref/OpenAlex lookup by DOI", async () => {
    const r = await sources.byDoi("10.1038/nature14539");
    if (!r.found) throw new Error("known DOI not found");
    return `${r.work.title} (${r.work.year}, ${r.work.source}, abstract ${r.work.abstract.length} chars)`;
  });
  await step("fake DOI is not found", async () => {
    const r = await sources.byDoi("10.1038/zzzz-not-a-real-doi-0000");
    if (r.found) throw new Error("fake DOI was found");
    return "not found, as expected";
  });
  await step("search by title", async () => {
    const r = await sources.search("Deep learning LeCun Bengio Hinton");
    if (!r.length) throw new Error("no candidates");
    return `${r.length} candidates, first: ${r[0].title}`;
  });
  await step("sample real papers (OpenAlex)", async () => {
    const r = await sources.sampleWorks(20, 1);
    if (r.length < 5) throw new Error("only " + r.length + " usable papers");
    return `${r.length} usable papers, first: ${r[0].title}`;
  });
  for (const m of useModels) {
    await step("Gemini model " + m, async () => {
      if (!apiKey) throw new Error("LLM_API_KEY is empty");
      const { judge } = makeJudge({ apiKey, models: [m] });
      const v = await judge({
        claim: "Deep neural networks can learn useful representations from raw data.",
        title: "Deep learning",
        abstract: "Deep learning allows computational models that are composed of multiple processing layers to learn representations of data with multiple levels of abstraction. These methods have dramatically improved the state of the art in speech recognition, visual object recognition, object detection and many other domains.",
      });
      if (v.verdict === "error") throw new Error(v.reason);
      return `verdict ${v.verdict}`;
    });
  }
  await step("whole pipeline on a 3-reference text", async () => {
    const judge = makeJudge({ apiKey, models: useModels }).judge;
    const text = [
      "Deep neural networks learn layered representations of data [1]. Sleep has no effect on memory consolidation [2]. A made-up result is widely accepted [3].",
      "",
      "References",
      "[1] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature. https://doi.org/10.1038/nature14539",
      "[2] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature. https://doi.org/10.1038/nature14539",
      "[3] Okoye, B., & Mensah, K. (2021). Quantum gravity effects in urban composting. Journal of Imaginary Results. https://doi.org/10.1038/s99999-021-00000-0",
    ].join("\n");
    const p = parseText(text);
    const out = [];
    for (const ref of p.refs) {
      const r = await checkReference(ref, p.claims[ref.id], { sources, judge });
      out.push(`#${ref.id} ${r.overall} [${r.flags.join(",") || "no flags"}] L1=${r.level1.status} L2=${r.level2.status} L3=${r.level3.status}`);
    }
    if (!out.length || out.every((o) => o.includes("L1=error"))) throw new Error("every lookup failed: " + out.join(" | "));
    return out.join(" | ");
  });
  lines.push("", failed ? `${failed} step(s) failed.` : "All steps passed.");
  fs.writeFileSync("smoke.md", lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  if (failed) process.exitCode = 1;
}

async function run() {
  if (!apiKey) {
    console.error("LLM_API_KEY is empty. Add it as a repository secret.");
    process.exit(1);
  }
  const t0 = Date.now();
  const judgeObj = makeJudge({ apiKey, models: useModels, minGapMs: 4500 });
  const poolSize = Math.min(200, Math.max(120, perType * 3));
  log(`sampling ${poolSize} real papers...`);
  const works = await sources.sampleWorks(poolSize, seed);
  log(`got ${works.length} usable papers`);
  const cases = await buildCases({ works, llm: judgeObj, sources, perType, seed, log });
  log(`built ${cases.length} cases`);
  fs.writeFileSync("cases.json", JSON.stringify(cases, null, 1));

  const records = [];
  for (const c of cases) {
    const p = parseText(c.text);
    const check = p.refs.length
      ? await checkReference(p.refs[0], p.claims[1], { sources, judge: judgeObj.judge }, { runAllLevels: true })
      : { id: 1, raw: "", level1: { status: "error", note: "parse failed" }, level2: { status: "skipped", issues: [] }, level3: { status: "skipped" }, flags: [], overall: "unknown" };
    records.push({ case: c, check });
    if (records.length % 10 === 0) log(`checked ${records.length}/${cases.length}`);
  }
  const summary = summarize(records);
  const meta = { models: useModels.join(", "), cases: cases.length, perType, seed, date: new Date().toISOString().slice(0, 10), minutes: Math.round((Date.now() - t0) / 60000) };
  fs.writeFileSync("results.json", JSON.stringify({ meta, summary, records }, null, 1));
  const md = toMarkdown(summary, meta);
  fs.writeFileSync("summary.md", md + "\n");
  console.log(md);
}

if (mode === "smoke") await smoke();
else if (mode === "run") await run();
else {
  console.error("usage: node bench-run.mjs smoke|run");
  process.exit(1);
}
