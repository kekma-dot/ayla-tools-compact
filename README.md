![ayla-tools-compact banner](assets/banner.png)

# ayla-tools-compact

**English** · [Русский](README.ru.md)

Compact, one-line tool rows for [Pi](https://pi.dev) — a rendering-only extension for
`bash`, `read`, `grep`, `find`, and `ls`.

> **Status: public beta (`0.1.0-beta.2`).** Verified against Pi `1.3.0` only. See
> [Compatibility](#compatibility) for what that claim does and does not cover.

Instead of a full-width colored block per tool call, every call becomes a single row:
a status glyph, the tool verb, its arguments, and the useful part of the output.

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

Collapsed rows show 5 output lines (9 for a failed call); `ctrl+o` expands to at most
400 lines. A shell call is timed and shows the **tail** of its output, where errors
live; file-oriented tools show the **head**.

## What it changes — and what it does not

| | |
|---|---|
| Changed | How `bash`, `read`, `grep`, `find`, and `ls` calls and results are drawn. |
| Not changed | Tool names, descriptions, parameter schemas, execution, permissions, result payloads, session storage. |
| Not covered | `edit`, `write`, and every other tool keep Pi's default rendering. |

The extension registers no tools at all. It registers one **renderer resolver** through
Pi's public `pi.registerToolRenderer` hook: for the five names above it returns a compact
`renderCall`/`renderResult` with `renderShell: "self"`, and for every other name it
calls `next()`, so the rest of the chain decides. Execution, parameter schemas, exposure,
annotations, and the active tool set are never touched, which also means a custom or
sandboxed `bash` registered by another extension keeps its own definition and executor
and only gains the compact row.

## Install

Requires a working Pi installation. The extension itself has no runtime dependencies;
`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` are host-provided peers.

```bash
pi install git:github.com/kekma-dot/ayla-tools-compact
```

Restart Pi after installation. This package is not published to npm. For reproducible
installs, append `@<commit>` to the Git source using a verified release commit. A local
checkout also works: `pi install ./ayla-tools-compact`.

Try it for one session without adding it to settings:

```bash
pi -e git:github.com/kekma-dot/ayla-tools-compact
```

`pi list` shows configured packages. Personal installs land in `~/.pi/agent/settings.json`;
`--local` writes to `.pi/settings.json` instead, which Pi reads only after project trust
is granted.

## Disable, filter, uninstall

```bash
PI_GLAM_TOOLS=0 pi                 # one run, nothing drawn by this extension
pi config                          # toggle the package's extension interactively
pi remove git:github.com/kekma-dot/ayla-tools-compact  # remove the package declaration
```

The environment switch is named `PI_GLAM_TOOLS` for compatibility with earlier installs
and is intentionally stable; `PI_GLAM_TOOLS=0` makes the extension register no renderers,
so Pi's default rendering is used unchanged. To keep the package installed but load none of
its extensions, filter it in settings:

```json
{
  "packages": [
    { "source": "git:github.com/kekma-dot/ayla-tools-compact", "extensions": [] }
  ]
}
```

After removing a package, restart Pi so the built-in renderers are restored.

## Behavior details

| Case | Rendering |
|---|---|
| Collapsed | 5 output lines plus `… +N lines · ctrl+o` — before a tail, after a head. |
| Expanded (`ctrl+o`) | Up to 400 lines; the remaining count is still reported. |
| Failed call (`isError`) | 9 preview lines and a `✗` glyph; the shell row shows the error tail. |
| Shell (`bash`) | Timed (`0.1s`, measured from execution start to the final result), output tail. |
| `read` | `path:from-to` when `offset`/`limit` is used, plus a `lines` counter. |
| `grep`, `find`, `ls` | Argument summary plus a `matches`/`entries` counter. |
| Wide output | Every row is truncated to the terminal width; nothing wraps inside a row. |
| ANSI color in output | Stripped, so third-party color cannot break indentation or width. |
| Tabs | Rendered as two spaces. |
| Control characters | Flattened to spaces before drawing, including inside a multi-line shell command. |
| Empty output | No body rows. |

Rendering is used in the interactive transcript and in Pi's HTML transcript export.
Non-interactive modes (`--print`, RPC) have no tool rows to draw, so the extension has no
effect there beyond registration.

## Security

- The extension opens no sockets, spawns no processes of its own, and reads exactly one
  environment variable (`PI_GLAM_TOOLS`).
- It cannot change what a tool does: no tool is registered, so execution, permission
  rules, approval prompts, sandboxing, and result shapes cannot be replaced. Another
  extension's custom executor — a sandboxed `bash`, for example — keeps running; only the
  drawn row changes.
- No telemetry, no background timers, no writes outside Pi's own session storage.
- The renderer applies to the five names above for every extension, decided by load order;
  remove or disable the package to get the host rendering back.

## Compatibility

`peerDependencies` declare `"*"` for the host packages, as Pi's package documentation
requires; that is a module-mapping contract, **not** a compatibility guarantee.

Verified: `@earendil-works/pi-coding-agent` `1.3.0` with `@earendil-works/pi-tui`
`1.3.0`, loaded through Pi's real `DefaultResourceLoader` and a real `AgentSession` on
macOS with Node 25.9.0 (see [Development](#development)). **That is the only tested
baseline.** Other Pi versions are untested and no compatibility is promised for them: the
extension relies on `pi.registerToolRenderer`, the `ToolRendererResolver` contract
(`next()` delegation), `ToolRenderers` with `renderShell: "self"`, and the state semantics
of `ToolRenderContext`. If a host release changes any of those, this package must be
re-verified and re-released.

## Limitations

- Only five tools are restyled; `edit` and `write` are out of scope.
- Preview sizes, the expanded cap, and glyphs are fixed in the source; there are no
  settings, and changing them means editing or forking the extension.
- Line counters count output lines, not semantic matches.
- Colored output loses its color because ANSI sequences are stripped.
- Rendering is a terminal feature: it does not reduce the tokens sent to the model.
- Beta: rendering depends on host internals that are public API but still young.
- A renderer resolver can be overridden by extension load order; it is not a per-tool
  setting.

## Development

Development needs Node 22.19+ (CI uses Node 24); the published extension is loaded by
Pi's own TypeScript loader, so it adds no Node requirement of its own.

```bash
npm ci
npm run check   # TypeScript against the exact Pi 1.3.0 declarations
npm test        # node:test, no test framework
```

The test suite is deliberately small and is expected to fail if the rendering contract
drifts:

- `tests/registration.test.mjs` — packs the package with `npm pack`, unpacks the real
  artifact, loads it through Pi's `DefaultResourceLoader`, and checks that the extension
  registers zero tools and exactly one renderer resolver; that the resolver covers the
  five names with `renderShell: "self"` and delegates every other name (including
  `toString`, `constructor` and `__proto__`) to `next()` exactly once; that a real
  `AgentSession` keeps its own definitions and active set; and that `PI_GLAM_TOOLS=0` or
  an empty extension list registers nothing. It also asserts the tarball inventory
  contains no dependencies or tests.
- `tests/rendering.test.mjs` — drives the actual renderers: one-row headers, preview
  bounds (5 / 9 / 400), tail versus head, counters and timing, partial results, argument
  refresh, control-character flattening (C0 and C1), ANSI stripping, width safety for
  CJK, emoji and combining marks at every width from 1 to 20 columns, and that the tool
  result object is never mutated.
- `tests/delegation.test.mjs` — the regression suite. It registers a custom `bash` with
  its own schema and executor *before* this extension in a real loader and session, then
  asserts that the same definition object, its schema and its executor survive, that the
  built-in `bash`/`read`/`ls` still execute normally (cwd propagation, host context,
  exit-code errors, relative paths), and that only a renderer was added. The previous
  implementation, which re-registered the five tools, fails this test.

CI is configured to run `npm ci`, `npm run check`, and `npm test` on Ubuntu and macOS
with Node 24. Local verification used Node 25.9.0; the suite needs only `node:test` and
Pi's own loader, both independent of the Node version in that range.

## Uninstall and rollback

`pi remove <source>` (or deleting the entry from settings, or `PI_GLAM_TOOLS=0`) restores
Pi's default rendering. The package writes nothing outside Pi's normal package directory,
so rollback needs no cleanup.

## License

MIT — see [LICENSE](LICENSE). Original author: kekma-dot. The package is a curated public
snapshot; snapshot provenance is recorded in [provenance.json](provenance.json).
