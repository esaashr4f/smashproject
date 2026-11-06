// Atmosphère crash report (v1.7) text -> typed CrashLog object.
//
// The format is "Key:   value" lines grouped by indentation. We walk the file
// line by line and keep track of which section we're in. It is forgiving on
// purpose: a field we can't parse is simply left undefined.

import type {
  AnnotatedAddress,
  CrashLog,
  ModuleInfo,
  NotACrashLog,
  ParsedLog,
  ResultCode,
  ThreadInfo,
} from '../types';
import { demangle } from './demangle';

const HEADER_RE = /Atmosph[eè]re Crash Report \(v([\d.]+)\)/;
const KV_RE = /^(\s*)([A-Za-z][A-Za-z0-9 \[\]_]*?):\s*(.*)$/;
const HEX_ROW_RE = /^\s+([0-9a-fA-F]{8,16})((?:\s[0-9a-fA-F]{2}){1,16})\s*$/;

/** Parse "00000065d5765c58 (Skyline + 0x4c58) (sym + 0x18)". */
export function parseAnnotated(text: string): AnnotatedAddress | undefined {
  const m = /^([0-9a-fA-F]+)\s*(.*)$/.exec(text.trim());
  if (!m) return undefined;
  const out: AnnotatedAddress = { raw: m[1]!, value: BigInt('0x' + m[1]) };
  const annos = [...m[2]!.matchAll(/\((.+?) \+ 0x([0-9a-fA-F]+)\)/g)];
  if (annos[0]) {
    out.module = annos[0][1];
    out.moduleOffset = parseInt(annos[0][2]!, 16);
  }
  if (annos[1]) {
    out.symbol = annos[1][1];
    out.symbolDisplay = demangle(annos[1][1]!);
    out.symbolOffset = parseInt(annos[1][2]!, 16);
  }
  return out;
}

function parseResult(text: string): ResultCode | undefined {
  const m = /^(0x[0-9a-fA-F]+)\s*\((\d{4})-(\d{4})\)/.exec(text.trim());
  if (!m) return undefined;
  return {
    raw: m[1]!,
    module: Number(m[2]),
    description: Number(m[3]),
    formatted: `${m[2]}-${m[3]}`,
  };
}

/** "<unix seconds>_<program id>.log" -> Date. Atmosphère pads seconds to 11 digits. */
export function timestampFromFileName(fileName: string): Date | undefined {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const m = /(?:^|_)(\d{10,11})_[0-9a-fA-F]{16}\.log$/.exec(base);
  if (!m) return undefined;
  return new Date(Number(m[1]) * 1000);
}

function guessNonCrashKind(text: string): string {
  const first = text.trimStart().split(/\r?\n/, 1)[0] ?? '';
  if (/^DNS Mitm/i.test(first)) return 'Atmosphère DNS MITM startup log';
  if (/fatal/i.test(first)) return 'an Atmosphère fatal-error report';
  if (/arcropolis/i.test(text.slice(0, 2000))) return 'an ARCropolis log';
  if (!first.trim()) return 'an empty file';
  return 'a text file that is not an Atmosphère crash report';
}

const NOISE_STRINGS = new Set(['SFCO']);

/** Turn hex-dump rows into ASCII strings of >= 4 printable characters. */
function extractStrings(bytes: number[]): string[] {
  const out: string[] = [];
  let cur = '';
  for (const b of bytes) {
    if (b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b);
    else {
      if (cur.length >= 4) out.push(cur);
      cur = '';
    }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

export function parseCrashLog(text: string, fileName?: string): ParsedLog {
  const header = HEADER_RE.exec(text.slice(0, 500));
  if (!header) {
    const out: NotACrashLog = {
      isCrashReport: false,
      fileName,
      kind: guessNonCrashKind(text),
      firstLine: (text.trimStart().split(/\r?\n/, 1)[0] ?? '').slice(0, 200),
    };
    return out;
  }

  const log: CrashLog = {
    isCrashReport: true,
    fileName,
    timestamp: fileName ? timestampFromFileName(fileName) : undefined,
    reportVersion: header[1],
    modules: [],
    threads: [],
    dumpStrings: [],
  };

  type Section = 'top' | 'process' | 'exception' | 'crashed' | 'modules' | 'threads';
  let section: Section = 'top';
  let inRegisters = false;
  let inStackTrace = false;
  let inDump = false;
  let curThread: ThreadInfo | undefined;
  let curModule: Partial<ModuleInfo> | undefined;
  const dumpBytes: number[] = [];

  const flushModule = () => {
    if (curModule && curModule.name !== undefined) log.modules.push(curModule as ModuleInfo);
    curModule = undefined;
  };
  const newThread = (): ThreadInfo => ({ id: '', name: '', registers: {}, stackTrace: [] });

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line) continue;

    // Hex dump rows (Stack Dump / TLS Dump), anywhere in the file.
    const hex = inDump ? HEX_ROW_RE.exec(line) : null;
    if (hex) {
      for (const b of hex[2]!.trim().split(/\s+/)) dumpBytes.push(parseInt(b, 16));
      continue;
    }
    if (inDump) {
      dumpBytes.push(0); // separate dumps so strings don't join across them
      inDump = false;
    }

    const kv = KV_RE.exec(line);
    if (!kv) continue;
    const indent = kv[1]!.length;
    const key = kv[2]!.trim();
    const value = kv[3]!.trim();

    // Section headers (no indentation)
    if (indent === 0) {
      inRegisters = inStackTrace = false;
      if (key === 'Result') log.result = parseResult(value);
      else if (key === 'Process Info') section = 'process';
      else if (key === 'Exception Info') section = 'exception';
      else if (key === 'Crashed Thread Info') {
        section = 'crashed';
        curThread = newThread();
        log.crashedThread = curThread;
      } else if (key === 'Module Info') section = 'modules';
      else if (key === 'Thread Report') {
        flushModule();
        section = 'threads';
      } else if (/^Threads\[\d+\]$/.test(key)) {
        curThread = newThread();
        log.threads.push(curThread);
      }
      continue;
    }

    if (key === 'Stack Dump' || key === 'TLS Dump') {
      inRegisters = inStackTrace = false;
      inDump = true;
      continue;
    }

    switch (section) {
      case 'process':
        if (key === 'Process Name') log.processName = value;
        else if (key === 'Program ID') log.programId = value.toLowerCase();
        break;
      case 'exception':
        if (key === 'Type') log.exceptionType = value;
        else if (key === 'Address') log.address = parseAnnotated(value);
        else if (key === 'Break Reason') log.breakReason = value;
        else if (key === 'Break Address') log.breakAddress = value;
        break;
      case 'crashed':
      case 'threads': {
        if (!curThread) {
          // "Number of Threads:" etc. before the first Threads[NN]
          break;
        }
        if (key === 'Thread ID') curThread.id = value;
        else if (key === 'Thread Name') curThread.name = value;
        else if (key === 'Registers') {
          inRegisters = true;
          inStackTrace = false;
        } else if (key === 'Stack Trace') {
          inStackTrace = true;
          inRegisters = false;
        } else if (inRegisters && /^(X\[\d\d\]|FP|LR|SP|PC)$/.test(key)) {
          const a = parseAnnotated(value);
          if (a) curThread.registers[key] = a;
        } else if (inStackTrace && /^ReturnAddress\[\d+\]$/.test(key)) {
          const a = parseAnnotated(value);
          if (a) curThread.stackTrace.push(a);
        } else {
          inRegisters = inStackTrace = false;
        }
        break;
      }
      case 'modules': {
        const mm = /^Module (\d+)$/.exec(key);
        if (mm) {
          flushModule();
          curModule = { index: Number(mm[1]), moduleId: '' };
        } else if (curModule) {
          if (key === 'Address') {
            const r = /^([0-9a-fA-F]+)-([0-9a-fA-F]+)/.exec(value);
            if (r) {
              curModule.start = BigInt('0x' + r[1]);
              curModule.end = BigInt('0x' + r[2]);
            }
          } else if (key === 'Name') curModule.name = value;
          else if (key === 'Module Id') curModule.moduleId = value;
        }
        break;
      }
    }
  }
  flushModule();

  if (log.crashedThread) {
    log.pc = log.crashedThread.registers['PC'];
    log.lr = log.crashedThread.registers['LR'];
  }

  // Strings from the dumps: game version + anything that looks useful.
  // Return addresses that are really 8 ASCII bytes (e.g. 0x646f6d2f6574616d =
  // "mate/mod", a fragment of "ultimate/mods") are leftovers of a path string.
  for (const t of [log.crashedThread, ...log.threads]) {
    for (const ra of t?.stackTrace ?? []) {
      if (ra.module) continue;
      let v = ra.value;
      for (let k = 0; k < 8; k++) {
        dumpBytes.push(Number(v & 0xffn));
        v >>= 8n;
      }
      dumpBytes.push(0);
    }
  }
  const strings = extractStrings(dumpBytes);
  const versions = new Map<string, number>();
  for (const s of strings) {
    for (const v of s.matchAll(/(?<![\d.])(\d{1,2}\.\d{1,2}\.\d{1,2})(?![\d.])/g)) {
      versions.set(v[1]!, (versions.get(v[1]!) ?? 0) + 1);
    }
  }
  const best = [...versions.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) log.gameVersion = best[0];
  log.dumpStrings = [...new Set(strings.filter((s) => !NOISE_STRINGS.has(s) && /[a-z]{3}/i.test(s)))].slice(0, 50);

  return log;
}
