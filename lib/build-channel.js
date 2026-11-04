// Store zips set ks_channel on the packaged manifest. Unpacked/dev copies leave it unset.
export const STORE_CHANNEL = "store";
// Fixed ports only: app mockups (5178) and npm run lab (5391).
export const DEV_BRIDGE_PORTS = [5178, 5391];
export const DEV_BRIDGE_TOKEN = "kivori-lab-bridge";

export function isStoreChannel(manifest = globalThis.chrome?.runtime?.getManifest?.()) {
  return manifest?.ks_channel === STORE_CHANNEL;
}

export function allowsRemoteFeeds(manifest = globalThis.chrome?.runtime?.getManifest?.()) {
  if (isStoreChannel(manifest)) return false;
  return (manifest?.host_permissions || []).some((entry) => String(entry).includes("raw.githubusercontent.com"));
}

export function allowsDevBridge(manifest = globalThis.chrome?.runtime?.getManifest?.()) {
  return Boolean(manifest?.externally_connectable?.matches?.length) && !isStoreChannel(manifest);
}

export function isDevBridgeSender(url = "") {
  return new RegExp(`^http://(localhost|127\\.0\\.0\\.1):(${DEV_BRIDGE_PORTS.join("|")})/`).test(url);
}

export function devBridgeMatches() {
  return DEV_BRIDGE_PORTS.flatMap((port) => [`http://127.0.0.1:${port}/*`, `http://localhost:${port}/*`]);
}
