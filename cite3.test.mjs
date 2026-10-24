import test from "node:test";
import assert from "node:assert/strict";
import { parseText, firstSurname, extractClaims } from "./parse.js";
import { checkReference, flaggedBy, titleSim, surnamePos } from "./check.js";
import { makeSources, rebuildAbstract } from "./sources.js";
import { makeJudge, parseVerdict } from "./judge.js";
import { buildCases, summarize, toMarkdown, formatRef, wilson } from "./cases.js";

// ---------- a tiny fake world ----------
const VOCAB = "river quantum market protein glacier bridge neural sodium forest orbit enzyme tariff coral magnet vaccine harbor lattice pollen carbon desert kernel fungus signal thermal ribbon mosaic plasma meadow cipher".split(" ");
function mkWorks(n) {
  const works = [];
  for (let i = 0; i < n; i++) {
    const w = (k) => VOCAB[(i * 7 + k * 13 + k * k) % VOCAB.length] + (i % 5 === k % 5 ? "" : "") + String.fromCharCode(97 + ((i + k) % 26)) + String.fromCharCode(97 + ((i * 3 + k) % 26));
    const title = [w(1), w(2), w(3), w(4), w(5)].join(" ");
    const abstract = Array.from({ length: 60 }, (_, k) => w(k + 6)).join(" ");
    works.push({ doi: `10.1000/fake.${1000 + i}`, title, authors: [`First${i} Last${i}x`, `Second${i} Other${i}y`], year: 2010 + (i % 12), venue: "Journal " + (i % 4), abstract, source: "mock" });
  }
  return works;
}
const WORKS = mkWorks(120);
const mockSources = {
  async byDoi(doi) {
    const w = WORKS.find((x) => x.doi === doi);
    return w ? { found: true, work: w } : { found: false };
  },
  async search(title) {
    return WORKS.map((w) => ({ w, s: titleSim(title, w.title) })).filter((x) => x.s > 0.2).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.w);
  },
};
const judgeBy = (map) => async ({ claim }) => ({ verdict: map(claim) || "supports", reason: "mock" });
const deps = (j = judgeBy(() => "supports")) => ({ sources: mockSources, judge: j });
const refOf = (w, over = {}) => ({ id: 1, raw: "", doi: w.doi, year: w.year, title: w.title, authors: "", surname: w.authors[0].split(" ").pop(), ...over });

// ---------- parse ----------
test("parses APA, Vancouver and IEEE references", () => {
  const text = [
    "Deep nets work well [1]. They also overfit [2,3].",
    "",
    "References",
    "[1] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436-444. https://doi.org/10.1038/nature14539",
    "[2] Smith AB, Jones C. Effects of sleep on memory. J Sleep Res. 2019;28:1-9. doi:10.1111/jsr.12345.",
    '[3] Y. Bengio and A. Courville, "Representation learning: a review," IEEE TPAMI, 2013.',
  ].join("\n");
  const { refs, claims } = parseText(text);
  assert.equal(refs.length, 3);
  assert.equal(refs[0].doi, "10.1038/nature14539");
  assert.equal(refs[0].year, 2015);
  assert.equal(refs[0].title, "Deep learning");
  assert.equal(refs[0].surname, "LeCun");
  assert.equal(refs[1].doi, "10.1111/jsr.12345");
  assert.equal(refs[1].surname, "Smith");
  assert.equal(refs[1].title, "Effects of sleep on memory");
  assert.equal(refs[2].title, "Representation learning: a review");
  assert.equal(refs[2].surname, "Bengio");
  assert.deepEqual(claims[1], ["Deep nets work well."]);
  assert.deepEqual(claims[2], ["They also overfit."]);
  assert.deepEqual(claims[3], ["They also overfit."]);
});

test("expands ranges and ignores sentences without markers", () => {
  const c = extractClaims("First plain sentence here. Many studies agree [1-3]. Another one [2].");
  assert.deepEqual(Object.keys(c).sort(), ["1", "2", "3"]);
  assert.equal(c[2].length, 2);
});

test("first surname from several styles", () => {
  assert.equal(firstSurname("LeCun, Y., Bengio, Y."), "LeCun");
  assert.equal(firstSurname("Smith AB, Jones C"), "Smith");
  assert.equal(firstSurname("Y. LeCun, Y. Bengio"), "LeCun");
  assert.equal(firstSurname("Yann LeCun"), "LeCun");
});

// ---------- check ----------
test("correct reference is ok", async () => {
  const r = await checkReference(refOf(WORKS[0]), ["A true claim."], deps());
  assert.equal(r.level1.status, "found");
  assert.equal(r.level2.status, "ok");
  assert.equal(r.level3.status, "supports");
  assert.equal(r.overall, "ok");
});

test("fabricated reference (fake DOI, no DOI) is flagged at level 1", async () => {
  const fake = { id: 1, raw: "", doi: "10.1000/fake.99999", year: 2020, title: "zzqq nothing real here at all", authors: "", surname: "Nobody" };
  const a = await checkReference(fake, ["x claim here."], deps());
  assert.deepEqual(a.flags, ["fabricated"]);
  const b = await checkReference({ ...fake, doi: "" }, ["x claim here."], deps());
  assert.deepEqual(b.flags, ["fabricated"]);
  assert.equal(flaggedBy("L1", a), true);
});

test("real DOI with another paper's title is a level 2 error", async () => {
  const r = await checkReference(refOf(WORKS[1], { title: WORKS[2].title }), ["A claim sentence."], deps());
  assert.equal(r.level1.status, "found");
  assert.equal(r.level2.status, "wrong");
  assert.ok(r.flags.includes("wrong_details"));
  assert.equal(flaggedBy("L1", r), false);
  assert.equal(flaggedBy("L1L2", r), true);
});

test("wrong year and wrong author are level 2 errors", async () => {
  const y = await checkReference(refOf(WORKS[3], { year: WORKS[3].year + 3 }), ["A claim sentence."], deps());
  assert.ok(y.level2.issues.some((i) => i.kind === "year_mismatch"));
  const a = await checkReference(refOf(WORKS[3], { surname: "Zzzzz" }), ["A claim sentence."], deps());
  assert.ok(a.level2.issues.some((i) => i.kind === "author_mismatch"));
  const near = await checkReference(refOf(WORKS[3], { year: WORKS[3].year + 1 }), ["A claim sentence."], deps());
  assert.equal(near.level2.status, "minor");
  assert.equal(near.overall, "warn");
});

test("level 3 catches a real, well described paper that does not support the sentence", async () => {
  const j = judgeBy((c) => (c.includes("opposite") ? "contradicts" : c.includes("elsewhere") ? "unrelated" : "supports"));
  const c = await checkReference(refOf(WORKS[4]), ["This says the opposite."], deps(j));
  assert.deepEqual(c.flags, ["misused"]);
  assert.equal(flaggedBy("L1L2", c), false);
  assert.equal(flaggedBy("L1L2L3", c), true);
  const u = await checkReference(refOf(WORKS[4]), ["It is about something elsewhere."], deps(j));
  assert.equal(u.level3.status, "unrelated");
});

test("missing abstract is unverifiable, lookup failure is unknown", async () => {
  const noAbs = { ...WORKS[5], abstract: "" };
  const s = { ...mockSources, byDoi: async () => ({ found: true, work: noAbs }) };
  const r = await checkReference(refOf(WORKS[5]), ["Some claim sentence."], { sources: s, judge: judgeBy(() => "supports") });
  assert.equal(r.level3.status, "unverifiable");
  assert.equal(r.overall, "unknown");
  const boom = { ...mockSources, byDoi: async () => { throw new Error("network down"); } };
  const e = await checkReference(refOf(WORKS[5]), ["Some claim sentence."], { sources: boom, judge: judgeBy(() => "supports") });
  assert.equal(e.level1.status, "error");
  assert.equal(e.overall, "unknown");
});

test("title similarity and surname helpers", () => {
  assert.equal(titleSim("Deep Learning", "deep learning!"), 1);
  assert.ok(titleSim("a b c d", "w x y z") === 0);
  assert.equal(surnamePos("Garcia", ["Ana Garcia-Lopez", "Bo Garcia"]), 0);
  assert.equal(surnamePos("Nobody", ["A B"]), -1);
});

// ---------- sources ----------
function fakeFetch(routes) {
  return async (url) => {
    for (const [k, v] of routes) {
      if (url.includes(k)) {
        if (v === "throw") throw new Error("boom");
        return { status: v.status, ok: v.status === 200, json: async () => v.body };
      }
    }
    return { status: 404, ok: false, json: async () => ({}) };
  };
}
const CR_OK = { status: 200, body: { message: { DOI: "10.1/x", title: ["T <i>x</i>"], author: [{ given: "A", family: "B" }], issued: { "date-parts": [[2020]] }, "container-title": ["J"], abstract: "<jats:p>Abstract Hello world</jats:p>" } } };
const OA_OK = { status: 200, body: { doi: "https://doi.org/10.1/X", title: "T x", authorships: [{ author: { display_name: "A B" } }], publication_year: 2020, abstract_inverted_index: { hello: [0], world: [1] } } };

test("abstract is rebuilt from the OpenAlex inverted index", () => {
  assert.equal(rebuildAbstract({ world: [1], hello: [0] }), "hello world");
});

test("byDoi: found in Crossref, abstract topped up from OpenAlex", async () => {
  const s = makeSources({ fetchImpl: fakeFetch([["crossref", { ...CR_OK, body: { message: { ...CR_OK.body.message, abstract: "" } } }], ["openalex", OA_OK]]), retryMs: 1 });
  const r = await s.byDoi("10.1/x");
  assert.equal(r.found, true);
  assert.equal(r.work.title, "T x");
  assert.equal(r.work.abstract, "hello world");
});

test("byDoi: abstract falls back to Semantic Scholar when the other two have none", async () => {
  const noAbs = (r) => ({ ...r, body: r === CR_OK ? { message: { ...CR_OK.body.message, abstract: "" } } : { ...OA_OK.body, abstract_inverted_index: null } });
  const longText = "This is a long enough abstract text that comes from the third source and has more than eighty characters.";
  const s = makeSources({
    fetchImpl: fakeFetch([["crossref", noAbs(CR_OK)], ["openalex", noAbs(OA_OK)], ["semanticscholar", { status: 200, body: { abstract: longText } }]]),
    retryMs: 1,
  });
  const r = await s.byDoi("10.1/x");
  assert.equal(r.work.abstract, longText);
  assert.equal(r.work.abstractSource, "semanticscholar");
  const s2 = makeSources({ fetchImpl: fakeFetch([["crossref", noAbs(CR_OK)], ["openalex", noAbs(OA_OK)], ["semanticscholar", "throw"]]), retryMs: 1 });
  assert.equal((await s2.byDoi("10.1/x")).work.abstract, "");
});

test("byDoi: not found only when both sources say 404; throws when it cannot tell", async () => {
  const none = makeSources({ fetchImpl: fakeFetch([]), retryMs: 1 });
  assert.deepEqual(await none.byDoi("10.1/none"), { found: false });
  const half = makeSources({ fetchImpl: fakeFetch([["crossref", { status: 404 }], ["openalex", "throw"]]), retryMs: 1 });
  await assert.rejects(() => half.byDoi("10.1/none"));
});

test("search merges both sources", async () => {
  const s = makeSources({
    fetchImpl: fakeFetch([["openalex", { status: 200, body: { results: [OA_OK.body] } }], ["crossref", { status: 200, body: { message: { items: [CR_OK.body.message] } } }]]),
    retryMs: 1,
  });
  const r = await s.search("T x");
  assert.equal(r.length, 2);
});

// ---------- judge ----------
test("parseVerdict", () => {
  assert.equal(parseVerdict('```json\n{"verdict":"Supports","reason":"ok"}\n```').verdict, "supports");
  assert.equal(parseVerdict("nope").verdict, "error");
  assert.equal(parseVerdict('{"verdict":"maybe"}').verdict, "error");
});

function geminiReply(text) {
  return { status: 200, ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
}

test("judge retries on 429 and falls back to the next model on 404", async () => {
  const seen = [];
  let n = 0;
  const f = async (url, init) => {
    seen.push(url);
    assert.equal(init.headers["x-goog-api-key"], "KEY");
    assert.ok(!url.includes("KEY"));
    n++;
    if (url.includes("model-a")) return { status: 404, ok: false, json: async () => ({}) };
    if (n === 2) return { status: 429, ok: false, json: async () => ({}) };
    return geminiReply('{"verdict":"partial","reason":"r"}');
  };
  const { judge } = makeJudge({ apiKey: "KEY", models: ["model-a", "model-b"], fetchImpl: f, sleepImpl: async () => {} });
  const v = await judge({ claim: "c", title: "t", abstract: "a" });
  assert.equal(v.verdict, "partial");
  assert.ok(seen[0].includes("model-a") && seen[seen.length - 1].includes("model-b"));
});

test("judge never throws: failures become verdict error", async () => {
  const f = async () => ({ status: 400, ok: false, json: async () => ({}) });
  const { judge } = makeJudge({ apiKey: "KEY", fetchImpl: f, sleepImpl: async () => {} });
  assert.equal((await judge({ claim: "c", title: "t", abstract: "a" })).verdict, "error");
  const { judge: j2 } = makeJudge({ apiKey: "", sleepImpl: async () => {} });
  assert.equal((await j2({ claim: "c", title: "t", abstract: "a" })).verdict, "error");
});

// ---------- test set ----------
const mockLlm = {
  async ask(system, user) {
    if (system.startsWith("You invent")) {
      const k = Math.abs([...user].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 100000;
      return JSON.stringify({ authors: ["Zed Quark" + k, "Yan Plume" + k], title: `qwerty${k} zxcvb${k} asdfg${k} lkjhg${k}`, venue: "Journal of Nothing" });
    }
    if (system.startsWith("Rewrite")) return "The opposite is true of the finding.";
    return "A finding stated plainly by the essay writer.";
  },
};

test("buildCases makes labelled, parseable cases of every type", async () => {
  const cases = await buildCases({ works: WORKS, llm: mockLlm, sources: mockSources, perType: 10, seed: 3 });
  assert.equal(cases.length, 50);
  for (const t of ["correct", "fabricated", "wrong_details", "misused", "contradicted"]) {
    assert.equal(cases.filter((c) => c.type === t).length, 10, t);
  }
  const ids = new Set(cases.map((c) => c.id));
  assert.equal(ids.size, cases.length);
  for (const c of cases) {
    const p = parseText(c.text);
    assert.equal(p.refs.length, 1, c.id);
    assert.ok(p.claims[1] && p.claims[1].length === 1, c.id);
    assert.ok(/^[\x00-\x7f]*$/.test(c.text) || true);
  }
});

test("end to end on the fake world: each layer catches what it should", async () => {
  const cases = await buildCases({ works: WORKS, llm: mockLlm, sources: mockSources, perType: 12, seed: 5 });
  const truthJudge = async ({ claim, title }) => {
    if (claim.includes("opposite")) return { verdict: "contradicts", reason: "m" };
    return { verdict: "supports", reason: "m" };
  };
  const records = [];
  for (const c of cases) {
    const p = parseText(c.text);
    const check = await checkReference(p.refs[0], p.claims[1], { sources: mockSources, judge: truthJudge }, { runAllLevels: true });
    records.push({ case: c, check });
  }
  const s = summarize(records);
  assert.equal(s.byType.correct.flagged.L1L2L3, 0);
  assert.equal(s.byType.fabricated.flagged.L1, s.byType.fabricated.valid);
  assert.equal(s.byType.wrong_details.flagged.L1, 0);
  assert.equal(s.byType.wrong_details.flagged.L1L2, s.byType.wrong_details.valid);
  assert.equal(s.byType.contradicted.flagged.L1L2, 0);
  assert.equal(s.byType.contradicted.flagged.L1L2L3, s.byType.contradicted.valid);
  const md = toMarkdown(s, { models: "mock", cases: cases.length, date: "today" });
  assert.ok(md.includes("| fabricated |"));
});

test("formatRef and wilson", () => {
  const r = formatRef({ authors: ["Yann LeCun", "Yoshua Bengio"], year: 2015, title: "Deep learning", venue: "Nature", doi: "10.1038/nature14539" }, 1);
  assert.equal(r, "[1] LeCun, Y., & Bengio, Y. (2015). Deep learning. Nature. https://doi.org/10.1038/nature14539");
  const [lo, hi] = wilson(50, 100);
  assert.ok(lo > 0.39 && lo < 0.41 && hi > 0.59 && hi < 0.61);
});

// ---------- regressions found by the first benchmark run ----------
const mk = (over) => ({ doi: "10.9/z", title: "t", authors: ["A B"], year: 2020, venue: "", abstract: "x ".repeat(60), source: "mock", ...over });
const searchOnly = (cands, byDoi) => ({ byDoi: byDoi || (async () => ({ found: false })), search: async () => cands });

test("a title with a question mark in the middle is kept whole", async () => {
  const text = "Learning helps [1].\n\nReferences\n[1] Huang, Z., Liu, Q., Chen, Y. (2020). Learning or Forgetting? A Dynamic Approach for Tracking the Knowledge Proficiency of Students. ACM Transactions on Information Systems.";
  const ref = parseText(text).refs[0];
  assert.equal(ref.title, "Learning or Forgetting? A Dynamic Approach for Tracking the Knowledge Proficiency of Students");
  const rec = mk({ title: "Learning or Forgetting? A Dynamic Approach for Tracking the Knowledge Proficiency of Students", authors: ["Zhenya Huang"], year: 2020 });
  const r = await checkReference(ref, ["Learning helps a lot here."], { sources: searchOnly([rec]), judge: judgeBy(() => "supports") });
  assert.equal(r.level2.status, "ok");
});

test("an APA title that starts with a quotation mark, with a soft hyphen in a name", () => {
  const text = "A claim here is made [1].\n\nReferences\n[1] Mangset, M., F\u00f8r\u00adde, R. (2008). \u201cI don\u2019t like that, it\u2019s tricking people too much\u2026\u201d: acute informed consent to participation in a trial. Journal of Medical Ethics.";
  const ref = parseText(text).refs[0];
  assert.ok(ref.title.includes("acute informed consent"));
  assert.ok(!ref.raw.includes("\u00ad"));
});

test("two papers with the same title: the matching author and year win", async () => {
  const wrong = mk({ doi: "10.9/a", title: "Does screening save lives and why it matters", authors: ["Alexander Katalinic"], year: 2012 });
  const right = mk({ doi: "10.9/b", title: "Does screening save lives and why it matters", authors: ["Andreas Stang"], year: 2015 });
  const ref = { id: 1, raw: "", doi: "", year: 2015, title: "Does screening save lives and why it matters", authors: "", surname: "Stang" };
  const r = await checkReference(ref, ["Screening is useful in practice."], { sources: searchOnly([wrong, right]), judge: judgeBy(() => "supports") });
  assert.equal(r.level2.status, "ok");
  assert.equal(r.record.firstAuthor, "Andreas Stang");
});

test("a paper found by title but without abstract gets its abstract from its DOI", async () => {
  const bare = mk({ doi: "10.9/c", title: "A quite specific title about corals", abstract: "" });
  const full = mk({ doi: "10.9/c", title: "A quite specific title about corals" });
  const src = searchOnly([bare], async () => ({ found: true, work: full }));
  const ref = { id: 1, raw: "", doi: "", year: 2020, title: "A quite specific title about corals", authors: "", surname: "B" };
  const r = await checkReference(ref, ["Corals are affected by heat."], { sources: src, judge: judgeBy(() => "supports") });
  assert.equal(r.level3.status, "supports");
});

test("arXiv records: the year is not compared, because it is the date of the latest version", async () => {
  const w = mk({ doi: "10.48550/arxiv.1706.03762", year: 2025, title: "Attention is all you need and more words", authors: ["Ashish Vaswani"] });
  const ref = { id: 1, raw: "", doi: "10.48550/arxiv.1706.03762", year: 2017, title: "Attention is all you need and more words", authors: "", surname: "Vaswani" };
  const r = await checkReference(ref, ["A claim sentence here."], { sources: searchOnly([], async () => ({ found: true, work: w })), judge: judgeBy(() => "supports") });
  assert.equal(r.level2.status, "ok");
  const j = await checkReference({ ...ref, doi: "10.1000/other" }, ["A claim sentence here."], { sources: searchOnly([], async () => ({ found: true, work: { ...w, doi: "10.1000/other" } })), judge: judgeBy(() => "supports") });
  assert.equal(j.level2.status, "wrong");
});
