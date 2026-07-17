#!/usr/bin/env node
// run-benchmark.mjs — Resonant IQ public Churn Benchmark Pack (GTM-195)
//
// Single-file, zero-dependency Node (>=20) reproduction of the "B-all" LLM
// baseline arm from the Resonant IQ internal churn accuracy benchmark
// (RIQAPP-1051). It ports, verbatim where noted, the following pieces of the
// internal harness (src/lib/benchmark/*.ts):
//   - scrubTranscript()        (scrubber.ts)              — sentence-level redaction
//   - findTranscriptLeaks()    (leakage.ts)                — belt-and-suspenders guard
//   - buildAccountInputs()     (input-contract.ts)         — pre-cutoff assembly
//   - serializeInputs()        (input-contract.ts)         — exact JSON shape
//   - buildBaselinePrompt()    (arms/llm-baseline.ts)      — VERBATIM prompt text
//   - makeOpenAICompatPredictor() (arms/openai-baseline.ts) — OpenAI-compatible call
//   - confusion() / rocAuc()   (score.ts)                  — scoring
//
// Usage:
//   node run-benchmark.mjs --api-base https://openrouter.ai/api/v1 \
//     --model deepseek/deepseek-chat \
//     [--api-key-env OPENROUTER_API_KEY] [--max-accounts N] [--concurrency 8]
//
// Requires an API key in the environment variable named by --api-key-env
// (default OPENROUTER_API_KEY). Responses are disk-cached under ./.cache
// keyed by sha256(model + prompt), so re-runs of the same model/data are free.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUTOFF_DAY = 90; // T90 — matches labels/labels-t90.json

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    'api-base': 'https://openrouter.ai/api/v1',
    'api-key-env': 'OPENROUTER_API_KEY',
    'max-accounts': undefined,
    concurrency: 8,
    model: undefined,
    'dump-prompt': undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    args[key] = val;
    i++;
  }
  return args;
}

const argv = parseArgs(process.argv.slice(2));

if (!argv.model) {
  console.error('Usage: node run-benchmark.mjs --api-base URL --model NAME [--api-key-env OPENROUTER_API_KEY] [--max-accounts N] [--concurrency 8]');
  process.exit(1);
}

const API_BASE = argv['api-base'].replace(/\/$/, '');
const MODEL = argv.model;
const API_KEY_ENV = argv['api-key-env'];
const API_KEY = process.env[API_KEY_ENV];
const MAX_ACCOUNTS = argv['max-accounts'] ? Number(argv['max-accounts']) : undefined;
const CONCURRENCY = argv.concurrency ? Number(argv.concurrency) : 8;
const DUMP_PROMPT = argv['dump-prompt'];

if (!API_KEY && !DUMP_PROMPT) {
  console.error(`Missing API key: environment variable ${API_KEY_ENV} is not set.`);
  process.exit(1);
}

// ─── JSONL loading ───────────────────────────────────────────────────────────

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line));
  }
  return out;
}

function groupByAccount(rows) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.account_id);
    if (list) list.push(row);
    else map.set(row.account_id, [row]);
  }
  return map;
}

// ─── scrubTranscript — ported verbatim from src/lib/benchmark/scrubber.ts ───

const REDACT_SENTENCE_PATTERNS = [
  /\bhealth/i,
  /\bdeclin/i,
  /\bengagement\b/i,
  /\b0\.\d+\b/,
  /trending downward/i,
  /\bcritical\s+(?:state|status)/i,
];

const ACCOUNT_ID_PATTERN = /\bacct_\d+/gi;
const REDACTION_MARKER = '[redacted: internal account status]';

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/);
}

function scrubTranscript(text) {
  let redactedSentences = 0;
  const sentences = splitSentences(text).map((sentence) => {
    if (REDACT_SENTENCE_PATTERNS.some((p) => p.test(sentence))) {
      redactedSentences += 1;
      return REDACTION_MARKER;
    }
    return sentence;
  });
  let scrubbed = sentences.join(' ');
  let maskedAccountIds = 0;
  scrubbed = scrubbed.replace(ACCOUNT_ID_PATTERN, () => {
    maskedAccountIds += 1;
    return 'your account';
  });
  return { scrubbed, redactedSentences, maskedAccountIds };
}

// ─── leakage guard — ported from src/lib/benchmark/leakage.ts ──────────────

const FORBIDDEN_EVENT_TYPES = [
  'churn_signal_detected',
  'escalation_detected',
  'renewal_lapsed',
  'renewal_completed',
  'score_correction',
  'coaching_note_issued',
];
const FORBIDDEN_EVENT_SET = new Set(FORBIDDEN_EVENT_TYPES);

const FORBIDDEN_TRANSCRIPT_PATTERNS = [
  /\bhealth/i,
  /\bdeclin/i,
  /\bengagement\b/i,
  /\b0\.\d+\b/,
  /trending downward/i,
  /\bcritical\s+(?:state|status)/i,
  /\bacct_\d+/i,
];

function findTranscriptLeaks(text) {
  const leaks = [];
  for (const pattern of FORBIDDEN_TRANSCRIPT_PATTERNS) {
    const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let m;
    while ((m = g.exec(text)) !== null) {
      leaks.push({ pattern: pattern.source, match: m[0] });
    }
  }
  return leaks;
}

function assertNoTranscriptLeakage(text, context) {
  const leaks = findTranscriptLeaks(text);
  if (leaks.length > 0) {
    const sample = leaks.slice(0, 5).map((l) => `"${l.match}" (/${l.pattern}/)`).join(', ');
    throw new Error(`Leakage guard: ${leaks.length} forbidden internal-state token(s) in ${context}: ${sample}`);
  }
}

// ─── buildAccountInputs / serializeInputs — ported from input-contract.ts ──

function eventDayById(events) {
  const byId = new Map();
  for (const e of events) byId.set(e.event_id, e.day_index);
  return byId;
}

function buildAccountInputs(accountId, conversations, events, cutoffDay) {
  const dayByEventId = eventDayById(events);

  const transcripts = [];
  let droppedUnplaceable = 0;
  for (const c of conversations) {
    const day = dayByEventId.get(c.trigger_event_id);
    if (day === undefined) {
      droppedUnplaceable += 1;
      continue;
    }
    if (day > cutoffDay) continue;
    const { scrubbed } = scrubTranscript(c.prose);
    assertNoTranscriptLeakage(scrubbed, `${accountId}/${c.conversation_id}`);
    transcripts.push({ conversationId: c.conversation_id, day, channel: c.surface_channel, text: scrubbed });
  }
  transcripts.sort((a, b) => a.day - b.day);

  const observable = [];
  for (const e of events) {
    if (e.day_index > cutoffDay) continue;
    if (FORBIDDEN_EVENT_SET.has(e.event_type)) continue; // defensive; pack ships pre-filtered
    observable.push({ eventId: e.event_id, type: e.event_type, day: e.day_index, payload: e.payload ?? {} });
  }
  observable.sort((a, b) => a.day - b.day);

  const convDays = observable.filter((e) => e.type === 'conversation_started').map((e) => e.day);
  const lastConvDay = convDays.length ? Math.max(...convDays) : null;

  const aggregates = {
    conversationCount: convDays.length,
    ticketsOpened: observable.filter((e) => e.type === 'support_ticket_opened').length,
    ticketsResolved: observable.filter((e) => e.type === 'support_ticket_resolved').length,
    paymentFailures: observable.filter((e) => e.type === 'payment_failed').length,
    conversationsLast30d: convDays.filter((d) => d > cutoffDay - 30 && d <= cutoffDay).length,
    daysSinceLastConversation: lastConvDay === null ? null : cutoffDay - lastConvDay,
  };

  return { accountId, cutoffDay, transcripts, events: observable, aggregates, droppedUnplaceable };
}

function serializeInputs(inputs) {
  const payload = {
    account_ref: 'account_under_eval',
    observation_cutoff_day: inputs.cutoffDay,
    transcripts: inputs.transcripts.map((t) => ({ day: t.day, channel: t.channel, text: t.text })),
    behavioral_events: inputs.events.map((e) => ({ type: e.type, day: e.day, payload: e.payload })),
    behavioral_aggregates: inputs.aggregates,
  };
  const json = JSON.stringify(payload, null, 2);
  assertNoTranscriptLeakage(json, `${inputs.accountId}/serialized/all`);
  return json;
}

// ─── buildBaselinePrompt — ported VERBATIM from arms/llm-baseline.ts ───────

function buildBaselinePrompt(serialized, slice) {
  const sliceNote =
    slice === 'conversation'
      ? 'You are given ONLY support-conversation transcripts (no behavioral event data).'
      : slice === 'action'
        ? 'You are given ONLY behavioral event data (no conversation transcripts).'
        : 'You are given both support-conversation transcripts and behavioral event data.';

  return [
    'You are assessing a B2B SaaS customer account for churn risk.',
    sliceNote,
    'All data is observable history up to an observation cutoff day, provided as structured JSON.',
    'Predict whether this account will CHURN or let its renewal LAPSE at some point AFTER the observation cutoff day.',
    'Judge only from the evidence provided; do not assume facts not present. Cite the specific evidence that drives your prediction.',
    'Respond by calling the record_prediction tool.',
    '',
    'ACCOUNT DATA (JSON):',
    serialized,
  ].join('\n');
}

// ─── normalizePrediction — ported from arms/types.ts ───────────────────────

function normalizePrediction(raw) {
  const prob = typeof raw.churn_probability === 'number' ? raw.churn_probability : Number(raw.churn_probability);
  const churnProbability = Number.isFinite(prob) ? Math.min(1, Math.max(0, prob)) : 0.5;
  return {
    willChurn: Boolean(raw.will_churn),
    churnProbability,
    rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
    evidence: Array.isArray(raw.evidence) ? raw.evidence.map((e) => String(e)) : [],
  };
}

// ─── OpenAI-compatible predictor — ported from arms/openai-baseline.ts ─────

const JSON_INSTRUCTION =
  'Respond with ONLY a JSON object (no prose, no markdown fences) of exactly this shape: ' +
  '{"will_churn": boolean, "churn_probability": number between 0 and 1, "rationale": string, "evidence": array of strings}.';

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object found in model response');
  }
  return JSON.parse(body.slice(start, end + 1));
}

function parseOpenAICompatResponse(json) {
  const msg = json?.choices?.[0]?.message;
  const text =
    typeof msg?.content === 'string' && msg.content.trim()
      ? msg.content
      : typeof msg?.reasoning === 'string' && msg.reasoning.trim()
        ? msg.reasoning
        : null;
  if (text === null) {
    throw new Error('OpenAI-compatible response has no assistant message content');
  }
  return normalizePrediction(extractJsonObject(text));
}

function makeOpenAICompatPredictor(cfg) {
  const baseUrl = (cfg.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  let jsonMode = true;
  let reasoningParam = true;

  const callOnce = async (systemMsg, prompt) => {
    for (;;) {
      const body = {
        model: cfg.model,
        temperature: 0,
        max_tokens: 8192,
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: prompt },
        ],
      };
      if (jsonMode) body.response_format = { type: 'json_object' };
      if (reasoningParam) body.reasoning = { effort: 'low' };
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (jsonMode && res.status === 400 && /structured.outputs|response_format/i.test(text)) {
          jsonMode = false;
          continue;
        }
        if (reasoningParam && res.status === 400 && /reasoning/i.test(text)) {
          reasoningParam = false;
          continue;
        }
        throw new Error(`OpenAI-compat ${cfg.model} HTTP ${res.status}: ${text}`);
      }
      return res.json();
    }
  };

  return async (prompt) => {
    let parseRetries = 0;
    let json;
    let prediction = null;
    let lastErr;
    for (let attempt = 0; attempt < 3 && prediction === null; attempt++) {
      const instruction =
        attempt === 0
          ? JSON_INSTRUCTION
          : `${JSON_INSTRUCTION} Your previous reply was NOT valid JSON. Output the JSON object and nothing else.`;
      try {
        json = await callOnce(instruction, prompt);
        prediction = parseOpenAICompatResponse(json);
      } catch (err) {
        lastErr = err;
        parseRetries = attempt + 1;
        if (jsonMode && err instanceof Error && /no assistant message content/.test(err.message)) {
          jsonMode = false;
        }
      }
    }
    if (prediction === null) throw lastErr;
    return { prediction, meta: { resolvedModel: json?.model, usage: json?.usage, parseRetries } };
  };
}

// ─── scoring — ported from score.ts ─────────────────────────────────────────

function confusion(rows) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of rows) {
    if (r.pred && r.label) tp++;
    else if (r.pred && !r.label) fp++;
    else if (!r.pred && !r.label) tn++;
    else fn++;
  }
  const n = rows.length;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { n, tp, fp, tn, fn, accuracy: n === 0 ? 0 : (tp + tn) / n, precision, recall, f1 };
}

function rocAuc(rows) {
  const pos = rows.filter((r) => r.label).length;
  const neg = rows.length - pos;
  if (pos === 0 || neg === 0) return 0.5;
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  const ranks = new Array(sorted.length).fill(0);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].score === sorted[i].score) j++;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[k] = avg;
    i = j;
  }
  let rankSumPos = 0;
  for (let k = 0; k < sorted.length; k++) if (sorted[k].label) rankSumPos += ranks[k];
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

// ─── disk cache ──────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(__dirname, '.cache');

function cacheKey(model, prompt) {
  return crypto.createHash('sha256').update(model).update('\n').update(prompt).digest('hex');
}

function cacheGet(key) {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function cacheSet(key, value) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value));
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const dataDir = path.join(__dirname, 'data');
  const labelsPath = path.join(__dirname, 'labels', 'labels-t90.json');

  const conversations = readJsonl(path.join(dataDir, 'conversations.jsonl'));
  const events = readJsonl(path.join(dataDir, 'events.jsonl'));
  const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));

  const convByAcct = groupByAccount(conversations);
  const evByAcct = groupByAccount(events);
  const labelByAcct = new Map(labels.map((l) => [l.account_id, l]));

  let accountIds = labels
    .filter((l) => l.outcome !== 'excluded')
    .map((l) => l.account_id)
    .sort();

  if (DUMP_PROMPT) {
    const inputs = buildAccountInputs(DUMP_PROMPT, convByAcct.get(DUMP_PROMPT) ?? [], evByAcct.get(DUMP_PROMPT) ?? [], CUTOFF_DAY);
    const serialized = serializeInputs(inputs);
    const prompt = buildBaselinePrompt(serialized, 'all');
    process.stdout.write(prompt);
    return;
  }

  if (MAX_ACCOUNTS) accountIds = accountIds.slice(0, MAX_ACCOUNTS);

  console.log(`Resonant IQ Churn Benchmark Pack — model=${MODEL} api-base=${API_BASE} accounts=${accountIds.length} concurrency=${CONCURRENCY}`);

  const predict = makeOpenAICompatPredictor({ apiKey: API_KEY, model: MODEL, baseUrl: API_BASE });

  const rows = [];
  let done = 0;

  async function runOne(accountId) {
    const label = labelByAcct.get(accountId);
    const inputs = buildAccountInputs(accountId, convByAcct.get(accountId) ?? [], evByAcct.get(accountId) ?? [], CUTOFF_DAY);
    const serialized = serializeInputs(inputs);
    const prompt = buildBaselinePrompt(serialized, 'all');
    assertNoTranscriptLeakage(prompt, `${accountId}/prompt/B-all`);

    const key = cacheKey(MODEL, prompt);
    let cached = cacheGet(key);
    let fromCache = true;
    if (!cached) {
      fromCache = false;
      cached = await predict(prompt);
      cacheSet(key, cached);
    }

    done += 1;
    const pred = cached.prediction;
    console.log(
      `[${String(done).padStart(3)}/${accountIds.length}] ${accountId} label=${label.outcome.padEnd(8)} ` +
        `pred=${String(pred.willChurn).padEnd(5)} p=${pred.churnProbability.toFixed(2)}${fromCache ? ' (cached)' : ''}`
    );

    rows.push({ pred: pred.willChurn, score: pred.churnProbability, label: label.churned });
  }

  // Bounded concurrency worker pool.
  let cursor = 0;
  async function worker() {
    while (cursor < accountIds.length) {
      const idx = cursor++;
      await runOne(accountIds[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, accountIds.length) }, () => worker());
  await Promise.all(workers);

  const m = confusion(rows);
  const auc = rocAuc(rows);

  console.log('');
  const label = ('this-run@' + MODEL).slice(0, 28);
  console.log('arm                          n   acc   prec  recall  f1    auc');
  console.log(
    `${label.padEnd(28)} ${String(m.n).padStart(3)}  ${m.accuracy.toFixed(2)}  ${m.precision.toFixed(2)}  ${m.recall.toFixed(2)}    ${m.f1.toFixed(2)}  ${auc.toFixed(2)}`
  );
  console.log(`${'B-all@google/gemini-2.5-pro (published)'.padEnd(28)} 178  0.19  0.18  1.00    0.31  0.64`);
  console.log(`${'E-css engine (published, not repro)'.padEnd(28)} 178  0.91  0.94  0.53    0.68  0.93`);
  console.log('');
  console.log('Compare: Resonant IQ CSS scored P 0.94 / R 0.53 / AUC 0.93 on this exact data.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
