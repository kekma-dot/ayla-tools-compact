![ayla-tools-compact banner](assets/banner.png)

# ayla-tools-compact

**English** · [Русский](README.ru.md)

One-line tool rows for [Pi](https://pi.dev). `bash`, `read`, `grep`, `find` and `ls` draw as a single line instead of a full-width block.

```text
✓ $ pwd && whoami && date 0.0s
  /Users/example
  example
  Tue Oct 19 02:38:11 UTC 2026
```

```text
· grep /renderResult/ --glob extensions/*.ts
  extensions/index.ts: renderResult(result, options, theme, context) {
  extensions/index.ts: return lines((width: number) => {
  … +7 lines · ctrl+o
```

A collapsed row shows 5 output lines, or 9 when the call failed. `ctrl+o` expands to at most 400 lines. Shell calls show elapsed time and the end of their output, where errors usually are; the file tools show the beginning.

## Install

Needs Pi 1.3.0, which is the tested baseline. Other Pi versions are untested. The host packages `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` come from Pi itself, so the extension has no runtime dependencies.

```sh
# from git
pi install git:github.com/kekma-dot/ayla-tools-compact

# pinned
pi install git:github.com/kekma-dot/ayla-tools-compact@<commit>

# local checkout
pi install ./ayla-tools-compact
```

Restart Pi or run `/reload` after installing.

## What it changes

Only the drawing. The extension adds one renderer resolver through the public `pi.registerToolRenderer` hook. For the five names above it returns `renderCall` and `renderResult` with `renderShell: "self"`. For every other name it calls `next()` and leaves the row to Pi.

It registers no tools, so execution, parameter schemas, permissions and the active tool set stay exactly as Pi set them. A custom or sandboxed `bash` registered by another extension keeps its own executor and schema and just draws with the compact row.

Because the resolver works per tool name, two extensions that draw the same names decide the result by load order. Remove or disable this package to get Pi's rendering back.

## Settings

`PI_GLAM_TOOLS=0` turns the drawing off for one run. The variable name is kept from earlier versions of the package.

```sh
PI_GLAM_TOOLS=0 pi
```

`pi config` toggles the extension. To keep the package installed but load nothing from it:

```json
{
  "packages": [
    { "source": "git:github.com/kekma-dot/ayla-tools-compact", "extensions": [] }
  ]
}
```

To uninstall, run `pi remove git:github.com/kekma-dot/ayla-tools-compact` and restart Pi.

## Behavior

| Case | Row |
|---|---|
| Collapsed | 5 output lines plus `… +N lines · ctrl+o`, before a tail and after a head |
| Expanded (`ctrl+o`) | Up to 400 lines, with the remaining count |
| Failed call | 9 preview lines and a `✗` glyph; the shell row shows the error end |
| `bash` | Timed from execution start to the final result, output tail |
| `read` | `path:from-to` when `offset` or `limit` is used, plus a line count |
| `grep`, `find`, `ls` | Argument summary plus a match or entry count |
| Empty output | No body rows |

## Limits

- Only those five tools are restyled. `edit` and `write` keep Pi's rendering.
- Preview sizes, the 400-line cap and the glyphs are constants in the source, so changing them means editing the extension.
- Counters count output lines, not matches.
- ANSI color in tool output is stripped, so colored output loses its color.
- Every row is truncated to the terminal width, including wide characters and control characters.
- This is a terminal feature. It does not change what the model receives.

## Development

```sh
npm ci
npm run check   # TypeScript against Pi 1.3.0 declarations
npm test        # node:test
```

`npm test` packs the package, unpacks the real artifact, loads it through Pi's `DefaultResourceLoader` and drives the renderers, including the case where another extension registered its own `bash` first.

## License

MIT, see [LICENSE](LICENSE). Author: kekma-dot. Provenance is recorded in [provenance.json](provenance.json).
