import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { devEntry, isolatedRoot, loadExtension } from "./helpers/load.mjs";

const root = isolatedRoot("ayla-tools-compact-exec-");
const work = mkdtempSync(join(root.root, "project-"));
writeFileSync(join(work, "alpha.txt"), "hello alpha\n");
const { definitions } = await loadExtension(devEntry, root);

const ctx = {
	cwd: work,
	sessionManager: { getSessionId: () => "compact-test-session", getSessionFile: () => undefined },
};
const text = (result) => result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");

test("shell execution runs in the call cwd, not the process cwd", async () => {
	const result = await definitions.get("bash").execute("exec-1", { command: "pwd && cat alpha.txt" }, undefined, undefined, ctx);
	assert.notEqual(process.cwd(), work);
	assert.ok(!result.isError);
	assert.equal(text(result), `${realpathSync(work)}\nhello alpha\n`);
});

test("the host context reaches the delegated built-in", async () => {
	const result = await definitions.get("bash").execute("exec-2", { command: "printenv PI_SESSION_ID" }, undefined, undefined, ctx);
	assert.equal(text(result).trim(), "compact-test-session");
});

test("a failing command stays a tool error with its exit code", async () => {
	const result = await definitions.get("bash").execute("exec-3", { command: "exit 7" }, undefined, undefined, ctx);
	assert.equal(result.isError, true);
	assert.equal(result.structuredContent.exit_code, 7);
	assert.match(text(result), /Command exited with code 7/);
});

test("read and ls resolve relative paths against the call cwd", async () => {
	const read = await definitions.get("read").execute("exec-4", { path: "alpha.txt" }, undefined, undefined, ctx);
	assert.ok(!read.isError);
	assert.match(text(read), /hello alpha/);

	const listing = await definitions.get("ls").execute("exec-5", { path: "." }, undefined, undefined, ctx);
	assert.ok(!listing.isError);
	assert.match(text(listing), /alpha\.txt/);
});

test("repeated calls reuse the per-cwd delegate and keep working", async () => {
	const bash = definitions.get("bash");
	for (const call of ["exec-6", "exec-7"]) {
		const result = await bash.execute(call, { command: "echo again" }, undefined, undefined, ctx);
		assert.equal(text(result), "again\n");
	}
});
