// install.cmd / tools/install.ps1: first-time install from a GitHub release zip (Windows only).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { zip } from "../scripts/package.mjs";

const SCRIPT = path.resolve(import.meta.dirname, "../tools/install.ps1");
const windows = { skip: process.platform !== "win32" && "install.cmd is Windows only" };

const manifest = (version) => `${JSON.stringify({
  manifest_version: 3,
  name: "Kivori SekAI",
  version,
  content_scripts: [{ matches: ["https://www.crunchyroll.com/*"], js: ["content/crunchilist.js"] }],
}, null, 2)}\n`;

const FILES = {
  "manifest.json": manifest("1.0.120"),
  "update.cmd": "@echo off\n",
  "install.cmd": "@echo off\n",
  "INSTALL.txt": "install me\n",
  "tools/install.ps1": "# install\n",
  "tools/update.ps1": "# update\n",
  "app/app.html": "<main></main>\n",
  "app/prism.js": "render();\n",
  "lib/a.js": "export const a = 1;\n",
  "content/crunchilist.js": "bundle();\n",
};

async function zipOf(files) {
  const out = path.join(await mkdtemp(path.join(os.tmpdir(), "cl-install-zip-")), "release.zip");
  await writeFile(out, zip(Object.entries(files).map(([name, text]) => ({ name, data: Buffer.from(text) }))));
  return out;
}

function run(installDir, archive, ...args) {
  return new Promise((resolve) => {
    const source = archive ? ["-Zip", archive] : [];
    execFile("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT,
      "-InstallDir", installDir, ...source, "-NoPause", "-NoChrome", "-SettleMs", "0", ...args,
    ], { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, out: `${stdout}${stderr}` });
    });
  });
}

async function fakeRelease(download) {
  const hits = [];
  let base = "";
  const server = http.createServer((request, response) => {
    hits.push(request.url);
    if (request.url.includes("/releases/latest")) {
      return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        tag_name: "v1.0.120",
        assets: [{ name: "kivori-sekai-1.0.120.zip", browser_download_url: `${base}/download/kivori-sekai-1.0.120.zip` }],
      }));
    }
    if (request.url.startsWith("/download/")) return response.writeHead(200, { "content-type": "application/zip" }).end(download);
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { hits, args: ["-ApiBase", base], close: () => new Promise((resolve) => server.close(resolve)) };
}

const text = (dir, file) => readFile(path.join(dir, file), "utf8").catch(() => null);

test("install.ps1 stays plain ASCII", async () => {
  assert.ok((await readFile(SCRIPT)).every((byte) => byte < 128));
});

test("a first install writes the release into an empty folder", windows, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cl-install-"));
  const archive = await zipOf(FILES);
  const { code, out } = await run(root, archive);
  assert.equal(code, 0, out);
  assert.match(out, /1\.0\.120 is ready/);
  assert.match(out, /Load unpacked/);
  assert.equal(JSON.parse(await text(root, "manifest.json")).version, "1.0.120");
  assert.equal(await text(root, "app/prism.js"), "render();\n");
  assert.ok(existsSync(path.join(root, "update.cmd")));
  assert.ok(existsSync(path.join(root, "INSTALL.txt")));
  await rm(root, { recursive: true, force: true });
  await rm(path.dirname(archive), { recursive: true, force: true });
});

test("install from a mocked GitHub release zip", windows, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cl-install-"));
  const bytes = zip(Object.entries(FILES).map(([name, data]) => ({ name, data: Buffer.from(data) })));
  const github = await fakeRelease(bytes);
  const { code, out } = await run(root, null, ...github.args);
  await github.close();
  assert.equal(code, 0, out);
  assert.equal(JSON.parse(await text(root, "manifest.json")).name, "Kivori SekAI");
  assert.equal(github.hits[0], "/repos/Phoniix/crunchilist/releases/latest");
  await rm(root, { recursive: true, force: true });
});

test("a git checkout install target is refused", windows, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cl-install-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/master");
  const archive = await zipOf(FILES);
  const { code, out } = await run(root, archive);
  assert.equal(code, 1, out);
  assert.match(out, /git checkout/);
  await rm(root, { recursive: true, force: true });
  await rm(path.dirname(archive), { recursive: true, force: true });
});
