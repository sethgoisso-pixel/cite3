## Cite 3 results
Judge models: gemini-3.1-flash-lite, gemini-3.5-flash-lite. Cases: 200. Date: 2026-10-24.

Share of cases each checker flags. 95% confidence interval in brackets. For `correct` cases, lower is better (false alarms). For the others, higher is better (errors caught).

| Case type | Valid runs | Level 1 only (exists?) | Levels 1+2 (+ details) | Levels 1+2+3 (+ claim) | Any alert, incl. warnings |
|---|---|---|---|---|---|
| correct (false alarms) | 40/40 | 0% (0-9) | 0% (0-9) | 0% (0-9) | 8% (3-20) |
| fabricated | 40/40 | 78% (62-88) | 80% (65-90) | 80% (65-90) | 100% (91-100) |
| wrong_details | 40/40 | 0% (0-9) | 100% (91-100) | 100% (91-100) | 100% (91-100) |
| misused | 40/40 | 0% (0-9) | 0% (0-9) | 100% (91-100) | 100% (91-100) |
| contradicted | 40/40 | 0% (0-9) | 0% (0-9) | 90% (77-96) | 90% (77-96) |

Cases where level 3 could not judge because no abstract was available: 0. They count as not flagged.

Runs with a lookup error (network, rate limit) are left out of the percentages and counted in the second column.
