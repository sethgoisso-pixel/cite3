## Cite 3 results
Judge models: gemini-3.1-flash-lite, gemini-3.5-flash-lite. Cases: 197. Date: 2026-10-23.

Share of cases each checker flags. 95% confidence interval in brackets. For `correct` cases, lower is better (false alarms). For the others, higher is better (errors caught).

| Case type | Valid runs | Level 1 only (exists?) | Levels 1+2 (+ details) | Levels 1+2+3 (+ claim) |
|---|---|---|---|---|
| correct (false alarms) | 40/40 | 0% (0-9) | 5% (1-17) | 5% (1-17) |
| fabricated | 37/37 | 92% (79-97) | 92% (79-97) | 92% (79-97) |
| wrong_details | 40/40 | 0% (0-9) | 98% (87-100) | 98% (87-100) |
| misused | 40/40 | 0% (0-9) | 0% (0-9) | 95% (83-99) |
| contradicted | 40/40 | 0% (0-9) | 0% (0-9) | 90% (77-96) |

Runs with a lookup error (network, rate limit) are left out of the percentages and counted in the second column.
