// pnpm --filter @fairshare/api eval:parse [--provider primary|fallback] [--delay-ms 8000] [--only hi-]
//
// Runs the evaluation set (phrases.ts) against a real model, with the prompt the server uses, and
// prints the score per field and the release gate's verdict. The answers are saved in snapshots/
// so CI keeps checking them (eval.test.ts). Run it whenever the prompt or the model changes.
//
// It uses the AI_* variables from .env. 105 sentences cost about 105,000 tokens, about half of
// Groq's free daily allowance, and the delay keeps it under the free tier's tokens per minute.

import { llmExpenseExtractionJsonSchema } from '@fairshare/contracts';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadEnv } from '../../../config/env';
import { aiConfigFromEnv } from '../config';
import { ProviderError } from '../provider';
import {
  PARSE_EXPENSE_PROMPT_VERSION,
  PARSE_EXPENSE_SYSTEM,
  parseExpenseUserMessage,
} from '../prompts/parse-expense.v1';
import { PHRASES } from './phrases';
import { EVAL_PROMPT, GATE, scoreAll, type Answer } from './score';

const { values: args } = parseArgs({
  options: {
    provider: { type: 'string', default: 'primary' },
    'delay-ms': { type: 'string', default: '8000' },
    only: { type: 'string', default: '' },
  },
});
const config = aiConfigFromEnv(loadEnv());
const setup = config.providers[args.provider === 'fallback' ? 1 : 0];
if (!setup) {
  console.error(`No ${args.provider} provider: set its AI_* variables in .env.`);
  process.exit(2);
}
const phrases = PHRASES.filter((p) => p.id.startsWith(args.only));
const delay = Number(args['delay-ms']);
const jsonSchema = llmExpenseExtractionJsonSchema();

console.log(
  `${setup.provider.name} · ${setup.textModel} · ${PARSE_EXPENSE_PROMPT_VERSION} · ${phrases.length} sentences`,
);
const answers: Record<string, Answer> = {};
let tokens = 0;
const latencies: number[] = [];
for (const [i, phrase] of phrases.entries()) {
  const started = Date.now();
  try {
    const response = await setup.provider.generateStructured({
      model: setup.textModel,
      system: PARSE_EXPENSE_SYSTEM,
      user: parseExpenseUserMessage({ ...EVAL_PROMPT, text: phrase.text }),
      jsonSchema,
      maxOutputTokens: 1024,
      timeoutMs: config.timeoutMs,
    });
    answers[phrase.id] = { output: response.output };
    tokens += response.usage.inputTokens + response.usage.outputTokens;
  } catch (error) {
    answers[phrase.id] = { error: error instanceof ProviderError ? error.kind : String(error) };
  }
  latencies.push(Date.now() - started);
  process.stdout.write(`\r${i + 1}/${phrases.length}`);
  if (i < phrases.length - 1) await new Promise((r) => setTimeout(r, delay));
}
console.log();

const report = scoreAll(answers, phrases);
const percent = (x: number) => `${(x * 100).toFixed(1)}%`;
const sorted = [...latencies].sort((a, b) => a - b);
console.log('\nAccuracy per field:');
for (const [field, value] of Object.entries(report.accuracy)) {
  const gate = GATE[field as keyof typeof GATE];
  console.log(
    `  ${field.padEnd(13)} ${percent(value).padStart(6)}${gate ? `  (gate ${percent(gate)})` : ''}`,
  );
}
console.log(`  all fields    ${percent(report.allRight).padStart(6)}`);
console.log(
  `\nInvalid answers: ${report.invalid}; tokens: ${tokens}; median latency: ${sorted[Math.floor(sorted.length / 2)]} ms`,
);
if (report.failures.length) {
  console.log('\nWrong:');
  for (const f of report.failures) console.log(`  ${f.id}  [${f.wrong.join(', ')}]  ${f.text}`);
}
console.log(`\nRelease gate: ${report.passesGate ? 'PASS' : 'FAIL'}`);

if (args.only === '') {
  const name = `${setup.provider.name}-${setup.textModel}-${PARSE_EXPENSE_PROMPT_VERSION}`.replace(
    /[^a-z0-9.-]+/gi,
    '_',
  );
  const file = new URL(`./snapshots/${name}.json`, import.meta.url);
  const run = {
    provider: setup.provider.name,
    model: setup.textModel,
    promptVersion: PARSE_EXPENSE_PROMPT_VERSION,
    recordedAt: new Date().toISOString(),
    accuracy: report.accuracy,
    answers,
  };
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`Saved ${file.pathname} (commit it so CI keeps checking this run).`);
}
process.exitCode = report.passesGate ? 0 : 1;
