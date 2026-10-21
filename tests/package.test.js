import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { contentFiles, localRefs, storeManifest } from "../scripts/package.mjs";
import { SERVICES, contentScriptsFor } from "../lib/services.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("store manifest drops the localhost dev bridge and keeps everything else", () => {
  const out = storeManifest(manifest);
  assert.equal(out.externally_connectable, undefined);
  assert.ok(manifest.externally_connectable, "the source manifest is not modified");
  assert.deepEqual(out.permissions, manifest.permissions);
  assert.deepEqual(out.host_permissions, manifest.host_permissions);
  assert.deepEqual(out.optional_host_permissions, manifest.optional_host_permissions);
});

test("package ships manifest content scripts plus injected site scripts", () => {
  assert.deepEqual(contentFiles(manifest), [
    "content/page-hook.js",
    "content/crunchilist.js",
    "content/crunchilist-frame.js",
    "content/site-panel.js",
    "content/site/key-guard.js",
    "content/site/return.js",
    "content/site/crunchyroll.js",
    "content/site/crunchyroll-page.js",
    "content/site/netflix.js",
    "content/site/netflix-page.js",
    "content/site/prime.js",
    "content/site/hidive.js",
    "content/site/hidive-page.js",
    "content/site/tubi.js",
    "content/site/tubi-page.js",
  ]);
  assert.equal(contentFiles(manifest).includes("content/main.js"), false);
  assert.equal(contentFiles(manifest).includes("content/sites/netflix.js"), false);
});

test("every injected site script is packaged and present on disk", () => {
  const shipped = new Set(contentFiles(manifest));
  for (const service of SERVICES.filter((row) => row.scripts?.length || row.imports || row.tracks)) {
    for (const file of contentScriptsFor(service).flatMap((entry) => entry.js || [])) {
      assert.ok(shipped.has(file), `${service.id} injects ${file} but contentFiles omits it`);
      assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
    }
  }
});

test("local references are found in scripts, pages and styles", () => {
  assert.deepEqual(
    localRefs("a.js", 'import { x } from "./x.js";\nimport "../y.js";\nexport { z } from "./z.js";\nconst m = import("./lazy.js");\nimport fs from "node:fs";'),
    ["./x.js", "../y.js", "./z.js", "./lazy.js"],
  );
  assert.deepEqual(
    localRefs("a.html", '<link href="prism.css"><script src="app.js?v=1"></script><a href="https://anilist.co">x</a><a href="#top">y</a>'),
    ["prism.css", "app.js"],
  );
  assert.deepEqual(localRefs("a.css", 'src: url("../fonts/inter.woff2"); background: url(data:image/png;base64,AA)'), ["../fonts/inter.woff2"]);
  assert.deepEqual(localRefs("a.png", "import x from './x.js'"), []);
});

test("app pages link to files that exist", () => {
  for (const page of ["app/app.html", "app/privacy.html"]) {
    const file = path.join(root, page);
    for (const ref of localRefs(file, fs.readFileSync(file, "utf8"))) {
      assert.equal(fs.existsSync(path.resolve(path.dirname(file), ref)), true, `${page} -> ${ref}`);
    }
  }
});

test("import pane, Kivi portrait, and title feeds ship with the package", () => {
  for (const file of [
    "app/import-pane.js",
    "icons/kivi.png",
    "feeds/id-map.json",
    "feeds/id-map-meta.json",
    "feeds/where-map.json",
    "feeds/where-map-meta.json",
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
  }
  const prism = fs.readFileSync(path.join(root, "app/prism.js"), "utf8");
  assert.match(prism, /import-pane\.js/);
  assert.match(prism, /icons\/kivi\.png/);
});
