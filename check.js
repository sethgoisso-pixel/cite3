// check.js - the three levels.
//   Level 1: does the cited paper exist?
//   Level 2: do the details (title, year, first author) match the real record?
//   Level 3: does the paper's abstract support the sentence that cites it?

import { parseText } from "./parse.js";

export function norm(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Dice coefficient on word sets: 1 = same words, 0 = nothing in common.
export function titleSim(a, b) {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return (2 * hit) / (A.size + B.size);
}

// Position of the cited surname in the real author list, or -1.
export function surnamePos(surname, authors) {
  const s = " " + norm(surname) + " ";
  if (s.trim() === "") return 0;
  for (let i = 0; i < authors.length; i++) {
    if ((" " + norm(authors[i]) + " ").includes(s)) return i;
  }
  return -1;
}

function pickBest(title, cands, surname) {
  let best = null;
  for (const c of cands) {
    let sim = titleSim(title, c.title);
    if (sim >= 0.6 && surname && surnamePos(surname, c.authors) >= 0) sim = Math.min(1, sim + 0.02);
    if (!best || sim > best.sim) best = { work: c, sim };
  }
  return best;
}

const ORDER = ["contradicts", "unrelated", "partial", "supports"];
function worst(verdicts) {
  const v = verdicts.filter((x) => ORDER.includes(x.verdict));
  if (!v.length) return { status: "unverifiable", reason: (verdicts[0] && verdicts[0].reason) || "no verdict" };
  v.sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict));
  return { status: v[0].verdict, reason: v[0].reason };
}

export async function checkReference(ref, claimList, deps, opts = {}) {
  const { sources, judge } = deps;
  const out = {
    id: ref.id,
    raw: ref.raw,
    level1: { status: "error" },
    level2: { status: "skipped", issues: [] },
    level3: { status: "skipped" },
    flags: [],
    overall: "unknown",
  };
  let work = null;
  const issues = [];

  try {
    if (ref.doi) {
      const r = await sources.byDoi(ref.doi);
      if (r.found) {
        work = r.work;
        out.level1 = { status: "found", how: "doi" };
      } else {
        out.level1 = { status: "not_found", how: "doi" };
        if (ref.title) {
          const best = pickBest(ref.title, await sources.search(ref.title), ref.surname);
          if (best && best.sim >= 0.85) {
            work = best.work;
            out.level1 = { status: "found", how: "title" };
            issues.push({ kind: "doi_not_found", level: "wrong", detail: "this DOI does not exist, but a paper with this title does" });
          }
        }
      }
    } else if (ref.title) {
      const best = pickBest(ref.title, await sources.search(ref.title), ref.surname);
      if (best && best.sim >= 0.85) {
        work = best.work;
        out.level1 = { status: "found", how: "title" };
      } else if (best && best.sim >= 0.6) {
        out.level1 = { status: "uncertain", how: "title", candidate: best.work.title };
      } else {
        out.level1 = { status: "not_found", how: "title" };
      }
    } else {
      out.level1 = { status: "error", note: "no DOI or title found in this reference" };
    }
  } catch (e) {
    out.level1 = { status: "error", note: String(e.message).slice(0, 120) };
  }

  if (work) {
    if (ref.title) {
      const s = titleSim(ref.title, work.title);
      if (s < 0.6) issues.push({ kind: "title_mismatch", level: "wrong", detail: `cited title does not match the record "${work.title}"` });
      else if (s < 0.85) issues.push({ kind: "title_differs", level: "minor", detail: `title differs a little from "${work.title}"` });
    }
    if (ref.year && work.year) {
      const d = Math.abs(ref.year - work.year);
      if (d >= 2) issues.push({ kind: "year_mismatch", level: "wrong", detail: `cited year ${ref.year}, record says ${work.year}` });
      else if (d === 1) issues.push({ kind: "year_off_by_one", level: "minor", detail: `cited year ${ref.year}, record says ${work.year}` });
    }
    if (ref.surname && work.authors.length) {
      const pos = surnamePos(ref.surname, work.authors);
      if (pos === -1) issues.push({ kind: "author_mismatch", level: "wrong", detail: `"${ref.surname}" is not among the authors (first author: ${work.authors[0]})` });
      else if (pos > 0) issues.push({ kind: "author_order", level: "minor", detail: `"${ref.surname}" is author number ${pos + 1}, not first` });
    }
    out.level2 = {
      status: issues.some((i) => i.level === "wrong") ? "wrong" : issues.length ? "minor" : "ok",
      issues,
    };
    out.record = { doi: work.doi, title: work.title, year: work.year, firstAuthor: work.authors[0] || "", hasAbstract: work.abstract.length >= 80 };

    const claims = claimList || [];
    if (!claims.length) {
      out.level3 = { status: "skipped", reason: "no sentence cites this reference" };
    } else if (opts.runAllLevels || out.level2.status !== "wrong") {
      if (work.abstract.length < 80) {
        out.level3 = { status: "unverifiable", reason: "no abstract available for this paper" };
      } else {
        const verdicts = [];
        for (const c of claims.slice(0, 2)) verdicts.push(await judge({ claim: c, title: work.title, abstract: work.abstract }));
        out.level3 = worst(verdicts);
      }
    } else {
      out.level3 = { status: "skipped", reason: "not checked: the details are already wrong" };
    }
  }

  const l1 = out.level1.status;
  const l2 = out.level2.status;
  const l3 = out.level3.status;
  if (l1 === "not_found") out.flags.push("fabricated");
  if (l2 === "wrong") out.flags.push("wrong_details");
  if (l3 === "contradicts" || l3 === "unrelated") out.flags.push("misused");
  if (out.flags.length) out.overall = "bad";
  else if (l1 === "error") out.overall = "unknown";
  else if (l1 === "uncertain" || l2 === "minor" || l3 === "partial") out.overall = "warn";
  else if (l3 === "unverifiable") out.overall = "unknown";
  else out.overall = "ok";
  return out;
}

// What each simpler checker would have flagged, from the same recorded run.
export function flaggedBy(variant, r) {
  const l1 = r.level1.status === "not_found";
  const l2 = r.level2.status === "wrong";
  const l3 = r.level3.status === "contradicts" || r.level3.status === "unrelated";
  if (variant === "L1") return l1;
  if (variant === "L1L2") return l1 || l2;
  return l1 || l2 || l3;
}

export async function checkText(text, deps, opts = {}) {
  const parsed = parseText(text);
  const results = [];
  for (const ref of parsed.refs) {
    results.push(await checkReference(ref, parsed.claims[ref.id], deps, opts));
    if (opts.onProgress) opts.onProgress(results.length, parsed.refs.length, results[results.length - 1]);
  }
  return { parsed, results };
}
