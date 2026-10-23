// sources.js - look papers up in Crossref and OpenAlex (both free, no key).
// Works in Node and in the browser. fetch is injectable so tests can fake it.

const CR = "https://api.crossref.org";
const OA = "https://api.openalex.org";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function rebuildAbstract(idx) {
  if (!idx || typeof idx !== "object") return "";
  const words = [];
  for (const [w, positions] of Object.entries(idx)) {
    for (const p of positions) words[p] = w;
  }
  return words.filter((w) => w !== undefined).join(" ");
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function normCrossref(m) {
  const dp = (k) => m[k] && m[k]["date-parts"] && m[k]["date-parts"][0] && m[k]["date-parts"][0][0];
  return {
    doi: String(m.DOI || "").toLowerCase(),
    title: stripTags((m.title || [])[0]),
    authors: (m.author || []).map((a) => a.name || [a.given, a.family].filter(Boolean).join(" ")),
    year: dp("issued") || dp("published-print") || dp("published-online") || 0,
    venue: stripTags((m["container-title"] || [])[0]),
    abstract: stripTags(m.abstract).replace(/^abstract\s*/i, ""),
    source: "crossref",
  };
}

export function normOpenAlex(w) {
  const src = w.primary_location && w.primary_location.source;
  return {
    doi: String(w.doi || "").replace(/^https?:\/\/doi\.org\//i, "").toLowerCase(),
    title: stripTags(w.title || w.display_name),
    authors: (w.authorships || []).map((a) => (a.author && a.author.display_name) || "").filter(Boolean),
    year: w.publication_year || 0,
    venue: (src && src.display_name) || "",
    abstract: rebuildAbstract(w.abstract_inverted_index),
    source: "openalex",
  };
}

async function getJson(fetchImpl, url, tries = 3, retryMs = 1000) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return { status: 404, json: null };
      if (res.status === 429 || res.status >= 500) {
        last = new Error("HTTP " + res.status);
        await sleep(retryMs * 1.5 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return { status: 200, json: await res.json() };
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(retryMs * (i + 1));
    }
  }
  throw last || new Error("request failed");
}

export function makeSources({ fetchImpl = globalThis.fetch, mailto = "", retryMs = 1000 } = {}) {
  const getJ = (f, url) => getJson(f, url, 3, retryMs);
  const q1 = mailto ? "?mailto=" + encodeURIComponent(mailto) : "";
  const q2 = mailto ? "&mailto=" + encodeURIComponent(mailto) : "";
  const doiPath = (doi) => encodeURIComponent(doi).replace(/%2F/gi, "/");

  return {
    // -> { found: true, work } | { found: false }. Throws when it cannot tell.
    async byDoi(doi) {
      let work = null;
      const errors = [];
      try {
        const r = await getJ(fetchImpl, `${CR}/works/${doiPath(doi)}${q1}`);
        if (r.status === 200 && r.json && r.json.message) work = normCrossref(r.json.message);
      } catch (e) {
        errors.push(e);
      }
      if (!work || !work.abstract) {
        try {
          const r = await getJ(fetchImpl, `${OA}/works/doi:${doiPath(doi)}${q1}`);
          if (r.status === 200 && r.json) {
            const o = normOpenAlex(r.json);
            work = work ? { ...work, abstract: work.abstract || o.abstract } : o;
          }
        } catch (e) {
          errors.push(e);
        }
      }
      if (work) return { found: true, work };
      if (errors.length) throw errors[0];
      return { found: false };
    },

    // -> array of candidate works (may be empty). Throws when both sources fail.
    async search(title) {
      const out = [];
      const errors = [];
      try {
        const r = await getJ(fetchImpl, `${OA}/works?search=${encodeURIComponent(title)}&per-page=5${q2}`);
        for (const w of (r.json && r.json.results) || []) out.push(normOpenAlex(w));
      } catch (e) {
        errors.push(e);
      }
      try {
        const r = await getJ(fetchImpl, `${CR}/works?query.bibliographic=${encodeURIComponent(title)}&rows=5${q2}`);
        for (const m of (r.json && r.json.message && r.json.message.items) || []) out.push(normCrossref(m));
      } catch (e) {
        errors.push(e);
      }
      if (!out.length && errors.length === 2) throw errors[0];
      return out;
    },

    // Random real papers with an abstract, for building the test set.
    async sampleWorks(n, seed = 1) {
      const filter = "has_abstract:true,has_doi:true,type:article,language:en,cited_by_count:%3E50,publication_year:2008-2023";
      const url = `${OA}/works?filter=${filter}&sample=${n}&seed=${seed}&per-page=${Math.min(200, n)}${q2}`;
      const r = await getJ(fetchImpl, url);
      return ((r.json && r.json.results) || [])
        .map(normOpenAlex)
        .filter((w) => w.doi.startsWith("10.") && w.title && w.authors.length && w.year && w.abstract.length >= 300);
    },
  };
}
