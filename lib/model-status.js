export function describeModelStatus({
  hasKey = false,
  modelName = "",
  remoteOk = null,
  remoteError = "",
  chromePresent = false,
  availability = "",
  availabilityError = false,
  downloading = false,
  progress = 0,
  stalled = false,
  chromeFailed = false,
} = {}) {
  if (hasKey) {
    const name = modelName || "Your API model";
    if (remoteOk === true) return { state: "online", label: "Online", detail: `${name} answered the last request.` };
    if (remoteOk === false) return { state: "unknown", label: "Error", detail: remoteError || `${name} failed on the last request.` };
    return { state: "unknown", label: "Unknown", detail: `${name} has not been asked yet.` };
  }
  if (!chromePresent) return { state: "unknown", label: "Unknown", detail: "This Chrome has no built-in model." };
  if (availabilityError) return { state: "unknown", label: "Error", detail: "Chrome could not report its model status." };
  if (availability === "available") {
    if (chromeFailed) return { state: "unknown", label: "Error", detail: "Chrome's model is downloaded but failed on the last request." };
    return { state: "online", label: "Online", detail: "Chrome's model is ready on this device." };
  }
  if (downloading) {
    const percent = Math.max(0, Math.min(99, Math.round((Number(progress) || 0) * 100)));
    return { state: "offline", label: "Offline", detail: `Downloading Chrome's model, ${percent}%.` };
  }
  if (stalled) return { state: "unknown", label: "Error", detail: "Chrome's model download is not moving. Chrome needs about 22 GB free and a supported device." };
  if (availability === "downloadable") return { state: "offline", label: "Offline", detail: "Chrome's model is not downloaded yet." };
  if (availability === "downloading") return { state: "offline", label: "Offline", detail: "Chrome reports its model is downloading." };
  if (availability === "unavailable") return { state: "offline", label: "Offline", detail: "Chrome's model is not supported on this device." };
  return { state: "unknown", label: "Unknown", detail: "Chrome's model status is unknown." };
}
