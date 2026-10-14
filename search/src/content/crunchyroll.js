// Runs on crunchyroll.com only after the user connects Crunchyroll. History reading and playback tracking come next.
chrome.runtime.sendMessage({ type: "serviceSeen", service: "crunchyroll" }).catch(() => {});
