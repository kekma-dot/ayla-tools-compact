import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { devEntry, isolatedRoot, sdk } from "./helpers/load.mjs";

const root = isolatedRoot("ayla-tools-compact-exec-");
const work = mkdtempSync(join(root.root, "project-"));
writeFileSync(join(work, "alpha.txt"), "hello alpha\n");

const SENTINEL = "SENTINEL bash executor ran";
const SENTINEL_PARAMETERS = {
	type: "object",
	properties: { command: { type: "string", description: "sentinel command" } },
	required: ["command"],
	additionalProperties: false,
};

/**
 * A second extension that owns a `bash` tool of its own, the way a sandboxed
 * bash or any custom executor does. It is registered *before* the compact
 * extension, which is the arrangement that used to break.
 */
const sentinelEntry = join(root.root, "sentinel-bash.ts");
writeFileSync(
	sentinelEntry,
	`export default function (pi) {
	pi.registerTool({
		name: "bash",
		label: "bash (sentinel)",
		description: "sentinel bash with its own executor",
		parameters: ${JSON.stringify(SENTINEL_PARAMETERS)},
		async execute() {
			return { content: [{ type: "text", text: ${JSON.stringify(SENTINEL)} }] };
		},
	});
}
`,
);

/** Real Pi loader and session with the sentinel first, the compact extension second. */
async function openSession(additionalExtensionPaths) {
	const loader = new sdk.DefaultResourceLoader({
		cwd: work,
		agentDir: root.agentDir,
		noExtensions: true,
		noSkills: true,
		noThemes: true,
		noContextFiles: true,
		noPromptTemplates: true,
		additionalExtensionPaths,
		settingsManager: sdk.SettingsManager.inMemory(),
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await loader.reload();
	const loaded = loader.getExtensions();
	const resolvers = loaded.extensions.flatMap((extension) => extension.toolRenderers ?? []);
	const sentinelDefinition = [...loaded.extensions]
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "bash")?.definition;
	const resolveRenderers = (name, base = () => undefined) =>
		resolvers.reduceRight(
			(next, resolver) => () => resolver(name, next),
			base,
		)();
	const { session, extensionsResult } = await sdk.createAgentSession({
		cwd: work,
		agentDir: root.agentDir,
		resourceLoader: loader,
		sessionManager: sdk.SessionManager.inMemory(),
		settingsManager: sdk.SettingsManager.inMemory(),
	});
	return { loaded, resolvers, sentinelDefinition, resolveRenderers, session, extensionsResult };
}

const ctx = {
	cwd: work,
	sessionManager: { getSessionId: () => "compact-test-session", getSessionFile: () => undefined },
};
const text = (result) => result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");

const theme = { fg: (_role, entry) => entry };
const renderContext = () => ({ state: {}, toolCallId: "call-1", invalidate() {}, cwd: work, executionStarted: true, argsComplete: true });

test("a custom bash registered before us keeps its own definition, schema and executor", async () => {
	const { loaded, sentinelDefinition, resolveRenderers, session, extensionsResult } = await openSession([sentinelEntry, devEntry]);
	try {
		assert.deepEqual(loaded.errors, []);
		assert.deepEqual(extensionsResult.errors, []);
		assert.ok(sentinelDefinition, "the sentinel bash must be registered at all");

		// This is the regression: the previous registerTool implementation re-registered all five
		// names and replaced this definition, which silently removed the custom executor.
		assert.equal(session.getToolDefinition("bash"), sentinelDefinition, "the custom bash definition must survive identity-intact");
		assert.deepEqual(session.getToolDefinition("bash").parameters, SENTINEL_PARAMETERS, "the custom bash keeps its own schema");

		const result = await session.getToolDefinition("bash").execute("sentinel-1", { command: "true" }, undefined, undefined, ctx);
		assert.equal(text(result), SENTINEL, "the custom bash executor must still be the one that runs");

		// and the surviving executor is drawn by the compact row
		const renderers = resolveRenderers("bash", () => session.getToolDefinition("bash"));
		assert.equal(renderers.renderShell, "self");
		const head = renderers.renderCall({ command: "true" }, theme, renderContext());
		assert.match(head.render(80)[0], /^\S \$ true/, "the row is the compact one, drawn by our resolver");
	} finally {
		await session.dispose();
	}
});

test("only one extension resolver exists, so no tool definition is added", async () => {
	const { loaded, resolvers, session } = await openSession([sentinelEntry, devEntry]);
	try {
		assert.equal(resolvers.length, 1, "the compact extension contributes renderers only");
		const registered = loaded.extensions.flatMap((extension) => [...extension.tools.keys()]);
		assert.deepEqual(registered, ["bash"], "nothing but the sentinel may be registered");
	} finally {
		await session.dispose();
	}
});

test("the built-in bash still runs in the call cwd", async () => {
	const { session } = await openSession([devEntry]);
	try {
		const result = await session.getToolDefinition("bash").execute("exec-1", { command: "pwd && cat alpha.txt" }, undefined, undefined, ctx);
		assert.notEqual(process.cwd(), work);
		assert.ok(!result.isError);
		assert.equal(text(result), `${realpathSync(work)}\nhello alpha\n`);
	} finally {
		await session.dispose();
	}
});

test("the host context still reaches the built-in bash", async () => {
	const { session } = await openSession([devEntry]);
	try {
		const result = await session.getToolDefinition("bash").execute("exec-2", { command: "printenv PI_SESSION_ID" }, undefined, undefined, ctx);
		assert.equal(text(result).trim(), "compact-test-session");
	} finally {
		await session.dispose();
	}
});

test("a failing command stays a tool error with its exit code", async () => {
	const { session } = await openSession([devEntry]);
	try {
		const result = await session.getToolDefinition("bash").execute("exec-3", { command: "exit 7" }, undefined, undefined, ctx);
		assert.equal(result.isError, true);
		assert.equal(result.structuredContent.exit_code, 7);
		assert.match(text(result), /Command exited with code 7/);
	} finally {
		await session.dispose();
	}
});

test("built-in read and ls resolve relative paths against the call cwd", async () => {
	const { session } = await openSession([devEntry]);
	try {
		const read = await session.getToolDefinition("read").execute("exec-4", { path: "alpha.txt" }, undefined, undefined, ctx);
		assert.ok(!read.isError);
		assert.match(text(read), /hello alpha/);

		const listing = await session.getToolDefinition("ls").execute("exec-5", { path: "." }, undefined, undefined, ctx);
		assert.ok(!listing.isError);
		assert.match(text(listing), /alpha\.txt/);
	} finally {
		await session.dispose();
	}
});
