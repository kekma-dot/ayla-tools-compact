import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isolatedRoot, loadExtension, sdk } from "./helpers/load.mjs";
import { stagePackage } from "./helpers/stage.mjs";

const EXPECTED_TOOLS = ["bash", "find", "grep", "ls", "read"];

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

test("staged artifact registers exactly the five compact tool rows", async () => {
	const { loaded, definitions } = await loadExtension(staged.entry, root);
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.length, 1);
	assert.deepEqual([...definitions.keys()].sort(), EXPECTED_TOOLS);
	for (const [name, definition] of definitions) {
		assert.equal(definition.name, name);
		assert.equal(definition.renderShell, "self", `${name} must draw its own frame`);
		assert.equal(typeof definition.renderCall, "function", `${name} needs renderCall`);
		assert.equal(typeof definition.renderResult, "function", `${name} needs renderResult`);
		assert.equal(typeof definition.execute, "function", `${name} needs execute`);
		assert.equal(typeof definition.parameters, "object");
		assert.ok(definition.parameters !== null && !Array.isArray(definition.parameters));
		assert.ok(definition.description.length > 0, `${name} keeps the built-in description`);
	}
});

test("the host resolves the registered definitions over the built-ins", async () => {
	const { loader, definitions } = await loadExtension(staged.entry, root);
	const { session, extensionsResult } = await sdk.createAgentSession({
		cwd: root.cwd,
		agentDir: root.agentDir,
		resourceLoader: loader,
		sessionManager: sdk.SessionManager.inMemory(),
		settingsManager: sdk.SettingsManager.inMemory(),
	});
	try {
		assert.deepEqual(extensionsResult.errors, []);
		for (const name of EXPECTED_TOOLS) {
			assert.equal(session.getToolDefinition(name), definitions.get(name), `${name} must resolve to the compact registration`);
		}
		const active = session.getActiveToolNames();
		for (const name of EXPECTED_TOOLS) assert.ok(active.includes(name), `${name} must stay active`);
	} finally {
		await session.dispose();
	}
});

test("PI_GLAM_TOOLS=0 leaves the built-in rendering untouched", async () => {
	process.env.PI_GLAM_TOOLS = "0";
	try {
		const { loaded, definitions } = await loadExtension(staged.entry, root);
		assert.deepEqual(loaded.errors, []);
		assert.equal(definitions.size, 0, "the extension must register no tools when disabled");
	} finally {
		delete process.env.PI_GLAM_TOOLS;
	}
});
