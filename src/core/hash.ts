// SHA-256 via Web Crypto: built into every modern browser and into Node 20+,
// so there's nothing to install and it's the same code in tests and the site.
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
