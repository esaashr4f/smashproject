// Rules engine: CrashLog + rules.json -> ranked Diagnosis list.
//
// Condition language (all JSON, so new crash types are a data edit):
//   { "field": "pc.moduleOffset", "eq": X | "in": [..] | "min": n | "max": n
//                                 | "matches": "regex" | "notMatches": "regex" }
//   { "stack": { "module"?, "moduleMatches"?, "symbol"?, "symbolMatches"? } }  any crashed-thread frame (LR included)
//   { "moduleLoaded": "smashline" }   /   { "moduleNotLoaded": "smashline" }
//   { "dumpString": "mate/mod" }      a string decoded from the stack/TLS dumps
//   { "any": [cond, ...] }   { "not": cond }
// Numbers can be written as hex strings ("0x4c58").
//
// 'match' conditions must all hold. 'prefer' conditions are optional: each one
// that holds makes the rule more specific; a 'context.*' one that is known and
// contradicts lowers confidence by one step.

import type { AnnotatedAddress, Confidence, CrashLog, Diagnosis, Explanation, ParsedLog, Severity } from '../types';
import rulesData from '../../data/rules.json';
import fightersData from '../../data/fighters.json';
import modulesData from '../../data/modules.json';
import appsData from '../../data/homebrew_apps.json';

export interface MatchContext {
  /** Installed Smashline version, if the SD scanner found one. */
  smashlineVersion?: string;
}

type Value = string | number | boolean | undefined;
export type Condition =
  | {
      field: string;
      eq?: Value;
      in?: (string | number)[];
      min?: number | string;
      max?: number | string;
      matches?: string;
      notMatches?: string;
    }
  | { stack: { module?: string; moduleMatches?: string; symbol?: string; symbolMatches?: string } }
  | { moduleLoaded: string }
  | { moduleNotLoaded: string }
  | { dumpString: string }
  | { any: Condition[] }
  | { not: Condition };

interface VarSpec {
  fields: string[];
  matches?: string;
  notMatches?: string;
}

export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  priority?: number;
  match: Condition[];
  prefer?: Condition[];
  vars?: Record<string, VarSpec>;
  summary: string;
  fix: string[];
  evidence: string[];
  learnMore?: string;
}

export const RULES: Rule[] = (rulesData as { rules: Rule[] }).rules;
export const FIGHTERS: Record<string, string> = (fightersData as { fighters: Record<string, string> }).fighters;
const MODULES = modulesData as {
  modules: Record<string, { display: string; system?: boolean; product?: string }>;
  patterns: { match: string; display: string }[];
};
const APPS = appsData as {
  apps: Record<string, { name: string; advice: string; fix: string }>;
  default: { advice: string; fix: string };
};

const toNum = (v: string | number | undefined): number | undefined =>
  v === undefined ? undefined : typeof v === 'number' ? v : v.startsWith('0x') ? parseInt(v, 16) : Number(v);

/** Facts = a flat-ish view of the log that conditions can address by name. */
type Facts = Record<string, unknown>;

function addrFacts(a: AnnotatedAddress | undefined) {
  return {
    module: a?.module,
    moduleOffset: a?.moduleOffset,
    symbol: a?.symbolDisplay,
    symbolOffset: a?.symbolOffset,
  };
}

export function buildFacts(log: ParsedLog, ctx: MatchContext = {}): Facts {
  if (!log.isCrashReport) return { isCrashReport: false, context: ctx };
  const addr = log.address?.value;
  return {
    isCrashReport: true,
    programId: log.programId,
    processName: log.processName,
    exceptionType: log.exceptionType,
    address: addr === undefined ? undefined : addr <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(addr) : Infinity,
    resultCode: log.result?.formatted,
    resultModule: log.result?.module,
    resultDescription: log.result?.description,
    pc: addrFacts(log.pc),
    lr: addrFacts(log.lr),
    context: ctx,
  };
}

function getField(facts: Facts, path: string): unknown {
  let cur: unknown = facts;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Crashed-thread frames: LR first, then the stack trace. */
function frames(log: CrashLog): AnnotatedAddress[] {
  const out: AnnotatedAddress[] = [];
  if (log.lr) out.push(log.lr);
  out.push(...(log.crashedThread?.stackTrace ?? []));
  return out;
}

function eqValue(actual: unknown, expected: Value): boolean {
  if (typeof actual === 'number' && typeof expected === 'string') return actual === toNum(expected);
  return actual === expected;
}

export function evalCondition(c: Condition, log: ParsedLog, facts: Facts): boolean {
  if ('any' in c) return c.any.some((x) => evalCondition(x, log, facts));
  if ('not' in c) return !evalCondition(c.not, log, facts);
  if ('field' in c) {
    const v = getField(facts, c.field);
    if (v === undefined) return false;
    if ('eq' in c && !eqValue(v, c.eq)) return false;
    if (c.in && !c.in.some((x) => eqValue(v, x))) return false;
    if (c.min !== undefined && !(typeof v === 'number' && v >= toNum(c.min)!)) return false;
    if (c.max !== undefined && !(typeof v === 'number' && v <= toNum(c.max)!)) return false;
    if (c.matches && !new RegExp(c.matches).test(String(v))) return false;
    if (c.notMatches && new RegExp(c.notMatches).test(String(v))) return false;
    return true;
  }
  if (!log.isCrashReport) return false;
  if ('stack' in c) {
    const s = c.stack;
    return frames(log).some(
      (f) =>
        (!s.module || f.module === s.module) &&
        (!s.moduleMatches || (f.module !== undefined && new RegExp(s.moduleMatches).test(f.module))) &&
        (!s.symbol || f.symbolDisplay === s.symbol) &&
        (!s.symbolMatches || (f.symbolDisplay !== undefined && new RegExp(s.symbolMatches).test(f.symbolDisplay))),
    );
  }
  if ('moduleLoaded' in c) return log.modules.some((m) => m.name === c.moduleLoaded);
  if ('moduleNotLoaded' in c) return !log.modules.some((m) => m.name === c.moduleNotLoaded);
  if ('dumpString' in c) return log.dumpStrings.some((s) => s.includes(c.dumpString));
  return false;
}

/** Count leaf conditions, so a rule with more checks counts as more specific. */
function weight(c: Condition): number {
  if ('any' in c) return Math.min(...c.any.map(weight));
  if ('not' in c) return weight(c.not);
  return 1;
}

const lowerConfidence = (c: Confidence): Confidence => (c === 'certain' ? 'likely' : 'possible');

export function formatAddress(a: AnnotatedAddress | undefined): string {
  if (!a) return '(unknown)';
  let s = '0x' + a.raw.replace(/^0+(?=.)/, '');
  if (a.module) s += ` (${a.module} + 0x${a.moduleOffset!.toString(16)})`;
  if (a.symbolDisplay) s += ` (${a.symbolDisplay} + 0x${a.symbolOffset!.toString(16)})`;
  return s;
}

export function moduleDisplay(name: string): string {
  const m = MODULES.modules[name];
  if (m) return m.display;
  for (const p of MODULES.patterns) {
    const r = new RegExp(p.match).exec(name);
    if (r) {
      const fighter = r[1] ? FIGHTERS[r[1]] ?? r[1] : '';
      return p.display.replace('{0}', name).replace('{fighter}', fighter);
    }
  }
  return name;
}

export const isSystemModule = (name: string | undefined): boolean =>
  !name || !!MODULES.modules[name]?.system || /^\[0+\]$/.test(name);

function resolveVar(spec: VarSpec, log: CrashLog, facts: Facts): string | undefined {
  for (const field of spec.fields) {
    const candidates: unknown[] =
      field === 'stack.module' ? frames(log).map((f) => f.module) : [getField(facts, field)];
    for (const v of candidates) {
      if (typeof v !== 'string') continue;
      if (spec.notMatches && new RegExp(spec.notMatches).test(v)) continue;
      if (spec.matches) {
        const r = new RegExp(spec.matches).exec(v);
        if (!r) continue;
        return r[1] ?? v;
      }
      return v;
    }
  }
  return undefined;
}

function buildVars(rule: Rule, log: ParsedLog, facts: Facts): Record<string, string> {
  if (!log.isCrashReport) return { kind: log.kind, firstLine: log.firstLine || '(empty)' };
  const vars: Record<string, string> = {
    pc: formatAddress(log.pc),
    lr: formatAddress(log.lr),
    address: log.address ? '0x' + log.address.raw.replace(/^0+(?=.)/, '') : '(unknown)',
    result: log.result?.formatted ?? '(unknown)',
    programId: log.programId ?? '(unknown)',
    exceptionType: log.exceptionType ?? '(unknown)',
    gameVersion: log.gameVersion ?? 'unknown',
  };
  const plugin = frames(log).find((f) => !isSystemModule(f.module));
  vars['stackPlugin'] = plugin ? formatAddress(plugin) : '(unknown)';
  for (const [name, spec] of Object.entries(rule.vars ?? {})) {
    vars[name] = resolveVar(spec, log, facts) ?? '(unknown)';
  }
  if (vars['fighter']) vars['fighterName'] = FIGHTERS[vars['fighter']] ?? vars['fighter'];
  if (vars['app']) {
    const known = APPS.apps[vars['app'].toLowerCase()];
    vars['appAdvice'] = known?.advice ?? APPS.default.advice;
    vars['appFix'] = (known?.fix ?? APPS.default.fix).replace('{app}', vars['app']);
  }
  return vars;
}

const fill = (t: string, vars: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

export function matchRules(log: ParsedLog, ctx: MatchContext = {}, rules: Rule[] = RULES): Diagnosis[] {
  const facts = buildFacts(log, ctx);
  const out: Diagnosis[] = [];
  for (const rule of rules) {
    if (!rule.match.every((c) => evalCondition(c, log, facts))) continue;
    let score = (rule.priority ?? 0) * 100 + rule.match.reduce((n, c) => n + weight(c), 0);
    let confidence = rule.confidence;
    for (const p of rule.prefer ?? []) {
      const isContext = 'field' in p && p.field.startsWith('context.');
      if (isContext && getField(facts, p.field) === undefined) continue; // unknown: neutral
      if (evalCondition(p, log, facts)) score += 0.5;
      else if (isContext) confidence = lowerConfidence(confidence);
    }
    const vars = buildVars(rule, log, facts);
    out.push({
      ruleId: rule.id,
      title: rule.title,
      severity: rule.severity,
      confidence,
      summary: fill(rule.summary, vars),
      fix: rule.fix.map((f) => fill(f, vars)),
      evidence: rule.evidence.map((e) => fill(e, vars)),
      learnMore: rule.learnMore,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Plain-English fallback when no rule matches. */
export function genericDiagnosis(log: CrashLog): Diagnosis {
  const where = [log.pc, ...frames(log)].find((f) => f && !isSystemModule(f.module));
  const loaded = loadedPlugins(log);
  const isSmash = log.programId === '01006a800016e000';
  const whereText = where?.module
    ? `inside ${moduleDisplay(where.module)}`
    : log.pc?.module
      ? `inside ${moduleDisplay(log.pc.module)}`
      : 'at an address outside any known module';
  return {
    ruleId: 'generic',
    title: isSmash ? 'Smash Ultimate crashed (no known pattern)' : `${log.processName ?? 'A program'} crashed`,
    severity: 'error',
    confidence: 'possible',
    summary:
      `We don't have a rule for this crash yet. It happened ${whereText}` +
      (log.exceptionType ? ` (${log.exceptionType.toLowerCase()})` : '') +
      `. Plugins loaded at the time: ${loaded.length ? loaded.map(moduleDisplay).join(', ') : 'none'}.` +
      (log.gameVersion ? ` Game version: ${log.gameVersion}.` : ''),
    fix: [
      where?.module && !isSystemModule(where.module)
        ? `Start with ${moduleDisplay(where.module)}: update it, or remove it and launch once to see if the crash goes away.`
        : 'Remove half of your mods, launch once, and repeat with the half that still crashes.',
      'Run the SD Card Scanner to check for broken mod folders and version mismatches.',
      'If you work it out, consider sharing the log so a rule can be added for the next person.',
    ],
    evidence: [`PC = ${formatAddress(log.pc)}`, `LR = ${formatAddress(log.lr)}`, `Result = ${log.result?.formatted ?? '?'}`],
    score: 0,
  };
}

export function loadedPlugins(log: CrashLog): string[] {
  return log.modules.map((m) => m.name).filter((n) => !isSystemModule(n));
}

export function explain(log: ParsedLog, ctx: MatchContext = {}): Explanation {
  const matches = matchRules(log, ctx);
  const best = matches[0] ?? genericDiagnosis(log as CrashLog);
  return {
    log,
    best,
    alsoPossible: matches.slice(1),
    loadedPlugins: log.isCrashReport ? loadedPlugins(log) : [],
  };
}
