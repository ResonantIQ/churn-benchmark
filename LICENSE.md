# Resonant IQ Benchmark Data License v1.0

This license covers the data files in this pack: `data/conversations.jsonl`,
`data/events.jsonl`, and `labels/labels-t90.json` (together, "the Data"). The
runner script (`run-benchmark.mjs`) is provided as-is for your inspection and
local use; feel free to read it, modify your local copy, and adapt it for
your own evaluation harness.

## Permitted

- Download the Data and use it locally.
- Evaluate and benchmark any model (commercial, open-source, or your own)
  against the Data.
- Publish your own results and metrics from running this benchmark, with
  attribution to "Resonant IQ Churn Benchmark v1".

## Prohibited

- Redistributing the Data or any derivative of the Data files (re-hosting,
  re-packaging, or sharing `data/conversations.jsonl`, `data/events.jsonl`,
  or `labels/labels-t90.json` outside your own organization). Link people to
  the original delivery instead.
- Using the Data, or model outputs produced by running against it, to train
  or fine-tune any model.
- Representing the synthetic accounts in the Data as real customer data.

## No warranty

The Data and the runner script are provided "as is," with no warranty of any
kind, express or implied, including without limitation any warranty of
accuracy, fitness for a particular purpose, or non-infringement. Resonant IQ
makes no guarantee about API costs, model availability, or the behavior of
any model you choose to run against the Data.

Questions about these terms: reply to the delivery email.
