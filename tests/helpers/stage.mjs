import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root of this package (tests live one level below it). */
export const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * Build the publish artifact with `npm pack` and unpack it, so tests load the
 * real package layout (declared `files`, rewritten paths) instead of the
 * development checkout.
 */
export function stagePackage() {
	const out = mkdtempSync(join(tmpdir(), "ayla-tools-compact-pack-"));
	const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", out], {
		cwd: packageRoot,
		encoding: "utf8",
		env: { ...process.env, npm_config_offline: "true" },
	});
	if (packed.status !== 0) {
		throw new Error(`npm pack failed (${packed.status}): ${packed.stderr || packed.stdout}`);
	}
	const [info] = JSON.parse(packed.stdout);
	const tarball = join(out, info.filename);
	const unpacked = join(out, "unpacked");
	mkdirSync(unpacked);
	const tar = spawnSync("tar", ["-xzf", tarball, "-C", unpacked], { encoding: "utf8" });
	if (tar.status !== 0) {
		throw new Error(`tar extract failed (${tar.status}): ${tar.stderr}`);
	}
	const dir = join(unpacked, "package");
	return {
		dir,
		entry: join(dir, "extensions", "index.ts"),
		files: info.files.map((file) => file.path).sort(),
	};
}
