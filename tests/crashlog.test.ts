// Runs every real crash log in fixtures/crash_logs/ through the explainer and
// checks the top diagnosis against EXPECTED.json. This is the safety net:
// any rule change that breaks a known answer fails here.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCrashLog } from '../src/core/crashlog/parse';
import { explain } from '../src/core/crashlog/match';
import { demangle } from '../src/core/crashlog/demangle';

const DIR = 'fixtures/crash_logs/';
const expected = JSON.parse(readFileSync(DIR + 'EXPECTED.json', 'utf8')) as {
  logs: { file: string; rule: string; app?: string; module?: string; fighter?: string }[];
};

describe('fixtures', () => {
  it('EXPECTED.json covers every log file', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.log')).sort();
    expect(expected.logs.map((l) => l.file).sort()).toEqual(files);
  });

  for (const e of expected.logs) {
    it(`${e.file} -> ${e.rule}`, () => {
      const log = parseCrashLog(readFileSync(DIR + e.file, 'utf8'), e.file);
      const x = explain(log);
      expect(x.best.ruleId).toBe(e.rule);
      // No unfilled {placeholders} in user-facing text
      for (const t of [x.best.summary, ...x.best.fix, ...x.best.evidence]) expect(t).not.toMatch(/\{\w+\}|\(unknown\)/);
      if (e.app) expect(x.best.summary.toLowerCase()).toContain(e.app.toLowerCase());
      if (e.module) expect(x.best.summary).toContain(e.module);
      if (e.fighter) expect(x.best.summary).toContain('Steve');
    });
  }
});

describe('parser', () => {
  const log = parseCrashLog(readFileSync(DIR + '01793899075_01006a800016e000.log', 'utf8'), '01793899075_01006a800016e000.log');
  it('reads the basics', () => {
    if (!log.isCrashReport) throw new Error('expected crash report');
    expect(log.timestamp?.toISOString()).toBe('2026-11-05T17:17:55.000Z');
    expect(log.result?.formatted).toBe('2002-4802');
    expect(log.programId).toBe('01006a800016e000');
    expect(log.exceptionType).toBe('User Break');
    expect(log.gameVersion).toBe('13.0.5');
    expect(log.modules.map((m) => m.name)).toContain('libparam_config');
    expect(log.dumpStrings).toContain('mate/mod');
    expect(log.crashedThread?.stackTrace[2]?.symbolDisplay).toBe('nn::fs::OpenFile');
  });
  it('demangles common symbols', () => {
    expect(demangle('_ZN2nn4diag6detail5AbortEPKNS_6ResultE')).toBe('nn::diag::detail::Abort');
    expect(demangle('smashline_clone_weapon')).toBe('smashline_clone_weapon');
  });
  it('lowers confidence when the installed Smashline contradicts the rule', () => {
    const f = '01793916706_01006a800016e000.log';
    const l = parseCrashLog(readFileSync(DIR + f, 'utf8'), f);
    expect(explain(l, { smashlineVersion: '2.0.0' }).best.confidence).toBe('likely');
    expect(explain(l, { smashlineVersion: '1.6.8' }).best.confidence).toBe('possible');
  });
});
