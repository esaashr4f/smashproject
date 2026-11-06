// Explain crash logs from the command line.
// Usage: npm run explain -- path/to/log1.log path/to/log2.log
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseCrashLog } from '../src/core/crashlog/parse';
import { explain } from '../src/core/crashlog/match';
import { explanationMarkdown } from '../src/core/report';

const files = process.argv.slice(2);
if (!files.length) console.log('Usage: npm run explain -- <file.log> [...]');
for (const f of files) console.log(explanationMarkdown(explain(parseCrashLog(readFileSync(f, 'utf8'), basename(f)))) + '\n');
