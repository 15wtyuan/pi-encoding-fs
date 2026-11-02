// src/encoding/converter.ts
import iconv from "iconv-lite";
import { normalizeEncoding, isSingleByteEncoding, toIconvName, UnsupportedEncodingError } from "./registry";

export function isGBEncoding(encoding: string): boolean {
  const upper = encoding.toUpperCase();
  return upper.includes("GB") || upper === "GB2312" || upper === "GBK" || upper === "GB18030";
}

export function resolveFileEncoding(
  detectedEncoding: string | null,
  detectedConfidence: number,
  resolvedSourceEncoding: string,
  confidenceThreshold: number,
): string {
  const canonical = normalizeEncoding(resolvedSourceEncoding);
  if (!canonical) throw new UnsupportedEncodingError(resolvedSourceEncoding);
  // Single-byte encodings are taken from config as-is: no detection (FA-04).
  if (canonical === "UTF-8" || isSingleByteEncoding(canonical)) {
    return canonical;
  }
  if (detectedEncoding && detectedConfidence >= confidenceThreshold && isGBEncoding(detectedEncoding)) {
    return detectedEncoding;
  }
  return resolvedSourceEncoding;
}

export function decodeToUtf8(buffer: Buffer, encoding: string): string {
  return iconv.decode(buffer, toIconvName(encoding));
}

export function encodeFromUtf8(text: string, encoding: string): Buffer {
  return iconv.encode(text, toIconvName(encoding));
}

export interface UnrepresentableChar {
  char: string;
  codePoint: number;
  line: number;
}

/** Thrown by encodeFromUtf8Strict; nothing must be written when it is raised (FA-10). */
export class UnrepresentableCharsError extends Error {
  constructor(
    public readonly encoding: string,
    public readonly chars: UnrepresentableChar[],
    public readonly total: number,
  ) {
    const shown = chars
      .map((c) => `"${c.char}" (U+${c.codePoint.toString(16).toUpperCase().padStart(4, "0")}) at line ${c.line}`)
      .join(", ");
    super(
      `Cannot write as ${encoding}: ${total} character(s) not representable: ${shown}` +
        `${total > chars.length ? ", ..." : ""}. Nothing was written. ` +
        `Replace these characters or switch the file to UTF-8 via .encoding-converter.json.`,
    );
    this.name = "UnrepresentableCharsError";
  }
}

const MAX_REPORTED = 10;

/**
 * Encode for a lossy (single-byte) target. A round-trip comparison guarantees that
 * no character is silently replaced by `?` (FA-10, FA-11); otherwise throws.
 */
export function encodeFromUtf8Strict(text: string, encoding: string): Buffer {
  const name = toIconvName(encoding);
  const buf = iconv.encode(text, name);
  // U+FFFD is never legitimate content, but some iconv tables map it to a byte
  // (e.g. 0x81 in windows-1252) and would round-trip it, so reject it explicitly.
  if (!text.includes("\uFFFD") && iconv.decode(buf, name) === text) return buf;

  const bad: UnrepresentableChar[] = [];
  let total = 0;
  let line = 1;
  const cache = new Map<string, boolean>();
  for (const ch of text) {
    if (ch === "\n") {
      line++;
      continue;
    }
    let ok = cache.get(ch);
    if (ok === undefined) {
      ok = ch !== "\uFFFD" && iconv.decode(iconv.encode(ch, name), name) === ch;
      cache.set(ch, ok);
    }
    if (!ok) {
      total++;
      if (bad.length < MAX_REPORTED) bad.push({ char: ch, codePoint: ch.codePointAt(0)!, line });
    }
  }
  throw new UnrepresentableCharsError(normalizeEncoding(encoding) ?? encoding, bad, total);
}
