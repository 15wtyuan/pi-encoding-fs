// src/encoding/registry.ts
//
// Single source of truth for the encodings this extension supports (FA-01).
// Adding another encoding later means adding one entry to REGISTRY.

export type CanonicalEncoding =
  | "UTF-8"
  | "GB18030"
  | "GBK"
  | "GB2312"
  | "ISO-8859-1"
  | "ISO-8859-15"
  | "Windows-1252";

interface EncodingInfo {
  canonical: CanonicalEncoding;
  family: "utf8" | "gb" | "single-byte";
  /** Name understood by iconv-lite. */
  iconv: string;
  /** WHATWG label for `rg --encoding`; null = ripgrep default (UTF-8). */
  rg: string | null;
  /** Alternative spellings; compared after `aliasKey()` folding. */
  aliases: string[];
}

const REGISTRY: EncodingInfo[] = [
  { canonical: "UTF-8", family: "utf8", iconv: "utf-8", rg: null, aliases: ["utf8"] },
  { canonical: "GB18030", family: "gb", iconv: "gb18030", rg: "gb18030", aliases: [] },
  { canonical: "GBK", family: "gb", iconv: "gbk", rg: "gbk", aliases: [] },
  { canonical: "GB2312", family: "gb", iconv: "gb2312", rg: "gb2312", aliases: [] },
  {
    canonical: "ISO-8859-1",
    family: "single-byte",
    iconv: "iso-8859-1",
    rg: "iso-8859-1",
    aliases: ["latin1", "l1", "iso8859-1", "iso_8859-1"],
  },
  {
    canonical: "ISO-8859-15",
    family: "single-byte",
    iconv: "iso-8859-15",
    rg: "iso-8859-15",
    aliases: ["latin9", "l9", "iso8859-15", "iso_8859-15"],
  },
  {
    canonical: "Windows-1252",
    family: "single-byte",
    iconv: "windows-1252",
    rg: "windows-1252",
    aliases: ["cp1252", "win1252", "windows1252"],
  },
];

/** Case-insensitive, separator-insensitive key ("ISO_8859-1" -> "iso88591"). */
function aliasKey(name: string): string {
  return name.trim().toLowerCase().replace(/[-_\s]/g, "");
}

const BY_KEY = new Map<string, EncodingInfo>();
const BY_CANONICAL = new Map<CanonicalEncoding, EncodingInfo>();
for (const info of REGISTRY) {
  BY_CANONICAL.set(info.canonical, info);
  for (const n of [info.canonical, ...info.aliases]) BY_KEY.set(aliasKey(n), info);
}

export const SUPPORTED_ENCODINGS: readonly CanonicalEncoding[] = REGISTRY.map((e) => e.canonical);

/** Map any accepted spelling to its canonical name, or null if unsupported (FA-02). */
export function normalizeEncoding(name: string): CanonicalEncoding | null {
  if (typeof name !== "string") return null;
  return BY_KEY.get(aliasKey(name))?.canonical ?? null;
}

export function isSingleByteEncoding(name: string): boolean {
  const c = normalizeEncoding(name);
  return c !== null && BY_CANONICAL.get(c)!.family === "single-byte";
}

/** iconv-lite name for a supported encoding; throws for unsupported names. */
export function toIconvName(name: string): string {
  const c = normalizeEncoding(name);
  if (!c) throw new UnsupportedEncodingError(name);
  return BY_CANONICAL.get(c)!.iconv;
}

/** ripgrep `--encoding` label, or null for UTF-8 (FA-12). Throws if unsupported. */
export function toRipgrepLabel(name: string): string | null {
  const c = normalizeEncoding(name);
  if (!c) throw new UnsupportedEncodingError(name);
  return BY_CANONICAL.get(c)!.rg;
}

/** Thrown for encodings outside the registry (FA-03). Never falls back to UTF-8. */
export class UnsupportedEncodingError extends Error {
  constructor(
    public readonly encoding: string,
    public readonly configPath?: string,
  ) {
    super(
      `Unsupported encoding "${encoding}"` +
        (configPath ? ` in ${configPath}` : "") +
        `. Supported: ${SUPPORTED_ENCODINGS.join(", ")}.`,
    );
    this.name = "UnsupportedEncodingError";
  }
}
