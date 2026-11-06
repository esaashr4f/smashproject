// Pull "smashline_*" names out of a moveset's plugin.nro.
//
// Movesets look Smashline's functions up by name at runtime, so the names sit
// in the binary's read-only data as plain ASCII string literals. They are NOT
// dynamic-symbol imports, so we scan the raw bytes instead of parsing .dynsym.
// Rust doesn't NUL-terminate its strings, so two literals can sit back to back;
// the regex stops at the first non [A-Za-z0-9_] byte, which covers most cases.

const PREFIX = [0x73, 0x6d, 0x61, 0x73, 0x68, 0x6c, 0x69, 0x6e, 0x65, 0x5f]; // "smashline_"

const isNameByte = (b: number) =>
  (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f;

export function extractSmashlineNames(bytes: Uint8Array): Set<string> {
  const out = new Set<string>();
  const n = bytes.length - PREFIX.length;
  outer: for (let i = 0; i <= n; i++) {
    if (bytes[i] !== 0x73) continue;
    for (let k = 1; k < PREFIX.length; k++) if (bytes[i + k] !== PREFIX[k]) continue outer;
    let j = i + PREFIX.length;
    while (j < bytes.length && isNameByte(bytes[j]!)) j++;
    if (j > i + PREFIX.length) out.add(String.fromCharCode(...bytes.subarray(i, j)));
    i = j - 1;
  }
  return out;
}
