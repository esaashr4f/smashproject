// Usage: npm run scan-csv -- path/to/modfiles.csv
import { readFileSync } from 'node:fs';
import { csvSource } from '../src/core/scanner/source';
import { scan } from '../src/core/scanner/scan';
import { reportMarkdown } from '../src/core/report';

const file = process.argv[2] ?? 'fixtures/modfiles_esa_2026-11-05.csv';
const r = await scan(csvSource(readFileSync(file, 'utf8')));
console.log(reportMarkdown(r));
