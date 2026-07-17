# Resonant IQ | Public Churn Benchmark Pack (v1)

A self-contained reproduction kit for the LLM-baseline lane of Resonant IQ's
internal churn-prediction accuracy benchmark. Run it yourself against any
OpenAI-compatible chat model and see how it compares to our published numbers.

## What this is

Resonant IQ's core product claim is that our churn-signal engine (a
deterministic, structured-fusion pipeline over CRM/support/product signals)
predicts customer churn more accurately than "just ask an LLM." We built an
internal benchmark to test that claim honestly: a held-out synthetic SaaS
corpus, a strict input contract that only exposes what a human account team
could actually observe, and a scored comparison between our engine and strong
LLM baselines.

This pack reruns the **LLM-baseline arm** of that benchmark: same data
window, same prompt construction, same scoring (see **Known deviations**
below for the one field removed before public release).

- The same 200-account synthetic SaaS corpus (conversations + observable
  events), pre-filtered to strip the label-source data (see **Leakage
  hygiene** below).
- The same held-out outcome labels (T90 cutoff: "will this account churn or
  let its renewal lapse at some point after day 90?").
- The same prompt-construction code (transcript scrubber, JSON input
  contract, prompt template), byte-for-byte identical to what the internal
  harness sent to the model.
- The same scoring code (accuracy, precision, recall, F1, ROC-AUC).

Point `run-benchmark.mjs` at any OpenAI-compatible endpoint and model, and it
reruns the same evaluation harness (same inputs, same prompt construction,
same scoring) against a live model; provider-side model updates can shift
results vs. our run date.

## What's in / what's out

**In scope**: the `B-all` baseline arm, an LLM given the full scrubbed
observable history (transcripts + behavioral events) for an account, in one
shot, asked to predict the held-out future outcome.

**Out of scope**: Resonant IQ's actual churn-signal engine (the deterministic
detector pipeline the LLM baseline is competing against). That arm requires
our production signal-detection code and account-data model, which isn't
something we can ship as a static script: it's the product. This pack lets
you reproduce the baseline half of the comparison and see our published
engine numbers for the other half.

## How to run

```
node run-benchmark.mjs \
  --api-base https://openrouter.ai/api/v1 \
  --model deepseek/deepseek-chat \
  --api-key-env OPENROUTER_API_KEY \
  --concurrency 8
```

Requires:
- Node >= 20 (uses global `fetch`, zero npm dependencies)
- An API key for an OpenAI-compatible endpoint, in the environment variable
  named by `--api-key-env` (default `OPENROUTER_API_KEY`). We used
  [OpenRouter](https://openrouter.ai) internally, which gives access to
  DeepSeek, Kimi, GLM, GPT, Claude, and others through one endpoint, but any
  OpenAI-compatible `/chat/completions` API works.

Flags:
| Flag | Default | Description |
|---|---|---|
| `--api-base` | `https://openrouter.ai/api/v1` | Base URL of the OpenAI-compatible API |
| `--model` | *(required)* | Model id, e.g. `deepseek/deepseek-chat` |
| `--api-key-env` | `OPENROUTER_API_KEY` | Env var holding the API key |
| `--max-accounts` | *(all 178 scorable)* | Cap the run for a quick/cheap smoke test |
| `--concurrency` | `8` | Parallel requests |

Responses are disk-cached under `./.cache/` keyed by `sha256(model + prompt)`,
so a re-run against the same model and data costs nothing.

**Cost**: a full run (178 scored accounts) costs roughly **$3–8** depending on
model choice and pricing. Most of the cost is input tokens (the scrubbed
transcripts + events for each account average several KB of JSON). A
`--max-accounts 10` smoke run costs cents.

**A note on the prompt's wording.** The prompt's final line reads "Respond
by calling the record_prediction tool." That's byte-for-byte the prompt
text the internal study sent, and we've kept it unchanged for prompt parity.
On the OpenAI-compatible path this pack actually uses, there is no
`record_prediction` tool wired up; the real output contract is the JSON
system instruction (`JSON_INSTRUCTION` in `run-benchmark.mjs`) that the
runner sends alongside the prompt, asking for a plain JSON object in the
response. That system instruction is also byte-for-byte identical to what
the study used. Models generally handle the mismatched tool-calling
reference fine, but it's worth knowing it's there rather than assuming a
tool is actually being offered.

## The challenge

Our churn-signal engine (`E-css`, not reproducible from this pack: see
**What's in / what's out**) scored **P 0.94 / R 0.53 / AUC 0.93** on this
exact data (n=178 scored accounts). See `PUBLISHED-RESULTS.md` for the full
table, including our own internal run of this same `B-all` baseline arm
across a six-model panel (GPT-5, Claude Opus 4.8, Gemini 2.5 Pro, DeepSeek,
Kimi K2, GLM-4.6). None of the six did well against it. Every one defaulted
to calling most or all accounts churned (precision landing between 0.18 and
0.23, recall 0.97–1.00), which is a fine way to score high recall and poor
precision. GPT-5 and DeepSeek came closest, with the best precision and
ROC-AUC in the panel.

**Think you can beat the engine's P 0.94 @ R ≥ 0.5 with a different model or a
better prompt strategy, using only this baseline arm?** Run it and reply to
the delivery email with your results: model, metrics, and (if you tweaked
anything) what you changed. We're genuinely interested in seeing where
off-the-shelf models land, and whether a stronger model or smarter prompting
closes the gap our own baseline runs didn't.

## Challenge rules

This is an **open-data reproducibility challenge, not a blind leaderboard**.
We ship the held-out labels (`labels/labels-t90.json`) in the pack so you can
score your own run locally, without waiting on us. That openness comes with
a few rules, on the honor system:

- **Don't read the labels before predicting.** Generate your model's
  predictions from the account data alone (`data/conversations.jsonl` +
  `data/events.jsonl`), the same way `run-benchmark.mjs` does. Only load
  `labels/labels-t90.json` to score predictions you've already made, not to
  inform them.
- **Submissions must be reproducible.** Share the model you used, your full
  prompt or method (if you deviated from the shipped prompt), and your
  metrics output. Post it publicly and tag @resonantiq, open an issue on
  this repository, or email us; all three count.
- **It's honor system, and we may verify.** We may re-run submitted prompts
  ourselves before featuring any results publicly.

## Data provenance

The corpus is **entirely synthetic**, generated by our internal simulation
harness (ResonantForge), not real customer data. It models 200 SaaS accounts
over a 6-month simulated window: support conversations across multiple
channels, billing/lifecycle events, and account behavior, with a mix of
healthy and declining accounts planted by the generator. Labels are the
account's **realized outcome after day 90** (churned / retained), derived
from the generator's ground truth, never guessed, never inferred from the
same data the model sees.

- `data/conversations.jsonl`: 3,071 synthetic support conversations across
  200 accounts (pre-scrubbed at rest, the same sentence-level redaction the
  internal harness applies at prompt-build time; see below).
- `data/events.jsonl`: 10,691 observable lifecycle/billing/support events
  (account creation, payments, tickets, renewals-approaching, conversation
  start/end). Pre-filtered: see **Leakage hygiene**.
- `labels/labels-t90.json`: held-out outcome labels for all 200 accounts at
  the T90 cutoff: 32 churned, 146 retained, 22 excluded (no post-cutoff
  observation horizon, or outcome already resolved before the cutoff: these
  aren't guessable either way, so they're excluded from scoring rather than
  scored as a coin flip).

**Data ships pre-cutoff only.** Both data files are filtered to the T90
observation window before publishing. Nothing after day 90 is included.
Every event with `day_index > 90` is removed from `data/events.jsonl`, and
every conversation whose trigger event falls after day 90 is removed from
`data/conversations.jsonl`. `run-benchmark.mjs` already filters to the same
cutoff at prompt-build time, so this doesn't change what the model sees;
it just means there's no post-cutoff data sitting in the files at rest for
you to accidentally read or leak into your own tooling.

## Leakage hygiene

The whole point of a held-out benchmark is that the answer isn't in the
input. The internal harness enforces this with a **leakage guard**: a
denylist of event types, snapshot fields, and transcript phrasings that would
let a model (or a human) read off the label instead of predicting it. This
pack ships only what passed that guard:

- **Events are filtered.** The raw corpus events file contains generator
  *annotation* events that directly encode or precede the outcome:
  `churn_signal_detected`, `escalation_detected`, `renewal_lapsed`,
  `renewal_completed`, `score_correction`, `coaching_note_issued`. These are
  stripped from `data/events.jsonl`. Only observable events survive:
  account creation, payments (received/failed), support tickets
  (opened/resolved), renewal-approaching notices, and conversation
  start/end markers.
- **Transcripts are pre-scrubbed at rest**, not just at runtime.
  `data/conversations.jsonl` as shipped has already had the internal
  harness's sentence-level redaction applied directly to every transcript's
  `prose` field: any sentence narrating internal health/engagement/lifecycle
  state ("your health score has been trending downward...") is replaced with
  `[redacted: internal account status]`. This means the file is safe to open
  and read directly; nothing sensitive is sitting at rest waiting for a
  scrub step that might not run.

  Note that synthetic account IDs (`acct_001`, etc.) are **not** redacted
  from transcript prose, and that's intentional, not a leak: these are
  synthetic IDs, not information about the outcome. They appear both as
  metadata join keys in the data files (`account_id` fields used to group
  events and conversations) and occasionally inside prose (e.g.
  `Customer_acct_001`). That's the account's own synthetic identity, no
  different from a name. They were present identically in the study's
  prompts, so this isn't a deviation.

  `run-benchmark.mjs` **re-applies the exact same scrubber** to every
  transcript before building a prompt. Because the redaction is idempotent
  (scrubbing an already-scrubbed sentence is a no-op), this produces byte-for-
  byte identical prompts whether the runner reads the pre-scrubbed shipped
  file or a hypothetical raw one. We verified this directly: prompts dumped
  (`--dump-prompt`) for representative accounts from the raw pre-publication
  corpus and from the shipped pre-scrubbed file are SHA-256 identical. The
  runner also still re-asserts (via a ported leakage regex) that no forbidden
  phrasing survives in the final prompt before it's sent to the model: the
  same belt-and-suspenders check the internal harness runs, now simply
  confirming a guarantee the file already provides rather than being the
  only thing enforcing it.

  If you write your own tooling against this corpus instead of using
  `run-benchmark.mjs`, you can read `data/conversations.jsonl` directly
  (the redaction is already baked in), but if you ever regenerate or replace
  it from a raw source, route transcripts through the scrubber (ported at
  the top of `run-benchmark.mjs`) before shipping, or you'll be handing a
  model (or a human reader) the answer key.
- **Labels carry no reasoning.** `labels/labels-t90.json` has only
  `{account_id, outcome, churned}`: no `reason`, no `evidence`, no
  `churnDay`. Those fields exist in the internal label extractor but were
  deliberately dropped here because they leak exact timing.
- **Internal-state snapshots are not shipped at all.** No
  `snapshots.jsonl` (health score/state, lifecycle stage: the actual label
  source), no `activity_events.jsonl`, `contacts.jsonl`, or any of the
  generator's internal bookkeeping (eval expectations, scenario plans,
  planted-theme directives, corrections, disagreements, caches). This pack
  ships only the two files an arm is contractually allowed to see, plus the
  held-out labels for scoring.

We ran an independent leakage sweep on this pack before publishing (grepping
data and label files for lifecycle/renewal/archetype/planted/scenario/health-
state terms): see the pack's build notes if you want to re-run it yourself.

## Known deviations from the internal run

We aim for byte-for-byte prompt parity with the internal study wherever
possible, and verify it directly (see **Leakage hygiene** above). One known
exception:

- **`backfill_target_gate` removed from event payloads.** One generator
  bookkeeping field (`backfill_target_gate`) was stripped from every event
  payload in `data/events.jsonl` before public release. It's an internal
  data-generation artifact with no bearing on churn prediction, and we
  didn't want to ship an unexplained field without a clear reason to keep
  it. This field appeared on 6 accounts (167 events in the internal corpus),
  0 of which churned (base rate across the full corpus is 18%; n=6 is too
  small to carry any exploitable signal either way). Prompts built for
  those 6 accounts differ from the internal run by exactly the absence of
  that key. Nothing else changed. See `PREREGISTRATION.md` for the frozen
  protocol this data was generated under.

## Honest caveats

- This is **one baseline configuration** (single-shot, full-evidence,
  temperature 0) against **one prompt**. It is not an exhaustive sweep of
  prompting strategies, few-shot examples, or agentic/tool-using approaches.
  A sufficiently different approach might do better. We'd like to know if it
  does.
- The corpus is synthetic. It's designed to be realistic (varied channels,
  tones, account archetypes, planted quality issues in some conversations),
  but it is not real customer data and won't perfectly reflect the messiness
  of production support transcripts.
- ROC-AUC and the confusion-matrix metrics are computed over n=178 scored
  accounts, not a huge sample. Treat point estimates as indicative, not
  statistically bulletproof; our internal report additionally computes
  bootstrap confidence intervals, which this pack's simplified scorer does
  not (worth adding if you're doing serious analysis on the results).
- We built and ran this ourselves. We think the leakage guard is solid (three
  independent adversarial reviews caught real leaks before this pack shipped
  the corpus we started from), but you should verify the data yourself if the
  result matters to you: the corpus and runner are both small enough to
  read end to end.

---

Resonant IQ is a churn-signal detection engine for B2B SaaS teams. Learn more
at [resonantiq.app](https://resonantiq.app).
