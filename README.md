# Cite 3

Checks the sources cited in a text at **three levels**, and measures how much each level really catches.

1. **Does the source exist?** Looked up in Crossref and OpenAlex (free, no key).
2. **Do the details match?** Title, year and first author compared with the real record.
3. **Does the source support the sentence?** A Gemini model reads the paper's abstract and the sentence that cites it.

Why three levels: a source can exist and still be cited wrongly. A checker that only looks at level 1 misses a real paper cited for something it never says.

## How it is measured

`bench-run.mjs` builds a labelled test set from real papers (OpenAlex sample), so the right answer is known:

| Case type | What is wrong |
|---|---|
| correct | nothing (measures false alarms) |
| fabricated | invented reference (fake title, and a fake DOI in half the cases) |
| wrong_details | real paper, wrong year / wrong first author / real DOI with another paper's title |
| misused | real paper, right details, but unrelated to the sentence |
| contradicted | real paper, right details, but the sentence says the opposite |

Each case is checked three times from the same run: level 1 only, levels 1+2, and levels 1+2+3. Results are in `summary.md` and `results.json` after a run.

## Run it

Everything runs in GitHub Actions. Add a repository secret named `LLM_API_KEY` (a free Google AI Studio key), then open **Actions > Cite 3 benchmark > Run workflow**.

- `smoke`: a one-minute check that Crossref, OpenAlex and Gemini all answer.
- `run`: the full benchmark (about 30 minutes). Results are committed to the repository.

Tests (no network needed): `node --test`

## Development log

First run (seed 1, 197 cases) confirmed the idea: levels 1 and 2 caught 0% of real papers that do not support the sentence, level 3 caught 95% (unrelated) and 90% (opposite). It also had 5% false alarms and missed 3 fabricated references. Looking at each error found four real defects, all fixed:

1. A title with a question mark in the middle was cut at the question mark.
2. A title starting with a quotation mark was parsed wrongly, and soft hyphens in names broke matching.
3. Two papers with the same title: the checker now prefers the one whose author and year match.
4. A paper found by title with no abstract now gets its abstract from its DOI.

Because the checker was fixed after looking at that sample, the final numbers come from a second run on a fresh sample of papers (seed 2). The first run stays in the git history.

## Limits

- The judge only sees the abstract, not the full paper.
- The test set is synthetic: references are generated from real papers, not collected from real AI answers.
- Small test set: read the confidence intervals, not just the percentages.
- Free-tier models can change or hit rate limits; the run records lookup errors separately.

MIT license.
