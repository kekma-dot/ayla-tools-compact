import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { devEntry, isolatedRoot, loadExtension } from "./helpers/load.mjs";

const root = isolatedRoot("ayla-tools-compact-render-");
const { definitions, resolveRenderers } = await loadExtension(devEntry, root);

/** Only fg() is used by the extension; identity styling keeps widths measurable. */
const theme = { fg: (_role, text) => text };

const textResult = (text) => ({ content: [{ type: "text", text }] });

/** Whatever the tool definition would draw on its own; the resolver chain must end here. */
const hostRenderers = { renderShell: "default", renderCall: () => ({ render: () => ["host-call"], invalidate() {} }), renderResult: () => ({ render: () => ["host-result"], invalidate() {} }) };

function mount(name, args, result, options = {}) {
	assert.equal(definitions.size, 0, "the compact rows come from the renderer resolver, not from a registered tool");
	const tool = resolveRenderers(name, () => hostRenderers);
	assert.ok(tool, `${name} must get a renderer`);
	assert.notEqual(tool, hostRenderers, `${name} must be drawn by the compact resolver`);
	assert.equal(tool.renderShell, "self", `${name} must draw its own frame`);
	const context = {
		state: {},
		args,
		toolCallId: "call-1",
		invalidate() {},
		lastComponent: undefined,
		cwd: root.cwd,
		executionStarted: true,
		argsComplete: true,
		isPartial: options.isPartial ?? false,
		expanded: options.expanded ?? false,
		showImages: false,
		isError: options.isError ?? false,
		durationMs: undefined,
		outputPad: 0,
	};
	const head = tool.renderCall(args, theme, context);
	const body = result === undefined ? undefined : tool.renderResult(result, { expanded: options.expanded ?? false, isPartial: options.isPartial ?? false }, theme, context);
	return {
		context,
		head: (width) => head.render(width),
		body: (width) => body.render(width),
	};
}

const lines = (count, text = (i) => `line ${i + 1}`) => Array.from({ length: count }, (_, i) => text(i));

test("a completed call takes one header line plus a bounded body", () => {
	const view = mount("bash", { command: "printf 'a\\nb\\n'" }, textResult("a\nb\n"));
	const [header] = view.head(80);
	assert.match(header, /^✓ \$ printf/);
	assert.equal(view.head(80).length, 1, "the header is a single row");
	assert.deepEqual(view.body(80), ["  a", "  b"]);
});

test("collapsed output keeps 5 lines and reports the hidden rest", () => {
	const view = mount("ls", { path: "." }, textResult(lines(8).join("\n")));
	const body = view.body(80);
	assert.equal(body.length, 6, "5 preview lines plus the hint");
	assert.deepEqual(body.slice(0, 5), lines(5).map((line) => `  ${line}`));
	assert.match(body[5], /^ {2}… \+3 lines · ctrl\+o$/);
});

test("errors get a wider preview and an error glyph", () => {
	const view = mount("bash", { command: "false" }, textResult(lines(20).join("\n")), { isError: true });
	const body = view.body(80);
	assert.equal(body.length, 10, "9 preview lines plus the hidden-count hint");
	assert.match(body[0], /… \+11 lines/, "a tail puts the hidden-count hint first");
	assert.match(view.head(80)[0], /^✗ \$ false/);
});

test("expanded output is capped at 400 lines", () => {
	const view = mount("grep", { pattern: "x", path: "." }, textResult(lines(500).join("\n")), { expanded: true });
	const body = view.body(80);
	assert.equal(body.length, 401, "400 lines plus the remaining-count hint");
	assert.match(body[400], /… \+100 lines/);
});

test("shell output shows its tail, file output its head", () => {
	const shell = mount("bash", { command: "seq 1 10" }, textResult(lines(10).join("\n")));
	const shellBody = shell.body(80);
	assert.equal(shellBody[0].includes("… +5 lines"), true, "the truncation hint sits above a tail");
	assert.equal(shellBody.at(-1), "  line 10");

	const listing = mount("ls", { path: "." }, textResult(lines(10).join("\n")));
	const listingBody = listing.body(80);
	assert.equal(listingBody[0], "  line 1", "a head keeps the first line");
	assert.match(listingBody.at(-1), /… \+5 lines/);
});

test("the header carries elapsed time and an output counter", () => {
	const shell = mount("bash", { command: "true" }, textResult("ok"));
	shell.head(80);
	shell.body(80);
	assert.match(shell.head(80)[0], /✓ \$ true {2}0\.0s$/);

	const read = mount("read", { path: "alpha.txt", offset: 2, limit: 3 }, textResult("a\nb\nc"));
	assert.match(read.head(80)[0], /^✓ read alpha\.txt:2-4 {2}3 lines$/);
});

test("a running call has no duration and a warning glyph", () => {
	const view = mount("bash", { command: "sleep 1" }, textResult("partial"), { isPartial: true });
	view.head(80);
	view.body(80);
	assert.match(view.head(80)[0], /^· \$ sleep 1$/);
});

test("header state follows the newest arguments object", () => {
	const view = mount("bash", { command: "first" }, textResult("ok"));
	view.head(80);
	const updated = { command: "second --with-flag" };
	const next = resolveRenderers("bash", () => hostRenderers).renderCall(updated, theme, view.context);
	assert.equal(next, view.context.state.head, "the same component is reused");
	assert.match(next.render(80)[0], /\$ second --with-flag/);
});

test("control characters stay inside one rendered row", () => {
	const view = mount("bash", { command: "echo a\nrm -rf b\r\tc\u009d" }, textResult("x\ry\u009b\n"));
	const header = view.head(80);
	assert.equal(header.length, 1);
	assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(header[0]), "no C0/C1 control character may reach the terminal");
	assert.match(header[0], /^✓ \$ echo a rm -rf b c( {2}0\.\ds)?$/);
	for (const line of view.body(80)) assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(line));
});

test("foreign ANSI color is stripped from output", () => {
	const view = mount("ls", { path: "." }, textResult("\u001b[31mred\u001b[0m\u001b]0;title\u0007 plain"));
	const body = view.body(80);
	assert.ok(!body.some((line) => line.includes("\u001b")), "no escape sequence may survive");
	assert.match(body[0], /red plain$/);
});

test("wide and combining characters never exceed the render width", () => {
	const sample = ["日本語のテキストはとても長いです", "🇺🇦👩‍💻 emoji sequence", "e\u0301\u0301\u0301 combining marks"];
	const view = mount("ls", { path: "." }, textResult(sample.join("\n")));
	for (const width of [10, 24, 40]) {
		for (const line of view.body(width)) {
			assert.ok(visibleWidth(line) <= width, `"${line}" must fit ${width} columns`);
		}
		assert.ok(visibleWidth(view.head(width)[0]) <= width, `header must fit ${width} columns`);
	}
	const narrow = mount("bash", { command: "日本語のコマンド --flag" }, textResult("ok"));
	const header = narrow.head(16)[0];
	assert.ok(visibleWidth(header) <= 16, "the header is truncated, not wrapped");
});

test("preview hints and output fit every width from one to twenty columns", () => {
	for (const name of ["bash", "ls"]) {
		const view = mount(name, { command: "long", path: "." }, textResult(lines(30).join("\n")));
		for (let width = 1; width <= 20; width += 1) {
			for (const row of [...view.head(width), ...view.body(width)]) {
				assert.ok(visibleWidth(row) <= width, `${name} row must fit ${width} columns`);
			}
		}
	}
});

test("empty output renders no body rows", () => {
	const view = mount("bash", { command: "true" }, textResult("\n"));
	assert.deepEqual(view.body(80), []);
});

test("rendering never mutates the tool result it is given", () => {
	const result = textResult("a\nb\nc");
	result.details = { exit_code: 0 };
	const deepFreeze = (value) => {
		if (value && typeof value === "object") {
			for (const inner of Object.values(value)) deepFreeze(inner);
			Object.freeze(value);
		}
		return value;
	};
	const frozen = deepFreeze(result);
	const before = JSON.stringify(frozen);
	const view = mount("bash", { command: "seq 1 3" }, frozen);
	assert.deepEqual(view.body(80), ["  a", "  b", "  c"]);
	assert.equal(JSON.stringify(frozen), before, "the result object stays exactly as the host handed it over");
});

test("an unknown tool name keeps the host renderers", () => {
	const resolved = resolveRenderers("write", () => hostRenderers);
	assert.equal(resolved, hostRenderers, "a name outside the five must fall through to next()");
	assert.equal(resolveRenderers("write"), undefined, "with nothing behind it, next() stays empty");
});
