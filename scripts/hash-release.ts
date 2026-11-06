// Hash a downloaded plugin/Skyline file and print a known_plugins.json entry.
// Usage: npm run hash-release -- path/to/libarcropolis.nro "ARCropolis" "4.1.1"
// Download the asset from the project's GitHub release page for that exact
// version (never a "latest" link), then paste the output into src/data/known_plugins.json.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { sha256Hex } from '../src/core/hash';

const [file, product, version] = process.argv.slice(2);
if (!file || !product || !version) {
  console.log('Usage: npm run hash-release -- <file> <product> <version>');
  process.exit(1);
}
const bytes = new Uint8Array(readFileSync(file));
console.log(JSON.stringify({ name: basename(file), product, version, size: bytes.length, sha256: await sha256Hex(bytes) }));
