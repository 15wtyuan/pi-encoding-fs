// src/note.ts
// Always-on system-prompt note (< ~120 tokens). Constant, with no runtime
// branch, so the prompt prefix stays stable and prompt caching stays effective.
// Covers both cases: a config exists (don't re-encode by hand) and none exists
// (create one when Chinese text or umlauts look garbled).
export const ENCODING_NOTE = `Note: \`read\`/\`write\`/\`edit\`/\`grep\` auto-transcode GB18030/GBK/GB2312/ISO-8859-1/ISO-8859-15/Windows-1252 ↔ UTF-8 where a \`.encoding-converter.json\` exists (nearest wins; deeper overrides). Don't \`iconv\` or re-save as UTF-8 — that corrupts on-disk encoding. If \`read\` shows garbled Chinese or broken umlauts ("GrÃ¼ÃŸe", "Gr�ße"), create/edit \`.encoding-converter.json\`:
{"sourceEncoding":"ISO-8859-15","overrides":[{"pattern":"docs/**","sourceEncoding":"UTF-8"}]}`;
