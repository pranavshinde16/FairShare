// The evaluation set in CI (plan §11 Phase 15), with FakeProvider snapshots instead of a model:
// the golden answers must score 100% (expectations and the server's reading agree), and every
// recorded run in snapshots/ must still pass the release gate after any change to core or here.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHRASES } from './phrases';
import { FIELDS, GATE, goldenExtraction, scoreAll, scorePhrase, type Answer } from './score';

const golden: Record<string, Answer> = Object.fromEntries(
  PHRASES.map((phrase) => [phrase.id, { output: goldenExtraction(phrase) }]),
);

describe('the evaluation set', () => {
  it('has 100+ sentences, with Hinglish and edge cases well covered', () => {
    expect(PHRASES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(PHRASES.map((p) => p.id)).size).toBe(PHRASES.length);
    const tagged = (tag: string) => PHRASES.filter((p) => p.tags.includes(tag)).length;
    expect(tagged('hinglish')).toBeGreaterThanOrEqual(35);
    expect(tagged('edge')).toBeGreaterThanOrEqual(30);
    for (const tag of ['exact', 'percent', 'shares', 'payer', 'date', 'everyone', 'injection']) {
      expect(tagged(tag), tag).toBeGreaterThan(0);
    }
  });

  it('scores the golden answers 100%: the expectations and the server’s reading agree', () => {
    const report = scoreAll(golden);
    expect(report.failures).toEqual([]);
    for (const field of FIELDS) expect(report.accuracy[field], field).toBe(1);
    expect(report.passesGate).toBe(true);
  });

  it('catches a wrong amount, a missed person and an invalid answer', () => {
    const phrase = PHRASES.find((p) => p.id === 'en-01')!;
    const answer = goldenExtraction(phrase);
    expect(scorePhrase(phrase, { output: { ...answer, amount: '240' } }).wrong).toEqual(['amount']);
    expect(
      scorePhrase(phrase, { output: { ...answer, people: answer.people.slice(0, 2) } }).wrong,
    ).toEqual(['participants']);
    expect(scorePhrase(phrase, { output: { amount: 2400 } })).toMatchObject({ invalid: true });
    expect(scorePhrase(phrase, { error: 'timeout' })).toMatchObject({ invalid: true });
  });

  it('fails the gate when amounts drop below 95%', () => {
    const broken = { ...golden };
    for (const phrase of PHRASES.slice(0, 6)) {
      broken[phrase.id] = { output: { ...goldenExtraction(phrase), amount: '1' } };
    }
    const report = scoreAll(broken);
    expect(report.accuracy.amount).toBeLessThan(GATE.amount);
    expect(report.passesGate).toBe(false);
  });
});

// Runs recorded with `pnpm --filter @fairshare/api eval:parse` against a real model.
const dir = fileURLToPath(new URL('./snapshots/', import.meta.url));
const recorded = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe.runIf(recorded.length > 0)('recorded model runs (snapshots/)', () => {
  it.each(recorded)('%s still passes the release gate', (file) => {
    const run = JSON.parse(readFileSync(`${dir}${file}`, 'utf8')) as {
      answers: Record<string, Answer>;
    };
    const report = scoreAll(run.answers);
    expect(report.passesGate, JSON.stringify(report.accuracy)).toBe(true);
  });
});
