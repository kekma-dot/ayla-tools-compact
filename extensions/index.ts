/**
 * Compact tool rows.
 *
 * Instead of a full-width colored block, every call takes one line:
 *
 *   ✓ $ pwd && whoami && date 0.1s
 *     /Users/example
 *     example
 *     … +12 lines · ctrl+o
 *
 * Execution is not reimplemented: each tool delegates to Pi's own built-in
 * definition. Only rendering is replaced (renderCall / renderResult plus
 * renderShell: "self", i.e. no Box frame, no background, no blank padding).
 *
 * Opt out: PI_GLAM_TOOLS=0 pi  (legacy environment name, kept as-is)
 */
import {
	createBashToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const PREVIEW = 5; // output lines shown while collapsed
const PREVIEW_ERR = 9; // a failed call is shown more generously
const EXPANDED_MAX = 400; // ponytail: ceiling for the expanded view, tail beyond it
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

type Args = Record<string, any>;

type Spec = {
	/** how the row starts: "$" for shell, otherwise the tool name */
	title: (args: Args) => string;
	make: (cwd: string) => any;
	/** show elapsed time in the header */
	timed?: boolean;
	/** keep the tail of the output (errors at the bottom) instead of the head */
	tail?: boolean;
	/** what to append to the header once output exists */
	count?: (lines: string[]) => string;
};

const path_ = (args: Args) => str(args.file_path ?? args.path) || ".";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const SPECS: Record<string, Spec> = {
	bash: {
		timed: true,
		tail: true,
		title: (a) => `$ ${str(a.command) || "…"}`,
		make: (cwd) => createBashToolDefinition(cwd),
	},
	read: {
		count: (l) => plural(l.length, "line", "lines"),
		title: (a) => {
			let s = `read ${path_(a)}`;
			if (a.offset !== undefined || a.limit !== undefined) {
				const from = a.offset ?? 1;
				const to = a.limit !== undefined ? from + a.limit - 1 : "";
				s += `:${from}${to ? `-${to}` : ""}`;
			}
			return s;
		},
		make: (cwd) => createReadToolDefinition(cwd, { autoResizeImages: true }),
	},
	grep: {
		count: (l) => plural(l.length, "match", "matches"),
		title: (a) => `grep /${str(a.pattern)}/${a.glob ? ` --glob ${a.glob}` : ""}${a.path ? ` ${a.path}` : ""}`,
		make: (cwd) => createGrepToolDefinition(cwd),
	},
	find: {
		count: (l) => plural(l.length, "entry", "entries"),
		title: (a) => `find ${str(a.pattern)}${a.path ? ` in ${a.path}` : ""}`,
		make: (cwd) => createFindToolDefinition(cwd),
	},
	ls: {
		count: (l) => plural(l.length, "entry", "entries"),
		title: (a) => `ls ${path_(a)}${a.limit !== undefined ? ` (limit ${a.limit})` : ""}`,
		make: (cwd) => createLsToolDefinition(cwd),
	},
};

function str(v: unknown): string {
	return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

/**
 * Control characters inside a "single line" move the terminal cursor: \n pushes
 * the rest onto the next frame row, \r returns to the start of the current row
 * and overwrites what was already drawn, so two rows bleed into each other.
 * Multi-line bash commands and progress bars always carry them; flatten them
 * before drawing.
 */
const flat = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ");

/** A header must stay one line: control characters become a space, runs of spaces collapse. */
const flatInline = (s: string) => flat(s).replace(/\s{2,}/g, " ").trim();

/** Text output lines without ANSI: foreign color breaks indentation and width. */
function outputLines(result: any): string[] {
	const blocks = Array.isArray(result?.content) ? result.content : [];
	const text = blocks
		.filter((b: any) => b?.type === "text" && typeof b.text === "string")
		.map((b: any) => b.text)
		.join("\n");
	return text.replace(ANSI, "").split("\n");
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** pi-tui accepts any object with render(width): string[]. */
function lines(get: (width: number) => string[]) {
	return { render: (width: number) => get(width), invalidate() {} };
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_GLAM_TOOLS === "0") return;
	const delegates = new Map<string, any>();

	for (const [name, spec] of Object.entries(SPECS)) {
		// the built-in definition is needed for its schema/description; execution is taken lazily from ctx.cwd
		const base = spec.make(process.cwd());

		pi.registerTool({
			...base,
			renderShell: "self" as const,

			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const cwd = ctx?.cwd ?? process.cwd();
				let run = delegates.get(`${name}:${cwd}`);
				if (!run) {
					run = spec.make(cwd);
					delegates.set(`${name}:${cwd}`, run);
				}
				return run.execute(toolCallId, params, signal, onUpdate, ctx);
			},

			renderCall(args: Args, theme: any, context: any) {
				const st = context.state;
				st.args = args; // pi passes a new object on every update: keep the current one, or the row freezes on empty args
				if (spec.timed && context.executionStarted && st.t0 === undefined) st.t0 = Date.now();
				if (!st.head) {
					st.head = lines((width: number) => {
						const status = st.status ?? "run";
						const glyph =
							status === "err"
								? theme.fg("error", "✗")
								: status === "ok"
									? theme.fg("success", "✓")
									: theme.fg("warning", "·");
						const meta: string[] = [];
						if (spec.timed && st.t0 !== undefined && st.t1 !== undefined) meta.push(secs(st.t1 - st.t0));
						if (spec.count && st.out) meta.push(spec.count(st.out));
						const tail = meta.length ? theme.fg("muted", `  ${meta.join(" · ")}`) : "";
						// hierarchy through brightness, not color: only the status glyph and the verb are colored;
						// arguments use the same neutral tone as the output, otherwise the row turns into shouting
						const t = flatInline(spec.title(st.args ?? {}));
						const sp = t.indexOf(" ");
						const verb = theme.fg("toolTitle", sp < 0 ? t : t.slice(0, sp));
						const rest = sp < 0 ? "" : theme.fg("toolOutput", t.slice(sp));
						return [truncateToWidth(`${glyph} ${verb}${rest}${tail}`, width)];
					});
				}
				return st.head;
			},

			renderResult(result: any, options: any, theme: any, context: any) {
				const st = context.state;
				st.status = options.isPartial ? "run" : context.isError ? "err" : "ok";
				if (!options.isPartial && st.t1 === undefined) st.t1 = Date.now();

				// count here, not in render(): the header is drawn before the body and would otherwise miss the counter
				const all = outputLines(result);
				while (all.length && all[all.length - 1] === "") all.pop();
				st.out = all;

				return lines((width: number) => {
					if (!all.length) return [];

					const cap = options.expanded ? EXPANDED_MAX : context.isError ? PREVIEW_ERR : PREVIEW;
					const shown = spec.tail ? all.slice(-cap) : all.slice(0, cap);
					const hidden = all.length - shown.length;
					const hint = hidden > 0 ? theme.fg("muted", `  … +${hidden} lines · ctrl+o`) : undefined;

					const out: string[] = [];
					if (hint && spec.tail) out.push(truncateToWidth(hint, width));
					for (const line of shown) {
						out.push(truncateToWidth(`  ${theme.fg("toolOutput", truncateToWidth(flat(line.replace(/\t/g, "  ")), Math.max(0, width - 2)))}`, width));
					}
					if (hint && !spec.tail) out.push(truncateToWidth(hint, width));
					return out;
				});
			},
		});
	}
}
