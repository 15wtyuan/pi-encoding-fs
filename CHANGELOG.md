# Changelog

## 0.5.0

### Added
- ISO-8859-1, ISO-8859-15 and Windows-1252 support for `read`, `write`, `edit` and `grep`,
  including aliases (`latin1`, `latin9`, `cp1252`, `win1252`, …) via the new
  `src/encoding/registry.ts`.
- `utf8Guard` config option (default `true`): UTF-8 files (BOM, or valid UTF-8 with non-ASCII
  characters) under a single-byte config stay UTF-8.
- Strict encoding for single-byte targets: characters that cannot be represented (e.g. `€` in
  ISO-8859-1) abort the write with an error listing characters, lines and encoding; the file is
  left untouched. U+FFFD is always rejected.
- No Python/chardet needed for single-byte encodings.

### Changed
- `ENCODING_NOTE` lists all supported encodings and mentions broken umlauts.

### Breaking change (edge case)
- A `sourceEncoding` outside the supported list used to be treated silently as UTF-8. It now
  produces an error naming the config file and the allowed values.
  Without any `.encoding-converter.json`, and for existing GB configs, behaviour is unchanged.
