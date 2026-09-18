// Content hashing. SHA-1 via the Web Crypto API, which exists on both
// Obsidian desktop and mobile. Hash is the source of truth for "did content
// actually change" (CONTEXT: mtime is only the fast-path filter).

export async function sha1(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", data);
  return toHex(digest);
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
