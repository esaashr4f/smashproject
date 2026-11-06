// Shared types for the whole app. Pure data, no logic, so both the
// browser UI and the Node tests can import them.

export type Confidence = 'certain' | 'likely' | 'possible';
export type Severity = 'error' | 'warning' | 'info' | 'ok';

/** An address with Atmosphère's optional "(module + 0xoff) (symbol + 0xoff)" annotations. */
export interface AnnotatedAddress {
  raw: string;
  value: bigint;
  module?: string;
  moduleOffset?: number;
  /** Symbol as written in the log (may be C++-mangled). */
  symbol?: string;
  /** Human-readable symbol (demangled when we can). */
  symbolDisplay?: string;
  symbolOffset?: number;
}

export interface ModuleInfo {
  index: number;
  name: string;
  start: bigint;
  end: bigint;
  moduleId: string;
}

export interface ThreadInfo {
  id: string;
  name: string;
  registers: Record<string, AnnotatedAddress>;
  stackTrace: AnnotatedAddress[];
}

export interface ResultCode {
  raw: string; // e.g. "0xCCA58402"
  module: number; // e.g. 2002
  description: number; // e.g. 4802
  formatted: string; // "2002-4802"
}

export interface CrashLog {
  isCrashReport: true;
  fileName?: string;
  /** From the "<unix seconds>_<program id>.log" file name, when present. */
  timestamp?: Date;
  reportVersion?: string;
  result?: ResultCode;
  processName?: string;
  programId?: string;
  exceptionType?: string;
  address?: AnnotatedAddress;
  breakReason?: string;
  breakAddress?: string;
  crashedThread?: ThreadInfo;
  pc?: AnnotatedAddress;
  lr?: AnnotatedAddress;
  modules: ModuleInfo[];
  threads: ThreadInfo[];
  gameVersion?: string;
  /** Interesting ASCII found in stack / TLS dumps (paths, module names...). */
  dumpStrings: string[];
}

export interface NotACrashLog {
  isCrashReport: false;
  fileName?: string;
  /** Best guess at what the file is instead. */
  kind: string;
  firstLine: string;
}

export type ParsedLog = CrashLog | NotACrashLog;

export interface Diagnosis {
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  summary: string;
  fix: string[];
  evidence: string[];
  learnMore?: string;
  /** Higher = more specific match; used for ranking. */
  score: number;
}

export interface Explanation {
  log: ParsedLog;
  best: Diagnosis;
  alsoPossible: Diagnosis[];
  /** Plugins/mod modules loaded when it crashed (non-system modules). */
  loadedPlugins: string[];
}

/** A scanner finding. */
export interface Finding {
  id: string;
  severity: Severity;
  confidence: Confidence;
  title: string;
  detail: string;
  fix?: string;
  /** Mod folder name, when the finding is about one mod. */
  mod?: string;
  paths?: string[];
}
