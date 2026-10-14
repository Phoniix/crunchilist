// Runs on netflix.com only after the user connects Netflix. Viewing activity and playback tracking come next.
chrome.runtime.sendMessage({ type: "serviceSeen", service: "netflix" }).catch(() => {});
