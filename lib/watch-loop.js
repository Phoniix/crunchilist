// The content-script half of tracking as you watch: checks the page's video every few seconds and, once most of
// a long enough video has played, asks the site's script what it was and tells the background.
// Nothing is changed on the site. Only the top page runs it, and each video is reported once per page.
import { FINISHED, MIN_SECONDS, parseEpisodeLabel } from "./watch-tracking.js";

const CHECK_MS = 5000;
export const START_SECONDS = 5;

// The main player: the longest video that's playing or was played, so ads, trailers and muted previews are ignored.
// Sites may pass a lower minSeconds (Netflix allows ~1‑minute specials; Tubi keeps the 5‑minute floor).
export function mainVideo(doc = document, { minSeconds = MIN_SECONDS } = {}) {
  const floor = Number(minSeconds) > 0 ? Number(minSeconds) : MIN_SECONDS;
  const videos = [...doc.querySelectorAll("video")].filter((video) => Number.isFinite(video.duration) && video.duration >= floor && video.played?.length);
  return videos.sort((a, b) => b.duration - a.duration)[0] || null;
}

// place(): an id for the page when it plays something trackable, else "". identify(place): what's playing, as
// { item } (see cleanItem in watch-tracking.js) or { miss: "what was seen" } when it can't be told.
// After ~startSeconds, sends watchedStart once; at FINISHED, sends watched once.
export function watchLoop(service, { place, identify, startSeconds = START_SECONDS } = {}) {
  if (window.top !== window) return;
  const started = new Set();
  const done = new Set();
  let checking = false;
  setInterval(async () => {
    const id = place();
    if (!id || checking) return;
    const video = mainVideo();
    if (!video) return;
    if (!started.has(id) && video.currentTime >= startSeconds) {
      started.add(id);
      checking = true;
      try {
        const found = await identify(id);
        chrome.runtime.sendMessage({ type: "watchedStart", service, ...(found?.item ? { item: found.item } : { miss: String(found?.miss || "").slice(0, 200) }) }).catch(() => {});
      } catch {
        chrome.runtime.sendMessage({ type: "watchedStart", service, miss: "the page couldn't be read" }).catch(() => {});
      } finally {
        checking = false;
      }
      return;
    }
    if (done.has(id) || video.currentTime / video.duration < FINISHED) return;
    checking = true;
    done.add(id);
    try {
      const found = await identify(id);
      chrome.runtime.sendMessage({ type: "watched", service, ...(found?.item ? { item: found.item } : { miss: String(found?.miss || "").slice(0, 200) }) }).catch(() => {});
    } catch {
      chrome.runtime.sendMessage({ type: "watched", service, miss: "the page couldn't be read" }).catch(() => {});
    } finally {
      checking = false;
    }
  }, CHECK_MS);
}

// Text from the page that might name the episode: the media session (what the system media controls show),
// the tab title, and headings or labels near the player.
export function pageLabels(doc = document) {
  const labels = [];
  const meta = navigator.mediaSession?.metadata;
  if (meta?.title) labels.push([meta.album || meta.artist || "", meta.title].filter(Boolean).join(" "), meta.title);
  labels.push(doc.title);
  for (const node of doc.querySelectorAll('h1, h2, h3, [class*="title" i], [class*="episode" i], [aria-label*="episode" i]')) {
    const value = (node.getAttribute("aria-label") || node.textContent || "").replace(/\s+/g, " ").trim();
    if (value && value.length < 200) labels.push(value);
    if (labels.length > 80) break;
  }
  return labels.filter(Boolean);
}

// The first label naming an episode; one without the show's name borrows `series`.
export function episodeFromLabels(labels, series = "") {
  let unnamed = null;
  for (const label of labels) {
    const found = parseEpisodeLabel(label);
    if (found?.series) return found;
    unnamed ||= found;
  }
  return unnamed && series ? { ...unnamed, series } : null;
}
