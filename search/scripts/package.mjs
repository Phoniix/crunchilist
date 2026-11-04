// Builds the store upload: node search/scripts/package.mjs -> dist/crunchilist-search-<version>.zip
// The store rejects a manifest "key" and assigns its own, so it's removed here and kept only for local loading.
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { zip } from "../../scripts/package.mjs";
import { BUILD, build } from "./build.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIST = path.join(ROOT, "dist");

export function storeManifest(manifest) {
  const { key, ...rest } = manifest;
  return rest;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    out.push(...(entry.isDirectory() ? await walk(full) : [full]));
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const manifest = await build();
  const files = [];
  for (const file of (await walk(BUILD)).sort()) {
    const name = path.relative(BUILD, file).split(path.sep).join("/");
    const data = name === "manifest.json" ? Buffer.from(`${JSON.stringify(storeManifest(manifest), null, 2)}\n`) : await readFile(file);
    files.push({ name, data });
  }
  await mkdir(DIST, { recursive: true });
  const out = path.join(DIST, `crunchilist-search-${manifest.version}.zip`);
  await writeFile(out, zip(files));
  console.log(`${files.length} files, ${((await stat(out)).size / 1024).toFixed(0)} KB -> ${path.relative(ROOT, out)}`);
}
