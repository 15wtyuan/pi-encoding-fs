// test/single-byte.test.ts — ISO-8859-1 / ISO-8859-15 / Windows-1252 (T-01..T-17, FA-15)
// Fixtures are built from raw bytes so no editor can alter their encoding.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// T-16 / NFA-05: single-byte handling must never need Python/chardet.
vi.mock("../src/encoding/detector", () => ({
  detectEncoding: async () => {
    throw new Error("chardet must not be called for single-byte encodings");
  },
}));

import { makeReadOperations, makeWriteOperations, makeEditOperations } from "../src/operations";
import { resolveReadEncoding, resolveWriteEncoding } from "../src/resolve";
import { clearConfigCache, findNearestConfig } from "../src/config";
import { buildEncodingGroups, buildRgArgs, searchFiles, findRg } from "../src/grep";
import { normalizeEncoding, toRipgrepLabel } from "../src/encoding/registry";
import { encodeFromUtf8Strict } from "../src/encoding/converter";
import { ENCODING_NOTE } from "../src/note";

let root: string;
const cfg = (obj: object, dir = root) => writeFileSync(join(dir, ".encoding-converter.json"), JSON.stringify(obj));
const GRUESSE = Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65, 0x0a]); // "Grüße\n" in ISO-8859-1
const hasFFFD = (b: Buffer) => b.includes(Buffer.from([0xef, 0xbf, 0xbd]));

async function editFile(f: string, from: string, to: string) {
  const ops = makeEditOperations();
  const text = (await ops.readFile(f)).toString("utf-8");
  await ops.writeFile(f, text.replace(from, to));
}

beforeEach(() => {
  clearConfigCache();
  root = mkdtempSync(join(tmpdir(), "sb-"));
});

describe("registry", () => {
  it("T-12 aliases resolve to canonical names", () => {
    expect(["latin1", "L9", "cp1252", "utf8"].map(normalizeEncoding)).toEqual([
      "ISO-8859-1", "ISO-8859-15", "Windows-1252", "UTF-8",
    ]);
    expect(normalizeEncoding("iso_8859-15")).toBe("ISO-8859-15");
    expect(normalizeEncoding("KOI8-R")).toBeNull();
  });
  it("FA-12 maps to valid ripgrep labels", () => {
    expect(toRipgrepLabel("latin1")).toBe("iso-8859-1");
    expect(toRipgrepLabel("latin9")).toBe("iso-8859-15");
    expect(toRipgrepLabel("win1252")).toBe("windows-1252");
    expect(toRipgrepLabel("UTF-8")).toBeNull();
  });
});

describe("read / edit / write", () => {
  it("T-01 reads ISO-8859-1 as clean UTF-8", async () => {
    cfg({ sourceEncoding: "ISO-8859-1" });
    const f = join(root, "a.txt");
    writeFileSync(f, GRUESSE);
    const out = (await makeReadOperations().readFile(f)).toString("utf-8");
    expect(out).toBe("Grüße\n");
    expect(out).not.toContain("�");
  });

  it("T-02 edit keeps ISO-8859-1 bytes", async () => {
    cfg({ sourceEncoding: "ISO-8859-1" });
    const f = join(root, "a.txt");
    writeFileSync(f, GRUESSE);
    await editFile(f, "Grüße", "Grüße, Jürgen");
    const bytes = readFileSync(f);
    expect([...bytes]).toEqual([0x47, 0x72, 0xfc, 0xdf, 0x65, 0x2c, 0x20, 0x4a, 0xfc, 0x72, 0x67, 0x65, 0x6e, 0x0a]);
    expect(hasFFFD(bytes)).toBe(false);
  });

  it("T-03 new ISO-8859-15 file stores € as A4", async () => {
    cfg({ sourceEncoding: "ISO-8859-15" });
    const f = join(root, "new.txt");
    await makeWriteOperations().writeFile(f, "Preis: 5 €");
    expect(readFileSync(f).at(-1)).toBe(0xa4);
  });

  it("T-04 new Windows-1252 file stores „ “ € as 84 93 80", async () => {
    cfg({ sourceEncoding: "Windows-1252" });
    const f = join(root, "new.txt");
    await makeWriteOperations().writeFile(f, "„Preis“: 5 €");
    const b = readFileSync(f);
    expect(b[0]).toBe(0x84);
    expect(b[6]).toBe(0x93);
    expect(b.at(-1)).toBe(0x80);
  });

  it("T-05 unrepresentable € in ISO-8859-1: error, file untouched", async () => {
    cfg({ sourceEncoding: "ISO-8859-1" });
    const f = join(root, "a.txt");
    writeFileSync(f, GRUESSE);
    await expect(makeWriteOperations().writeFile(f, "Grüße\nPreis 5 €\n")).rejects.toThrow(
      /ISO-8859-1.*"€" \(U\+20AC\) at line 2/s,
    );
    expect(readFileSync(f).equals(GRUESSE)).toBe(true);
  });

  it("T-06 emoji via edit in ISO-8859-15: error, file untouched", async () => {
    cfg({ sourceEncoding: "ISO-8859-15" });
    const f = join(root, "a.txt");
    const raw = Buffer.from([0x61, 0xfc, 0x0a]);
    writeFileSync(f, raw);
    await expect(editFile(f, "a", "a😀")).rejects.toThrow(/ISO-8859-15/);
    expect(readFileSync(f).equals(raw)).toBe(true);
  });

  it("T-07 UTF-8 file under single-byte config stays UTF-8", async () => {
    cfg({ sourceEncoding: "ISO-8859-1" });
    const f = join(root, "u.txt");
    writeFileSync(f, Buffer.from([0x61, 0xc3, 0xbc, 0x0a])); // "aü\n"
    expect((await makeReadOperations().readFile(f)).toString("utf-8")).toBe("aü\n");
    await editFile(f, "a", "b");
    expect([...readFileSync(f)]).toEqual([0x62, 0xc3, 0xbc, 0x0a]);
  });

  it("T-08 UTF-8 BOM with ASCII-only content survives edit", async () => {
    cfg({ sourceEncoding: "ISO-8859-1" });
    const f = join(root, "bom.txt");
    writeFileSync(f, Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0a]));
    expect(await resolveReadEncoding(f)).toBe("UTF-8");
    // Pi's edit tool strips and re-adds the BOM itself; emulate that here.
    const ops = makeEditOperations();
    const text = (await ops.readFile(f)).toString("utf-8");
    await ops.writeFile(f, text.replace("a", "b"));
    expect([...readFileSync(f)]).toEqual([0xef, 0xbb, 0xbf, 0x62, 0x0a]);
  });

  it("T-09 utf8Guard:false decodes UTF-8 bytes as ISO-8859-1", async () => {
    cfg({ sourceEncoding: "ISO-8859-1", utf8Guard: false });
    const f = join(root, "u.txt");
    writeFileSync(f, Buffer.from([0xc3, 0xbc]));
    expect((await makeReadOperations().readFile(f)).toString("utf-8")).toBe("Ã¼");
  });

  it("T-10 root ISO-8859-15 with UTF-8 override for docs/**", async () => {
    cfg({ sourceEncoding: "ISO-8859-15", overrides: [{ pattern: "docs/**", sourceEncoding: "UTF-8" }] });
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "src", "a.txt"), Buffer.from([0xa4, 0x0a])); // € in -15
    writeFileSync(join(root, "docs", "b.txt"), Buffer.from([0xe2, 0x82, 0xac, 0x0a])); // € in UTF-8
    const ops = makeReadOperations();
    expect((await ops.readFile(join(root, "src", "a.txt"))).toString("utf-8")).toBe("€\n");
    expect((await ops.readFile(join(root, "docs", "b.txt"))).toString("utf-8")).toBe("€\n");
  });

  it("T-11 CRLF is preserved on edit", async () => {
    cfg({ sourceEncoding: "ISO-8859-1" });
    const f = join(root, "crlf.txt");
    writeFileSync(f, Buffer.from([0x61, 0xfc, 0x0d, 0x0a, 0x62, 0x0d, 0x0a]));
    await editFile(f, "b", "c");
    expect([...readFileSync(f)]).toEqual([0x61, 0xfc, 0x0d, 0x0a, 0x63, 0x0d, 0x0a]);
  });

  it("FA-07 new files ignore the UTF-8 guard and are created in the configured encoding", async () => {
    cfg({ sourceEncoding: "latin1" });
    expect(await resolveWriteEncoding(join(root, "new.txt"))).toBe("ISO-8859-1");
  });

  it("T-13 unknown encoding errors with config path and allowed names", async () => {
    cfg({ sourceEncoding: "KOI8-R" });
    const f = join(root, "a.txt");
    writeFileSync(f, GRUESSE);
    await expect(makeReadOperations().readFile(f)).rejects.toThrow(/KOI8-R.*\.encoding-converter\.json.*ISO-8859-15/s);
    await expect(makeWriteOperations().writeFile(join(root, "n.txt"), "x")).rejects.toThrow(/Unsupported encoding/);
  });

  it("T-16 works without chardet/python (detector is mocked to throw)", async () => {
    cfg({ sourceEncoding: "ISO-8859-1" });
    const f = join(root, "a.txt");
    writeFileSync(f, GRUESSE);
    await editFile(f, "Grüße", "Grüße!");
    expect(readFileSync(f).includes(Buffer.from([0xfc, 0xdf, 0x65, 0x21]))).toBe(true);
  });

  it("T-17 without config, bytes pass through untouched", async () => {
    const f = join(root, "u.txt");
    const raw = Buffer.from("grüße €\n", "utf-8");
    writeFileSync(f, raw);
    expect((await makeReadOperations().readFile(f)).equals(raw)).toBe(true);
    await editFile(f, "grüße", "Grüße");
    expect(readFileSync(f).toString("utf-8")).toBe("Grüße €\n");
  });
});

describe("strict encoding", () => {
  it("FA-11 never produces ? or EF BF BD for unmappable chars", () => {
    expect(() => encodeFromUtf8Strict("a\u0000😀", "ISO-8859-1")).toThrow(/U\+1F600/);
    expect(encodeFromUtf8Strict("ok?", "ISO-8859-1").toString("latin1")).toBe("ok?");
    expect(() => encodeFromUtf8Strict("�", "Windows-1252")).toThrow();
  });
  it("FA-10 typographic quotes fail in ISO-8859-1/-15 but pass in Windows-1252", () => {
    expect(() => encodeFromUtf8Strict("“x”", "ISO-8859-1")).toThrow();
    expect(() => encodeFromUtf8Strict("“x”", "ISO-8859-15")).toThrow();
    expect(() => encodeFromUtf8Strict("“x”", "Windows-1252")).not.toThrow();
  });
});

describe("grep", () => {
  it("T-15 aliases form a single group", async () => {
    cfg({ sourceEncoding: "latin1", overrides: [{ pattern: "legacy/**", sourceEncoding: "ISO-8859-1" }] });
    const found = (await findNearestConfig(root))!;
    expect(buildEncodingGroups(found)).toHaveLength(1);
  });

  it("T-14 passes a valid label to rg and finds umlauts", async () => {
    cfg({ sourceEncoding: "latin1" });
    const found = (await findNearestConfig(root))!;
    const args = buildRgArgs({ pattern: "x" }, buildEncodingGroups(found)[0], root);
    expect(args.slice(args.indexOf("--encoding"), args.indexOf("--encoding") + 2)).toEqual(["--encoding", "iso-8859-1"]);
    if (!findRg()) return;
    writeFileSync(join(root, "a.txt"), GRUESSE);
    const out = await searchFiles(root, { pattern: "Grüße" });
    expect(out).toMatch(/a\.txt:1:Grüße/);
  });

  it("FA-03 unknown encoding fails grep too", async () => {
    cfg({ sourceEncoding: "KOI8-R" });
    await expect(searchFiles(root, { pattern: "x" })).rejects.toThrow(/KOI8-R/);
  });
});

describe("ENCODING_NOTE (FA-15)", () => {
  it("is constant, names all encodings and mentions broken umlauts", () => {
    for (const n of ["GB18030", "GBK", "GB2312", "ISO-8859-1", "ISO-8859-15", "Windows-1252"]) {
      expect(ENCODING_NOTE).toContain(n);
    }
    expect(ENCODING_NOTE).toMatch(/umlauts/);
    expect(ENCODING_NOTE.length).toBeLessThan(120 * 4 + 200);
    expect(ENCODING_NOTE).toMatchSnapshot();
  });
});
