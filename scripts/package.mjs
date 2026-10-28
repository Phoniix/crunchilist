// Builds store or sideload packages.
//   node scripts/package.mjs              -> dist/crunchilist-<version>.zip (Chrome Web Store)
//   node scripts/package.mjs --sideload   -> dist/kivori-sekai-<version>.zip (GitHub Releases)
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import {
  PACKAGE_FOLDERS, PACKAGE_ROOT_FILES, STORE_OMIT_FILES,
  STORE_PACKAGE_FOLDERS, STORE_PACKAGE_ROOT_FILES,
  contentFiles, sideloadManifest, storeManifest, storeUpdaterStub,
} from "../lib/update-files.js";

export { contentFiles, storeManifest, sideloadManifest };

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const REFS = {
  ".js": /(?:\bimport\s*(?:[\w*{}\s,]+from\s*)?|\bexport\s*[\w*{}\s,]+from\s*|\bimport\()\s*["'](\.{1,2}\/[^"']+)["']/g,
  ".html": /\b(?:src|href)="(?!https?:|data:|#|mailto:)([^"]+)"/g,
  ".css": /url\(\s*["']?(?!https?:|data:|#)([^"')]+)["']?\s*\)/g,
};

export function localRefs(file, text) {
  const pattern = REFS[path.extname(file)];
  if (!pattern) return [];
  return [...text.matchAll(pattern)].map((match) => match[1].split(/[?#]/)[0]).filter(Boolean);
}

async function missingRefs(outDir, manifest) {
  const missing = [];
  const need = (from, ref) => {
    const target = ref.startsWith("/") ? path.join(outDir, ref) : path.resolve(path.dirname(from), ref);
    if (!existsSync(target)) missing.push(`${path.relative(outDir, from) || "manifest.json"} -> ${ref}`);
  };
  const manifestFile = path.join(outDir, "manifest.json");
  const entries = [
    manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_ui?.page,
    ...Object.values(manifest.icons || {}), ...contentFiles(manifest),
    ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []),
  ].filter(Boolean);
  for (const ref of entries) need(manifestFile, `/${ref}`);
  for (const file of await walk(outDir)) {
    for (const ref of localRefs(file, await readFile(file, "utf8").catch(() => ""))) need(file, ref);
  }
  return missing;
}

export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

async function build({ sideload }) {
  const manifest = JSON.parse(await readFile(path.join(ROOT, "manifest.json"), "utf8"));
  const folders = sideload ? PACKAGE_FOLDERS : STORE_PACKAGE_FOLDERS;
  const rootFiles = sideload ? PACKAGE_ROOT_FILES : STORE_PACKAGE_ROOT_FILES;
  const outName = sideload ? "kivori-sekai" : "crunchilist";
  const outDir = path.join(DIST, outName);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const folder of folders) await cp(path.join(ROOT, folder), path.join(outDir, folder), { recursive: true });
  for (const file of [...rootFiles, ...contentFiles(manifest)]) {
    await mkdir(path.dirname(path.join(outDir, file)), { recursive: true });
    await cp(path.join(ROOT, file), path.join(outDir, file));
  }
  if (!sideload) {
    for (const file of STORE_OMIT_FILES) await rm(path.join(outDir, file), { force: true });
    await writeFile(path.join(outDir, "app/updater.js"), storeUpdaterStub());
  }
  const packaged = sideload ? sideloadManifest(manifest) : storeManifest(manifest);
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(packaged, null, 2)}\n`);

  const missing = await missingRefs(outDir, packaged);
  if (missing.length) {
    console.error(`Missing files in the package:\n  ${missing.join("\n  ")}`);
    process.exitCode = 1;
    return;
  }

  const files = [];
  for (const file of (await walk(outDir)).sort()) {
    files.push({ name: path.relative(outDir, file).split(path.sep).join("/"), data: await readFile(file) });
  }
  const zipFile = path.join(DIST, `${outName}-${manifest.version}.zip`);
  await writeFile(zipFile, zip(files));
  const size = (await stat(zipFile)).size;
  console.log(`${sideload ? "sideload" : "store"}: ${files.length} files, ${(size / 1024).toFixed(0)} KB -> ${path.relative(ROOT, zipFile)}`);
}

async function main() {
  const sideload = process.argv.includes("--sideload");
  await build({ sideload });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();
