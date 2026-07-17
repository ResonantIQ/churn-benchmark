# Methodology

How this pack reproduces the internal LLM-baseline arm of Resonant IQ's
churn-prediction benchmark: what `B-all` means, how prompts get built, where
this run necessarily deviates from the internal one, and what to keep in
mind about reproducibility.

## The `B-all` baseline arm

This pack reproduces the `B-all` arm: an LLM given the full scrubbed
observable history (transcripts + behavioral events) for an account, in one
shot, asked to predict the held-out future outcome. Resonant IQ's
churn-signal engine (`E-css`), the deterministic detector pipeline `B-all`
is scored against, is out of scope here: it requires the production
signal-detection code and account-data model, which isn't something we can
ship as a static script, since it's the product. This pack reproduces the
baseline half of the comparison; see `PUBLISHED-RESULTS.md` for the
engine's published numbers on the other half.

## Prompt construction

`run-benchmark.mjs` builds prompts with the same code as the internal
harness: the transcript scrubber, the JSON input contract, and the prompt
template, byte-for-byte identical to what was sent to the model internally.
It also uses the same scoring code (accuracy, precision, recall, F1,
ROC-AUC). Point the runner at any OpenAI-compatible endpoint and model, and
it reruns that same prompt construction and scoring against a live model.

## The `record_prediction` tool reference

The prompt's final line reads "Respond by calling the record_prediction
tool." That's byte-for-byte the prompt text the internal study sent, kept
unchanged for prompt parity. On the OpenAI-compatible path this pack uses,
there is no `record_prediction` tool wired up: the actual output contract
is the JSON system instruction (`JSON_INSTRUCTION` in `run-benchmark.mjs`)
sent alongside the prompt, asking for a plain JSON object in the response.
That system instruction is also byte-for-byte identical to what the study
used. Models generally handle the mismatched tool-calling reference without
issue, since the JSON instruction is what actually governs the output
format.

## Known deviations from the internal run

We aim for byte-for-byte prompt parity with the internal study wherever
possible (see `LEAKAGE.md` for the scrubbing-parity verification). One
known exception:

- **`backfill_target_gate` removed from event payloads.** One generator
  bookkeeping field (`backfill_target_gate`) was stripped from every event
  payload in `data/events.jsonl` before public release. It's an internal
  data-generation artifact with no bearing on churn prediction. This field
  appeared on 6 accounts (167 events in the internal corpus), 0 of which
  churned (base rate across the full corpus is 18%; n=6 is too small to
  carry exploitable signal either way). Prompts built for those 6 accounts
  differ from the internal run by exactly the absence of that key; nothing
  else changed. See `PREREGISTRATION.md` for the frozen protocol this data
  was generated under.

## Reproducibility and model drift

- This is one baseline configuration (single-shot, full-evidence,
  temperature 0) against one prompt, not an exhaustive sweep of prompting
  strategies, few-shot examples, or agentic/tool-using approaches. A
  sufficiently different approach might do better; see `README.md` →
  **The challenge**.
- Provider-side model updates can shift results from our run date. Live
  re-runs against provider endpoints don't guarantee identical model
  outputs run to run, even at `temperature: 0`.
- ROC-AUC and the confusion-matrix metrics are computed over n=178 scored
  accounts, not a large sample; treat point estimates as indicative rather
  than statistically conclusive. Our internal report additionally computes
  bootstrap confidence intervals, which this pack's simplified scorer does
  not.
- The corpus is synthetic: varied in channels, tones, account archetypes,
  and planted quality issues, but not real customer data, so it won't
  perfectly reflect the messiness of production support transcripts.
- The corpus and runner are both small enough to read end to end; verify
  the data yourself if the result matters to your decision.
