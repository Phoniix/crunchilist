import { seriesIdFromHref } from "../lib/page-model.js";

const BADGE_TEXT = {
  finished: "Watched",
  in_progress: "In progress",
  dropped: "Dropped",
  plan: "Plan",
  unwatched: "Unwatched",
};

const ROUNDED = '"Crunchilist Rounded", "Trebuchet MS", Candara, sans-serif';

function ensureBadgeFont(doc) {
  if (doc.getElementById("cr-corner-font")) return;
  let url = "";
  try {
    url = chrome.runtime.getURL("fonts/nunito-latin.woff2");
  } catch {
    return;
  }
  try {
    const style = doc.createElement("style");
    style.id = "cr-corner-font";
    style.textContent = `@font-face{font-family:"Crunchilist Rounded";src:url("${url}") format("woff2");font-weight:600 700;font-style:normal;font-display:swap;}`;
    (doc.head || doc.documentElement).append(style);
  } catch {
    // The page can refuse an injected style. The badge text still renders.
  }
}

function badgeStyle(mark) {
  const common = `display:inline-block;margin:0 6px 4px 0;padding:2px 8px;border-radius:999px;font:700 12px/1.35 ${ROUNDED};letter-spacing:.01em;vertical-align:middle;pointer-events:none;position:relative;z-index:1;`;
  if (mark === "finished") return `${common}background:#f47521;color:#1a0d05;`;
  if (mark === "in_progress") return `${common}background:#f5c16c;color:#1a0d05;`;
  if (mark === "dropped") return `${common}background:#5c3030;color:#ffd5d5;`;
  if (mark === "plan") return `${common}background:#24384a;color:#d7e8f8;`;
  return `${common}background:transparent;color:#d0d0d0;border:1px solid #8a8a8a;`;
}

function seriesIdsIn(element) {
  const ids = new Set();
  element.querySelectorAll('a[href*="/series/"]').forEach((anchor) => {
    const id = seriesIdFromHref(anchor.getAttribute("href") || "");
    if (id) ids.add(id);
  });
  return ids;
}

function cardRoot(anchor) {
  let node = anchor;
  for (let depth = 0; depth < 5 && node.parentElement && node.parentElement !== document.body; depth += 1) {
    const parent = node.parentElement;
    if (parent.closest("header, nav, footer")) break;
    if (seriesIdsIn(parent).size > 1) break;
    node = parent;
  }
  return node;
}

export function applyBadges(doc, marks, hideWatched) {
  ensureBadgeFont(doc);
  const used = new Set();
    doc.querySelectorAll('a[href*="/series/"]').forEach((anchor) => {
    try {
    if (anchor.closest("#cr-corner-host, header, nav, footer")) return;
    const seriesId = seriesIdFromHref(anchor.getAttribute("href") || "");
    if (!seriesId) return;
    const root = cardRoot(anchor);
    if (used.has(root)) return;
    used.add(root);
    const decision = marks?.[seriesId] || { mark: "unwatched", hide: false };
    const mark = decision.mark || "unwatched";
    let badge = [...root.children].find((child) => child.dataset?.crCornerBadge);
    if (!badge) {
      badge = doc.createElement("span");
      root.prepend(badge);
    }
    if (badge.dataset.crCornerBadge !== mark) {
      badge.dataset.crCornerBadge = mark;
      badge.textContent = BADGE_TEXT[mark] || BADGE_TEXT.unwatched;
      badge.style.cssText = badgeStyle(mark);
    }
    const shouldHide = Boolean(hideWatched && decision.hide);
    if (shouldHide && root.dataset.crCornerHidden !== "1") {
      root.dataset.crCornerPrevDisplay = root.style.display || "";
      root.dataset.crCornerHidden = "1";
      root.style.display = "none";
    } else if (!shouldHide && root.dataset.crCornerHidden === "1") {
      root.style.display = root.dataset.crCornerPrevDisplay || "";
      delete root.dataset.crCornerHidden;
      delete root.dataset.crCornerPrevDisplay;
    }
    } catch {
      // Skip a card the page will not let us mark.
    }
  });
  doc.querySelectorAll("[data-cr-corner-badge]").forEach((badge) => {
    if (!used.has(badge.parentElement)) badge.remove();
  });
}
