import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as sdk from "@earendil-works/pi-coding-agent";
import { packageRoot } from "./stage.mjs";

export { sdk };

/** The entrypoint under test: development checkout unless a staged entry is passed. */
export const devEntry = join(packageRoot, "extensions", "index.ts");

/** Isolated temp HOME/cwd/agentDir, so nothing reads or writes the real profile. */
export function isolatedRoot(prefix = "ayla-tools-compact-") {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const agentDir = join(root, "agent");
	const cwd = join(root, "work");
	mkdirSync(agentDir);
	mkdirSync(cwd);
	return { root, agentDir, cwd };
}

/** Load one extension entrypoint through Pi's actual DefaultResourceLoader. */
export async function loadExtension(entry, root) {
	const loader = new sdk.DefaultResourceLoader({
		cwd: root.cwd,
		agentDir: root.agentDir,
		noExtensions: true,
		noSkills: true,
		noThemes: true,
		noContextFiles: true,
		noPromptTemplates: true,
		additionalExtensionPaths: [resolve(entry)],
		settingsManager: sdk.SettingsManager.inMemory(),
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await loader.reload();
	const loaded = loader.getExtensions();
	const definitions = new Map();
	for (const extension of loaded.extensions) {
		for (const tool of extension.tools.values()) {
			definitions.set(tool.definition.name, tool.definition);
		}
	}
	return { loader, loaded, definitions };
}
