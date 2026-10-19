import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isolatedRoot, loadExtension, sdk } from "./helpers/load.mjs";
import { stagePackage } from "./helpers/stage.mjs";

const EXPECTED_NAMES = ["bash", "find", "grep", "ls", "read"];

/** Stands in for whatever the registered definition would draw on its own. */
const HOST_RENDERERS = { renderShell: "default", renderCall: () => "host-call", renderResult: () => "host-result" };

const staged = stagePackage();
const root = isolatedRoot("ayla-tools-compact-registration-");

// Keep session creation away from the real profile.
const previousEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = root.root;
process.env.XDG_CONFIG_HOME = join(root.root, ".config");
after(() => {
	for (const [key, value] of Object.entries(previousEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test("publish artifact declares the Pi package contract", () => {
	const manifest = JSON.parse(readFileSync(join(staged.dir, "package.json"), "utf8"));
	assert.equal(manifest.name, "ayla-tools-compact");
	assert.equal(manifest.license, "MIT");
	assert.deepEqual(manifest.pi.extensions, ["./extensions/index.ts"]);
	assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], "*");
	assert.equal(manifest.peerDependencies["@earendil-works/pi-tui"], "*");
	assert.ok(manifest.keywords.includes("pi-package"));
	assert.ok(!("dependencies" in manifest), "host packages must not be runtime dependencies");
});

test("publish artifact ships only declared files", () => {
	for (const required of [
		"LICENSE",
		"README.md",
		"README.ru.md",
		"assets/banner.png",
		"extensions/index.ts",
		"package.json",
		"provenance.json",
	]) {
		assert.ok(staged.files.includes(required), `missing from tarball: ${required}`);
	}
	for (const file of staged.files) {
		assert.ok(!file.startsWith("node_modules/"), `unexpected dependency in tarball: ${file}`);
		assert.ok(!file.startsWith("tests/"), `tests must not ship: ${file}`);
		assert.ok(!file.endsWith(".tgz"), `stray tarball in package: ${file}`);
	}
});

test("the extension registers a renderer resolver, never a tool", async () => {
	const { loaded, definitions, resolvers } = await loadExtension(staged.entry, root);
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.length, 1);
	assert.equal(definitions.size, 0, "no tool definition may be registered: execution and schemas stay with the host");
	assert.equal(resolvers.length, 1, "exactly one renderer resolver");
});

test("the resolver covers the five compact rows and delegates every other name", async () => {
	const { resolveRenderers } = await loadExtension(staged.entry, root);
	for (const name of EXPECTED_NAMES) {
		const renderers = resolveRenderers(name, () => HOST_RENDERERS);
		assert.ok(renderers, `${name} needs compact renderers`);
		assert.notEqual(renderers, HOST_RENDERERS);
		assert.equal(renderers.renderShell, "self", `${name} must draw its own frame`);
		assert.equal(typeof renderers.renderCall, "function", `${name} needs renderCall`);
		assert.equal(typeof renderers.renderResult, "function", `${name} needs renderResult`);
		assert.equal(renderers.execute, undefined, `${name} must not carry an executor`);
		assert.equal(renderers.parameters, undefined, `${name} must not carry a schema`);
	}
	for (const name of ["write", "edit", "resolve_preview", "custom_tool"]) {
		assert.equal(resolveRenderers(name, () => HOST_RENDERERS), HOST_RENDERERS, `${name} must delegate to next()`);
	}
});

test("object-prototype names fall through next() exactly once", async () => {
	const { resolveRenderers } = await loadExtension(staged.entry, root);
	for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf", "write"]) {
		let calls = 0;
		const renderers = resolveRenderers(name, () => {
			calls += 1;
			return HOST_RENDERERS;
		});
		assert.equal(renderers, HOST_RENDERERS, `${name} must not be captured by an inherited property`);
		assert.equal(calls, 1, `${name} must call next() exactly once`);
	}
});

test("the host's tool definitions and active set are untouched", async () => {
	const open = async (additionalExtensionPaths, name) => {
		const dir = join(root.root, name);
		mkdirSync(dir);
		const agentDir = join(dir, "agent");
		const cwd = join(dir, "work");
		mkdirSync(agentDir);
		mkdirSync(cwd);
		const loader = new sdk.DefaultResourceLoader({
			cwd,
			agentDir,
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
		const { session, extensionsResult } = await sdk.createAgentSession({
			cwd,
			agentDir,
			resourceLoader: loader,
			sessionManager: sdk.SessionManager.inMemory(),
			settingsManager: sdk.SettingsManager.inMemory(),
		});
		return { session, extensionsResult };
	};

	const bare = await open([], "nested-bare");
	const compact = await open([staged.entry], "nested-compact");
	try {
		assert.deepEqual(compact.extensionsResult.errors, []);
		assert.deepEqual(compact.session.getActiveToolNames().sort(), bare.session.getActiveToolNames().sort(), "the active tool set must not change");
		for (const name of EXPECTED_NAMES) {
			const definition = compact.session.getToolDefinition(name);
			assert.ok(definition, `${name} must still exist`);
			assert.equal(typeof definition.execute, "function", `${name} keeps its own executor`);
			assert.equal(definition.renderShell, undefined, `${name} keeps the host definition, not a compact one`);
			assert.deepEqual(
				JSON.parse(JSON.stringify(definition.parameters)),
				JSON.parse(JSON.stringify(bare.session.getToolDefinition(name).parameters)),
				`${name} keeps the host schema`,
			);
		}
	} finally {
		await compact.session.dispose();
		await bare.session.dispose();
	}
});

test("PI_GLAM_TOOLS=0 registers nothing at all", async () => {
	process.env.PI_GLAM_TOOLS = "0";
	try {
		const { loaded, definitions, resolvers } = await loadExtension(staged.entry, root);
		assert.deepEqual(loaded.errors, []);
		assert.equal(definitions.size, 0, "no tool may be registered when disabled");
		assert.equal(resolvers.length, 0, "no renderer may be registered when disabled");
	} finally {
		delete process.env.PI_GLAM_TOOLS;
	}
});

test("an extension list without this package leaves the built-in rendering alone", async () => {
	const bare = isolatedRoot("ayla-tools-compact-bare-");
	const loader = new sdk.DefaultResourceLoader({
		cwd: bare.cwd,
		agentDir: bare.agentDir,
		noExtensions: true,
		noSkills: true,
		noThemes: true,
		noContextFiles: true,
		noPromptTemplates: true,
		additionalExtensionPaths: [],
		settingsManager: sdk.SettingsManager.inMemory(),
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await loader.reload();
	const loaded = loader.getExtensions();
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.length, 0, "extensions: [] loads nothing");
	assert.equal(loaded.extensions.flatMap((extension) => extension.toolRenderers ?? []).length, 0);
});
