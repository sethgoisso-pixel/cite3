// parse.js - split a pasted text into its body and its reference list,
// pull each reference apart, and find the sentences that cite each one.

const HEAD = /^[ \t]*(?:#+[ \t]*)?(references|bibliography|works cited|sources)[ \t]*:?[ \t]*$/gim;
const ENTRY = /^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+/;
const DOI_RE = /10\.\d{4,9}\/[^\s"<>]+/;
const MARKER = /\[(\d{1,3}(?:\s*[,\u2013-]\s*\d{1,3})*)\]/g;

export function splitText(text) {
  const t = String(text || "").replace(/\r/g, "");
  let last = null;
  for (const m of t.matchAll(HEAD)) last = m;
  if (last) {
    return { body: t.slice(0, last.index), refBlock: t.slice(last.index + last[0].length) };
  }
  const lines = t.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (/^\s*\[1\]\s+\S/.test(lines[i])) start = i;
  if (start < 0) return { body: t, refBlock: "" };
  return { body: lines.slice(0, start).join("\n"), refBlock: lines.slice(start).join("\n") };
}

function firstSentence(s) {
  const m = /^(.+?[?!])(\s|$)/.exec(s) || /^(.+?)(\.\s|\.$|$)/.exec(s);
  return (m ? m[1] : s).trim();
}

export function firstSurname(authors) {
  const a = String(authors || "").replace(/^\s*(and|&)\s+/i, "").trim();
  if (!a) return "";
  const isInit = (x) => /^([A-Z]\.?){1,3}$/.test(x);
  const seg = a.split(",")[0].split(/\s+(?:and|&)\s+/)[0].trim();
  const tokens = seg.split(/\s+/);
  if (tokens.length > 1 && isInit(tokens[0])) return tokens[tokens.length - 1]; // A. Surname
  if (/^[^,]+,\s*[A-Z]\.?(\s|,|$)/.test(a)) return a.split(",")[0].trim(); // Surname, A.
  if (tokens.length === 1) return tokens[0];
  if (isInit(tokens[0])) return tokens[tokens.length - 1]; // A. Surname
  if (isInit(tokens[tokens.length - 1])) return tokens[0]; // Surname AB
  return tokens[tokens.length - 1]; // Given Surname
}

function parseOne(r) {
  const raw = r.raw.replace(/\s+/g, " ").trim();
  const dm = DOI_RE.exec(raw);
  const doi = dm ? dm[0].replace(/[.,;)\]]+$/, "").toLowerCase() : "";
  const rest = raw
    .replace(/(https?:\/\/(dx\.)?doi\.org\/)?10\.\d{4,9}\/[^\s"<>]+/gi, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\bdoi:?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const ym = /\((\d{4})[a-z]?\)/.exec(rest) || /\b(19\d{2}|20\d{2})\b/.exec(rest);
  const year = ym ? Number(ym[1]) : 0;
  let authors = "";
  let title = "";
  const q = /["\u201c]([^"\u201d]{8,})["\u201d]/.exec(rest);
  const apa = /^(.*?)\(\d{4}[a-z]?\)\.?\s*(.*)$/.exec(rest);
  if (q) {
    title = q[1].replace(/[.,]$/, "").trim();
    authors = rest.slice(0, q.index).replace(/[,\s]+$/, "");
  } else if (apa) {
    authors = apa[1].trim().replace(/[.,\s]+$/, "");
    title = firstSentence(apa[2]);
  } else {
    const parts = rest.split(/\.\s+/).map((x) => x.trim()).filter(Boolean);
    authors = parts[0] || "";
    title = parts[1] || "";
  }
  return { id: r.id, raw, doi, year, title, authors, surname: firstSurname(authors) };
}

export function parseReferences(block) {
  const items = [];
  let cur = null;
  for (const line of String(block || "").split("\n")) {
    const m = ENTRY.exec(line);
    if (m) {
      cur = { id: Number(m[1] || m[2]), raw: line.slice(m[0].length).trim() };
      items.push(cur);
    } else if (cur && line.trim()) {
      cur.raw += " " + line.trim();
    }
  }
  return items.map(parseOne);
}

export function extractClaims(body) {
  const out = {};
  const sentences = String(body || "").split(/(?<=[.!?])\s+(?=[A-Z0-9"(\[])/);
  let prev = "";
  for (const s of sentences) {
    const ids = new Set();
    for (const m of s.matchAll(MARKER)) {
      for (const part of m[1].split(/\s*,\s*/)) {
        const range = /^(\d+)\s*[\u2013-]\s*(\d+)$/.exec(part);
        if (range) {
          const a = Number(range[1]);
          const b = Math.min(Number(range[2]), a + 50);
          for (let k = a; k <= b; k++) ids.add(k);
        } else if (/^\d+$/.test(part)) ids.add(Number(part));
      }
    }
    const clean = s.replace(MARKER, "").replace(/\s+([.,;:])/g, "$1").replace(/\s+/g, " ").trim();
    if (!ids.size) {
      if (clean.length >= 12) prev = clean;
      continue;
    }
    // A sentence that is only a marker ("... done. [1]") belongs to the sentence before it.
    const text = clean.length < 12 ? prev : clean;
    if (text.length < 12) continue;
    for (const id of ids) (out[id] ||= []).push(text);
    prev = text;
  }
  return out;
}

export function parseText(text) {
  const { body, refBlock } = splitText(text);
  return { refs: parseReferences(refBlock), claims: extractClaims(body) };
}
