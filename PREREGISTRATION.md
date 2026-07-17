> Source: `docs/benchmarks/2026-07-17-holdout-freeze-manifest.md`, commit
> `08fdd75a100bae9c26ae40e3b3fa38e5f55029dc` (2026-07-17), internal
> `resonantiq` repository. This manifest was committed to a private
> repository before the holdout corpus was generated. Reproduced verbatim
> here.

---

# Holdout freeze manifest (RIQAPP-1051) — written BEFORE the holdout run

Per the CSS design's rule 8: everything below is frozen as of this commit.
**One holdout run. No iteration against holdout results.** Any change after
seeing holdout numbers restarts with a new holdout corpus.

## Frozen system under test
- Engine: resonantiq main including RIQAPP-1055 (intent threshold 0.45),
  RIQAPP-1056 (champion recency gate), RIQAPP-1057 (engagement_decline_sustained)
  — merged commit set as of 2026-07-16.
- CSS scoring arm: `src/lib/benchmark/arms/css.ts` exactly as at commit c51d4bf3 —
  severity extractors, CSS_WEIGHTS (published in-file), tier thresholds
  τ_hi=0.20 / τ_lo=0.08, family-fire 0.25, the dark×intent interaction, the two
  hard exceptions. No retuning of any constant.
- Intent pipeline: production summarizer prompt (Haiku), voyage-3-lite,
  threshold 0.45; fires ledger via scripts/benchmark-intent-report.ts;
  30-day freshness window in assembleIntentSignals.

## Frozen protocol
- Corpus: 200 accounts / 6 months, plan docs/benchmarks/plan-holdout.json
  (same predeclared archetype counts as dev: CHURNING 55 / DECLINING 32 /
  CRITICAL 20 / RECOVERING 20 / STABLE 45 / THRIVING 28; NEW shuffle seed 777),
  generator seed 1337 (dev used 42), prose = Llama-3.3-70B de-hybridized,
  concurrency 8.
- Primary cutoff T=90 (predeclared); T=60/120 secondary diagnostics only.
- Panel (identical prompts/inputs, disk-cached): GPT-5 (openai/gpt-5),
  Claude Opus 4.8 (native, claude-opus-4-8), Gemini 2.5 Pro
  (google/gemini-2.5-pro), DeepSeek (deepseek/deepseek-chat),
  Kimi (moonshotai/kimi-k2), GLM (z-ai/glm-4.6).
- Headline metrics: AUROC + precision/recall at the frozen tiers; stratified by
  cohort; case-enriched framing (no natural-prevalence PPV claims).
- Allowed non-result-driven adjustments: archetype-sanity exemptions for
  boundary accounts (documented, RFORGE-91 mechanism — corpus-coherence, not
  scoring), and provider-plumbing fixes that don't alter prompts or scoring.

## Declared expectations (written before the run)
- E-css dev numbers (acc 0.94 / P 1.00 / R 0.67 / AUC 0.95) were threshold-tuned
  on dev; regression on holdout is expected and honest. Success bar:
  AUC ≥ 0.85 and precision ≥ 0.7 at recall ≥ 0.5, and E-css ≥ every panel
  model on precision at comparable recall.
- LLM over-flagging (recall ~1.0, precision ~0.2) is pre-registered as a
  hypothesis to confirm or refute on the holdout.

## Amendment 1 (2026-07-17, pre-scoring)

Seed 1337's corpus FAILED the pre-existing already-silent cohort cap
(22/87 at-risk = 25.3% > 25%) — a corpus-validity gate, not a scoring result;
eval-expectations was never exported and no model scored the corpus. Holdout
regenerates with seed 1338, all other frozen parameters unchanged. This
amendment is recorded before any scoring of any holdout corpus.

## Amendment 2 (2026-07-17, pre-scoring)

Seed 1338 landed at the identical cohort-cap boundary (22/87 = 25.3%) as seed
1337 — structural quantization, not seed luck (achievable fractions step by
1/87; already-silent churners are also excluded from the scorable outcome set).
The cap check gains an integer-quantization tolerance: fail only when the count
exceeds ceil(cap·N) (i.e. 23+/87). Amended and committed before any scoring of
this corpus; seed 1338 corpus is accepted. One shallow-taper DECLINING account
(acct_115) carries the documented per-account exemption (same class as dev's 3).
