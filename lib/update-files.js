// Which repo files make up the extension, and how the updater checks them. Shared with scripts/package.mjs
// so the store zip and an in-place update always contain the same files.

import { STORE_CHANNEL } from "./build-channel.js";

// content/ is not listed: only the bundled scripts in contentFiles() ship (not content/main.js / content/sites/).
export const PACKAGE_FOLDERS = ["app", "background", "feeds", "fonts", "icons", "lib", "options", "popup", "tools", "ui"];
// Store builds omit the sideload updater (CWS bans self-update) and the tools/ folder that backs update.cmd.
export const STORE_PACKAGE_FOLDERS = PACKAGE_FOLDERS.filter((folder) => folder !== "tools");
// update.cmd / install.cmd run tools/*.ps1: manual install and update for sideload builds.
export const PACKAGE_ROOT_FILES = ["update.cmd", "install.cmd", "INSTALL.txt"];
export const STORE_PACKAGE_ROOT_FILES = [];
export const STORE_OMIT_FILES = ["app/updater.js"];
export const RAW_GITHUB_HOST = "https://raw.githubusercontent.com/Phoniix/crunchilist/*";
export const APP_NAME = "Kivori SekAI";

export function storeManifest(manifest) {
  const out = structuredClone(manifest);
  // The localhost bridge only serves the lab mockup; store builds must not expose it.
  delete out.externally_connectable;
  // Mark the channel so runtime can skip GitHub self-update and remote feed fetches.
  out.ks_channel = STORE_CHANNEL;
  // Sideload updater used this host; store installs ship packaged feeds/ only.
  out.host_permissions = (out.host_permissions || []).filter((entry) => entry !== RAW_GITHUB_HOST);
  return out;
}

/** Sideload / GitHub release zip: drop the lab bridge only; keep GitHub feeds and self-update. */
export function sideloadManifest(manifest) {
  const out = structuredClone(manifest);
  delete out.externally_connectable;
  delete out.ks_channel;
  return out;
}

/** Stub shipped in place of app/updater.js inside the store zip. */
export function storeUpdaterStub() {
  return `// Store builds update through the Chrome Web Store only.
export const canSelfUpdate = () => false;
export async function installUpdate() {
  throw new Error("Updates come from the Chrome Web Store.");
}
`;
}

export function contentFiles(manifest) {
  const fromManifest = (manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]);
  // Injected site scripts (not in content_scripts): bundled under content/site/ plus the light panel.
  const fromSites = [
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
  ];
  return [...new Set([...fromManifest, ...fromSites].filter(Boolean))];
}

const SAFE_PATH = /^[\w.-]+(?:\/[\w.-]+)*$/;

export function isPackagePath(file, manifest) {
  if (!SAFE_PATH.test(file) || file.split("/").some((part) => part === "." || part === "..")) return false;
  if (file === "manifest.json" || PACKAGE_ROOT_FILES.includes(file)) return true;
  if (contentFiles(manifest).includes(file)) return true;
  return PACKAGE_FOLDERS.some((folder) => file.startsWith(`${folder}/`)) && !file.endsWith(".test.js");
}

// GitHub's tree for one version, cut down to the files the extension ships.
export function packageFiles(tree, manifest) {
  return (tree || [])
    .filter((entry) => entry?.type === "blob" && /^[0-9a-f]{40}$/.test(entry.sha || "") && isPackagePath(entry.path, manifest))
    .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size || 0 }));
}

// Files the installed copy has that the new version dropped. Only package files are ever removed,
// so anything else in the folder (notes, a dev folder) is left alone.
export function staleFiles(localPaths, nextFiles, manifest) {
  const keep = new Set(nextFiles.map((file) => file.path));
  return localPaths.filter((file) => !keep.has(file) && file !== "manifest.json" && isPackagePath(file, manifest));
}

// Git's own fingerprint of a file: SHA-1 of "blob <size>\0" followed by the bytes, as listed in the tree.
export async function gitBlobSha(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = new TextEncoder().encode(`blob ${data.length}\0`);
  const all = new Uint8Array(head.length + data.length);
  all.set(head);
  all.set(data, head.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Git on Windows checks files out with CRLF while GitHub stores LF, so a zip built on Windows differs from
// GitHub byte for byte. The LF form is what to compare; null when there is no CR to drop.
export function withoutCarriageReturns(bytes) {
  if (!bytes?.includes(13)) return null;
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) continue;
    out[length] = bytes[index];
    length += 1;
  }
  return out.slice(0, length);
}

// Whether the installed file already holds this version of it, whichever line endings it was checked out with.
export async function sameAsGitHub(bytes, sha) {
  if (!bytes) return false;
  if ((await gitBlobSha(bytes)) === sha) return true;
  const lf = withoutCarriageReturns(bytes);
  return Boolean(lf) && (await gitBlobSha(lf)) === sha;
}

export function rawUrl(repo, ref, file) {
  return `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}
