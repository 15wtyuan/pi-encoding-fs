// src/resolve.ts
import { access, readFile } from "node:fs/promises";
import * as path from "node:path";
import { findNearestConfig, resolveOverrideEncoding, CONFIG_FILENAME, type FoundConfig } from "./config";
import { detectEncoding } from "./encoding/detector";
import { resolveFileEncoding } from "./encoding/converter";
import { normalizeEncoding, isSingleByteEncoding, UnsupportedEncodingError, type CanonicalEncoding } from "./encoding/registry";

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Canonical encoding configured for a file, or a clear error for unknown names (FA-03). */
export function resolveConfiguredEncoding(absFilePath: string, found: FoundConfig): CanonicalEncoding {
  const name = resolveOverrideEncoding(absFilePath, found);
  const canonical = normalizeEncoding(name);
  if (!canonical) throw new UnsupportedEncodingError(name, path.join(found.configDir, CONFIG_FILENAME));
  return canonical;
}

/** UTF-8 BOM, or fully valid UTF-8 containing at least one non-ASCII byte (FA-06). */
export function looksLikeUtf8(raw: Buffer): boolean {
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) return true;
  if (!raw.some((b) => b >= 0x80)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return true;
  } catch {
    return false;
  }
}

export async function resolveReadEncoding(absFilePath: string): Promise<string | null> {
  const found = await findNearestConfig(path.dirname(absFilePath));
  if (!found) return null;

  const sourceEncoding = resolveConfiguredEncoding(absFilePath, found);

  if (sourceEncoding === "UTF-8") return "UTF-8";

  // Single-byte decoders never fail, so a UTF-8 file would be silently
  // double-encoded. Guard against that unless disabled (FA-04, FA-06).
  if (isSingleByteEncoding(sourceEncoding)) {
    if (found.config.utf8Guard !== false) {
      try {
        if (looksLikeUtf8(await readFile(absFilePath))) return "UTF-8";
      } catch {
        /* unreadable / missing: fall through to the configured encoding */
      }
    }
    return sourceEncoding;
  }

  // Config GB -> only trust high-confidence GB detection, else fall back.
  const detection = await detectEncoding(absFilePath);
  return resolveFileEncoding(
    detection.encoding,
    detection.confidence,
    sourceEncoding,
    found.config.confidenceThreshold,
  );
}

export async function resolveWriteEncoding(absFilePath: string): Promise<string | null> {
  const found = await findNearestConfig(path.dirname(absFilePath));
  if (!found) return null;

  // Existing file: preserve its actual encoding (same logic as read).
  if (await fileExists(absFilePath)) {
    return resolveReadEncoding(absFilePath);
  }

  // New file: configured encoding, no detection, no UTF-8 guard (FA-07).
  return resolveConfiguredEncoding(absFilePath, found);
}
