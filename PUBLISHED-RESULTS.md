# Published results (internal run)

Pre-registered run (see `PREREGISTRATION.md`), scored on this exact corpus,
T90 cutoff. All-evidence (`B-all` / `E-css`) slice: 178 scorable accounts
(32 positives, 146 negatives; 22 accounts excluded from scoring: see
`README.md` → **Data provenance**). Run date: **2026-07-17**. These are the
numbers to compare your own run against.

| arm | what it is | reproducible from this pack? | n | positives | acc | P | R | F1 | AUC |
|---|---|---|---|---|---|---|---|---|---|
| Resonant IQ engine (internal arm label: `E-css`) | deterministic churn-signal engine | **No**: requires our production pipeline | 178 | 32 | 0.91 | **0.94** | **0.53** | 0.68 | **0.93** |
| `B-all` @ `openai/gpt-5` (OpenRouter) | LLM baseline, full evidence, one-shot | **Yes: this pack** | 178 | 32 | 0.34 | 0.21 | 0.97 | 0.34 | 0.75 |
| `B-all` @ `claude-opus-4-8` (Anthropic native API) | LLM baseline, full evidence, one-shot | **Yes: this pack** | 178 | 32 | 0.19 | 0.18 | 1.00 | 0.31 | 0.78 |
| `B-all` @ `google/gemini-2.5-pro` (OpenRouter) | LLM baseline, full evidence, one-shot | **Yes: this pack** | 178 | 32 | 0.19 | 0.18 | 1.00 | 0.31 | 0.64 |
| `B-all` @ `deepseek/deepseek-chat` (OpenRouter) | LLM baseline, full evidence, one-shot | **Yes: this pack** | 178 | 32 | 0.40 | 0.23 | 1.00 | 0.37 | 0.70 |
| `B-all` @ `moonshotai/kimi-k2` (OpenRouter) | LLM baseline, full evidence, one-shot | **Yes: this pack** | 178 | 32 | 0.22 | 0.19 | 1.00 | 0.32 | 0.63 |
| `B-all` @ `z-ai/glm-4.6` (OpenRouter) | LLM baseline, full evidence, one-shot | **Yes: this pack** | 178 | 32 | 0.21 | 0.18 | 1.00 | 0.31 | 0.61 |

## Run metadata

- **OpenRouter runs** (`openai/gpt-5`, `google/gemini-2.5-pro`,
  `deepseek/deepseek-chat`, `moonshotai/kimi-k2`, `z-ai/glm-4.6`):
  `temperature: 0`, `max_tokens: 8192`, `reasoning: { effort: "low" }`
  (stripped automatically on retry where the provider rejects the param),
  `response_format: { type: "json_object" }` with a plain-text-JSON fallback
  if the provider rejects structured outputs. Disk-cached
  (`sha256(model + prompt)`).
- **Anthropic native run** (`claude-opus-4-8`): forced tool-choice,
  `max_tokens: 1024`, no `temperature` param sent. Disk-cached.
- **Model versions**: as resolved by each provider on the run date
  (2026-07-17). Providers may route model IDs to newer underlying
  checkpoints without notice.

## Reading this table

- **The Resonant IQ engine row is the headline number**: our production engine, a deterministic
  structured-fusion pipeline over CRM/support/product signals. This is the
  target to beat: **P 0.94 @ R ≥ 0.5** was the bar in our own internal
  write-up.
- **`B-all` is what this pack reproduces**, across a panel of six models. All
  six converged on the same failure mode: high recall, low precision, because
  an LLM given the full scrubbed evidence tends to flag most accounts as
  at-risk, which buys close-to-perfect recall at the cost of precision. A
  model that always predicts positive gets recall 1.00 and precision equal
  to the base rate (32/178 ≈ 0.18). Several of these runs land close to
  that degenerate point; `openai/gpt-5` and `deepseek/deepseek-chat` did
  meaningfully better on precision (0.21 and 0.23) without sacrificing much
  recall, and posted the best ROC-AUC in the panel (0.75 and 0.70), showing
  the strongest underlying ranking signal even though their calibrated
  thresholds still over-flag.
- None of the six baseline runs come close to the Resonant IQ engine on precision at
  comparable recall: the engine's structured-fusion approach still
  outperforms a one-shot LLM read of the same evidence.
- **Live re-runs may drift.** This pack reruns the same harness against
  live provider endpoints; it does not guarantee identical model outputs
  run to run. Provider-side model updates, routing changes, or sampling
  variance can shift your numbers from what's published here, even at
  `temperature: 0`.
- Different models, prompts, or agentic/tool-using approaches may do better
  than any of the six baselines above. We didn't sweep prompting strategies
  exhaustively; see `README.md` → **The challenge**.
