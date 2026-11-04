// Toolbar badge text/color from background activity tasks.
// Site-bound tasks carry service: "<id>"; Import all / matching use "all"; AniList/model use "global".
import { SERVICE_BRAND } from "./play-url.js";

export const MASTER_BADGE = "#ff7a2f";

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

function taskWeight(task) {
  const total = Number(task?.total);
  if (Number.isFinite(total) && total > 0) return total;
  return 1;
}

function taskProgress(task) {
  if (Number.isFinite(task?.progress)) return clamp01(task.progress);
  const done = Number(task?.done);
  const total = Number(task?.total);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(done)) return clamp01(done / total);
  return 0;
}

function weightedPercent(tasks) {
  let weight = 0;
  let sum = 0;
  for (const task of tasks) {
    const w = taskWeight(task);
    weight += w;
    sum += taskProgress(task) * w;
  }
  if (!weight) return 0;
  return Math.min(99, Math.floor((sum / weight) * 100));
}

function badgeText(percent) {
  const n = Math.max(0, Math.min(99, Math.floor(Number(percent) || 0)));
  return `${n}%`;
}

/** @returns {{ text: string, color: string, title: string } | null} null when idle (caller handles OFF/preview). */
export function badgeForTasks(tasks) {
  const list = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
  if (!list.length) return null;

  const title = list.map((task) => `${task.label || "Working"}: ${Math.floor(taskProgress(task) * 100)}%`).join("\n");
  const sites = [...new Set(list.map((task) => task.service).filter((id) => id && id !== "all" && id !== "global"))];
  const hasAll = list.some((task) => task.service === "all");

  if (hasAll || sites.length > 1) {
    return { text: badgeText(weightedPercent(list)), color: MASTER_BADGE, title };
  }
  if (sites.length === 1) {
    const site = sites[0];
    const forSite = list.filter((task) => task.service === site || !task.service);
    return {
      text: badgeText(weightedPercent(forSite.length ? forSite : list)),
      color: SERVICE_BRAND[site] || MASTER_BADGE,
      title,
    };
  }
  return { text: badgeText(weightedPercent(list)), color: MASTER_BADGE, title };
}
