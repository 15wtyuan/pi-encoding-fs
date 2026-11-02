// test/single-byte-e2e.test.ts — drive Pi's real read/edit tool definitions (T-01/02/05, FA-14)
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditToolDefinition, createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { makeReadOperations, makeEditOperations, makeWriteOperations } from "../src/operations";
import { wrapEditToolWithEncodingPreview, clearUtf8Cache, isUtf8FileCached } from "../src/edit-preview";
import { clearConfigCache } from "../src/config";

let root: string;
beforeEach(() => {
  clearConfigCache();
  clearUtf8Cache();
  root = mkdtempSync(join(tmpdir(), "sbe-"));
  writeFileSync(join(root, ".encoding-converter.json"), JSON.stringify({ sourceEncoding: "ISO-8859-1" }));
});
const none = undefined as never;
const text = (r: { content: { type: string; text?: string }[] }) => r.content.find((c) => c.type === "text")?.text ?? "";

describe("Pi tools on an ISO-8859-1 file", () => {
  it("read shows umlauts; edit preserves Latin-1 bytes; preview routes via encoding-aware path", async () => {
    const f = join(root, "a.txt");
    writeFileSync(f, Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65, 0x0a]));

    const read = createReadToolDefinition(root, { operations: makeReadOperations() });
    expect(text(await read.execute("r", { path: f }, none, none, none))).toContain("Grüße");

    // Non-UTF-8 bytes -> wrapper uses our preview (reads via operations, correct encoding).
    expect(isUtf8FileCached(f)).toBe(false);

    const def = wrapEditToolWithEncodingPreview(
      createEditToolDefinition(root, { operations: makeEditOperations() }),
      makeEditOperations(),
      root,
    );
    const res = await def.execute("e", { path: f, edits: [{ oldText: "Grüße", newText: "Grüße, Jürgen" }] }, none, none, none);
    expect(String(res.details?.diff)).toContain("Jürgen");
    expect([...readFileSync(f)].slice(0, 5)).toEqual([0x47, 0x72, 0xfc, 0xdf, 0x65]);
    expect(readFileSync(f).includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
  });

  it("edit with an unrepresentable char rejects and leaves the file byte-identical", async () => {
    const f = join(root, "b.txt");
    const raw = Buffer.from([0x61, 0xfc, 0x0a]);
    writeFileSync(f, raw);
    const def = createEditToolDefinition(root, { operations: makeEditOperations() });
    await expect(
      def.execute("e", { path: f, edits: [{ oldText: "a", newText: "5 €" }] }, none, none, none),
    ).rejects.toThrow(/ISO-8859-1/);
    expect(readFileSync(f).equals(raw)).toBe(true);
  });

  it("Windows-1252 file with an undefined byte (0x81) cannot be rewritten silently", async () => {
    writeFileSync(join(root, ".encoding-converter.json"), JSON.stringify({ sourceEncoding: "cp1252" }));
    clearConfigCache();
    const f = join(root, "c.txt");
    const raw = Buffer.from([0x61, 0x81, 0x0a]);
    writeFileSync(f, raw);
    await expect(makeWriteOperations().writeFile(f, "a�\n")).rejects.toThrow(/U\+FFFD.*line 1/);
    expect(readFileSync(f).equals(raw)).toBe(true);
  });
});
