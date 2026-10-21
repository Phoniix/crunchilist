// Builds the loadable extension into search/build/: node search/scripts/build.mjs
// Everything the extension runs is bundled here, so the package never loads code from anywhere else.
import { execSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SEARCH = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(SEARCH, "..");
const SRC = path.join(SEARCH, "src");
export const BUILD = path.join(SEARCH, "build");

const esbuild = (args) => execSync(["npx --yes esbuild", ...args, "--bundle --target=chrome120 --log-level=warning"].join(" "), { cwd: SEARCH, stdio: "inherit" });

export async function build() {
  await rm(BUILD, { recursive: true, force: true });
  await mkdir(BUILD, { recursive: true });
  esbuild(["src/background/service-worker.js", "src/app/app.js", "src/popup/popup.js", "--format=esm", "--outbase=src", `--outdir=${path.relative(SEARCH, BUILD)}`]);
  const content = (await readdir(path.join(SRC, "content"))).filter((file) => file.endsWith(".js")).map((file) => `src/content/${file}`);
  if (content.length) esbuild([...content, "--format=iife", "--outbase=src", `--outdir=${path.relative(SEARCH, BUILD)}`]);
  for (const file of ["app/app.html", "app/app.css", "app/prism.css", "app/privacy.html", "popup/popup.html", "popup/popup.css"]) {
    await cp(path.join(SRC, file), path.join(BUILD, file)).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
  await cp(path.join(SRC, "app", "guide"), path.join(BUILD, "app", "guide"), { recursive: true, force: true }).catch((error) => { if (error.code !== "ENOENT") throw error; });
  await mkdir(path.join(BUILD, "icons"), { recursive: true });
  for (const name of [16, 32, 48, 128].map((size) => `icon${size}.png`).concat("crunchilist-logo.svg")) await cp(path.join(ROOT, "icons", name), path.join(BUILD, "icons", name));
  await mkdir(path.join(BUILD, "fonts"), { recursive: true });
  for (const name of ["inter-latin.woff2", "sora-latin.woff2", "nunito-latin.woff2", "OFL.txt"]) await cp(path.join(ROOT, "fonts", name), path.join(BUILD, "fonts", name));
  await mkdir(path.join(BUILD, "feeds"), { recursive: true });
  for (const name of ["where-map.json", "where-map-meta.json"]) {
    await cp(path.join(SEARCH, "feeds", name), path.join(BUILD, "feeds", name)).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
  const manifest = JSON.parse(await readFile(path.join(SEARCH, "manifest.json"), "utf8"));
  // Packaged gap map is read with chrome.runtime.getURL — web_accessible not required for extension pages / SW.
  await writeFile(path.join(BUILD, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const manifest = await build();
  console.log(`Crunchilist Search ${manifest.version} -> ${path.relative(ROOT, BUILD)}`);
}
