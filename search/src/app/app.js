import { CHARACTERS, linePreview } from "../lib/characters.js";
import { CREDITS } from "../lib/id-map.js";
import { KEYS } from "../lib/keys.js";
import { LIST_SOURCES } from "../lib/list-import.js";
import { LISTING_SITES, SERVICES, serviceById } from "../lib/services.js";
import * as prism from "./prism.js";

const main = document.getElementById("main");
const toastBox = document.querySelector(".toast");
let state = { version: "", connected: [], anilist: { connected: false }, idMap: {} };
let connecting = false;
let checkingFeeds = false;
let toastTimer = 0;
let imp = null;
let skip = new Set();
let pollTimer = 0;
let busy = false;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function toast(text) {
  toastBox.textContent = text;
  toastBox.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.remove("show"), 4000);
}

async function send(type, extra = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...extra });
  } catch (error) {
    return { ok: false, error: error?.message || "The extension didn't answer" };
  }
}

function anilistRow() {
  const { connected, expired, name, avatar, renewSoon } = state.anilist || {};
  const note = connected
    ? `Signed in as ${name || "your AniList account"}.${renewSoon ? " AniList asks you to sign in again soon." : ""} Your list stays in sync from here.`
    : expired ? "Your AniList sign-in expired. Connect again to keep your list in sync." : "Sign in with AniList so imports and what you watch update your list.";
  return `<div class="panel line">
    ${connected && avatar ? `<img class="avatar" src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : ""}
    <div class="grow"><b>AniList</b><small>${esc(note)}</small></div>
    <span class="pill${connected ? " on" : ""}">${connected ? "Connected" : expired ? "Expired" : "Not connected"}</span>
    <button class="btn${connected ? "" : " accent"}" data-act="${connected ? "anilist-disconnect" : "anilist-connect"}" ${connecting ? "disabled" : ""}>${connected ? "Disconnect" : connecting ? "Opening AniList…" : "Connect"}</button>
  </div>`;
}

function malRow() {
  const mal = state.mal || {};
  const configured = Boolean(mal.configured);
  const connected = Boolean(mal.connected);
  const note = !configured
    ? "Create a public API client at myanimelist.net/apiconfig. Redirect URI must be the value shown below (chrome.identity)."
    : connected
      ? `Signed in as ${mal.name || "your MyAnimeList account"}.${mal.renewSoon ? " Sign in again soon." : ""} Weekly pull and tracking write to MAL when Write to MyAnimeList is on.`
      : mal.expired ? "Your MyAnimeList sign-in expired. Connect again." : "Sign in with MyAnimeList for weekly library pull and dual tracking with AniList.";
  const redirect = typeof chrome?.identity?.getRedirectURL === "function" ? chrome.identity.getRedirectURL() : "https://<extension-id>.chromiumapp.org/";
  return `<div class="panel stack">
    <div class="line">
      <div class="grow"><b>MyAnimeList</b><small>${esc(note)}</small></div>
      <span class="pill${connected ? " on" : ""}">${connected ? "Connected" : mal.expired ? "Expired" : configured ? "Not connected" : "Needs client id"}</span>
      ${configured ? `<button class="btn${connected ? "" : " accent"}" data-act="${connected ? "mal-disconnect" : "mal-connect"}" ${connecting ? "disabled" : ""}>${connected ? "Disconnect" : connecting ? "Opening MyAnimeList…" : "Connect"}</button>` : ""}
      ${connected ? `<button class="btn" data-act="mal-pull" ${busy ? "disabled" : ""}>Pull now</button>` : ""}
    </div>
    <label class="field-row"><span>API client id</span>
      <input class="field" id="mal-client-id" type="text" autocomplete="off" spellcheck="false" placeholder="From myanimelist.net/apiconfig" value="">
      <button class="btn" data-act="mal-client-save">Save</button></label>
    <small class="hint">Redirect URI for the MAL app: <code>${esc(redirect)}</code></small>
  </div>`;
}

function kitsuRow() {
  const kitsu = state.kitsu || {};
  const connected = Boolean(kitsu.connected);
  const note = connected
    ? `Linked as ${kitsu.username}.${kitsu.lastPull ? ` Last pulled ${when(kitsu.lastPull)}.` : ""} Weekly pull only — progress is not written back to Kitsu.`
    : "Save your Kitsu username for a weekly library pull into AniList. No write-back yet.";
  return `<div class="panel stack">
    <div class="line">
      <div class="grow"><b>Kitsu</b><small>${esc(note)}</small></div>
      <span class="pill${connected ? " on" : ""}">${connected ? "Linked" : "Not linked"}</span>
      ${connected ? `<button class="btn" data-act="kitsu-disconnect">Unlink</button>
        <button class="btn" data-act="kitsu-pull" ${busy ? "disabled" : ""}>Pull now</button>` : ""}
    </div>
    ${connected ? "" : `<label class="field-row"><span>Username</span>
      <input class="field" id="kitsu-link-name" type="text" autocomplete="username" spellcheck="false" placeholder="kitsu.app/users/NAME">
      <button class="btn accent" data-act="kitsu-link">Link</button></label>`}
  </div>`;
}

function trackerRows() {
  const pullNote = state.sync?.trackerPullResult ? `<small class="hint">${esc(state.sync.trackerPullResult)}</small>` : "";
  return `${anilistRow()}${malRow()}${kitsuRow()}
    <div class="panel">
      ${settingSwitch("weeklyTrackerPull", "Weekly tracker pull", "About once a week, pull connected MyAnimeList and Kitsu libraries into an Import preview for AniList. AniList is already your home list.")}
      ${settingSwitch("writeMal", "Write to MyAnimeList", "When you apply imports or edit your list, also update MyAnimeList if it's connected. Never lowers progress.")}
      ${pullNote}
      ${(state.mal?.connected || state.kitsu?.connected) ? `<button class="btn" data-act="tracker-pull" ${busy ? "disabled" : ""}>Pull trackers now</button>` : ""}
    </div>`;
}

// An untested site can still be disconnected if it was connected before, but nothing else.
const connectButton = (service, on) => (service.untested && !on ? '<button class="btn" disabled>Connect</button>'
  : `<button class="btn${on ? "" : " accent"}" data-service="${esc(service.id)}" data-act="${on ? "disconnect" : "connect"}">${on ? "Disconnect" : "Connect"}</button>`);
const openButton = (service) => (service.untested ? `<button class="btn" disabled>Open ${esc(service.name)}</button>`
  : `<a class="btn" href="${esc(service.home)}" target="_blank" rel="noopener">Open ${esc(service.name)}</a>`);

const accountHint = (service) => (service.untested ? `${service.name} can't be tested yet, so it's switched off for now.`
  : service.tracks ? `${service.name} keeps no history to import, so episodes are noted as you finish them once tracking is on in Import, under Automatic updates.`
    : service.imports ? "" : "History import for this site is coming soon.");

function serviceRows() {
  return SERVICES.map((service) => {
    const on = state.connected.includes(service.id);
    return `<div class="panel line${service.untested ? " off" : ""}">
      <div class="grow"><b>${esc(service.name)}</b><small>${esc(service.why)}</small>${accountHint(service) ? `<small class="hint">${esc(accountHint(service))}</small>` : ""}</div>
      <span class="pill${on ? " on" : ""}">${on ? "Connected" : "Not connected"}</span>
      ${openButton(service)}${connectButton(service, on)}
    </div>`;
  }).join("");
}

// Where-to-watch switches: a site switched off disappears from links and Watch buttons, connected or not.
function listingRows() {
  const hidden = new Set((state.settings?.hiddenSites || []).map((site) => site.toLowerCase()));
  return LISTING_SITES.map(({ site, service }) => {
    const connected = service && state.connected.includes(service);
    const on = !hidden.has(site.toLowerCase());
    return `<div class="set-row"><div class="grow"><b>${esc(site)}</b><small>${connected ? "Connected · " : ""}${on ? "Shown in where-to-watch" : `Hidden from where-to-watch${connected ? " and On my services" : ""}`}</small></div>
      <button class="switch${on ? " on" : ""}" role="switch" aria-checked="${on}" aria-label="Show ${esc(site)}" data-listing="${esc(site)}"></button></div>`;
  }).join("");
}

// What each connected service carries, read from its own catalog so show pages and Browse know what's watchable.
const CATALOG_SITES = ["crunchyroll", "hidive", "tubi", "netflix"];
let readingCatalog = "";
function catalogRows() {
  const settings = state.settings || {};
  const rows = CATALOG_SITES.map((id) => {
    const name = serviceById(id).name;
    const item = state.catalogs?.[id];
    const connected = state.connected.includes(id);
    const rate = item?.matchRate != null ? ` (${Math.round(item.matchRate * 1000) / 10}% matched)` : "";
    const note = !connected ? `Connect ${name} first.`
      : item?.at ? `${item.titles.toLocaleString()} titles, ${item.matched.toLocaleString()} matched to AniList${rate}. Read ${day(item.at)}.${item.error ? ` Last try: ${item.error}` : ""}${id === "crunchyroll" ? " Crunchyroll browse isn’t anime-only, so the match % can look low." : ""}`
      : item?.error ? `Not read yet: ${item.error}` : `Not read yet. It's read the next time ${name} is open in a tab${id === "crunchyroll" ? " while you're signed in" : ""}.`;
    const busyHere = readingCatalog === id || readingCatalog === "all";
    return `<div class="set-row${connected ? "" : " off"}"><div class="grow"><b>${esc(name)}</b><small>${esc(note)}</small></div>
      ${connected ? `<button class="btn sm" data-act="catalog-read" data-catalog="${id}" ${readingCatalog ? "disabled" : ""}>${busyHere ? "Reading…" : "Read now"}</button>` : ""}</div>`;
  }).join("");
  return `<div class="panel">
    ${settingSwitch("readCatalogs", "Read what your services carry", "About once a week, while Crunchyroll, HIDIVE, Tubi or Netflix is open in a tab, its catalog is paged and matched to AniList (Netflix: Anime Series and Anime Movies). Prime Video and Hulu use a where-to-watch map; dead links are dropped. Show pages then link what you can watch, and Home and Browse can keep to shows on your services. Nothing is changed on the sites.")}
    ${settings.readCatalogs ? rows : ""}
  </div>`;
}

function characterSection() {
  const picked = state.favorite?.id || "";
  const cards = CHARACTERS.map((c) => {
    const on = picked === c.id;
    const preview = linePreview(c.id);
    return `<button type="button" class="char-card${on ? " on" : ""}" data-act="fav-char" data-id="${esc(c.id)}" aria-pressed="${on}">
      <b>${esc(c.name)}</b><small>${esc(c.show)}</small>
      <span class="char-tone">${esc(c.tone)}</span>
      <q>${esc(preview.welcome.text)}</q>
    </button>`;
  }).join("");
  const live = state.lines;
  const samples = live ? `<div class="char-samples">
      <div><span>Welcome back</span><p>${esc(live.welcome?.text || "")}</p></div>
      <div><span>Look here</span><p>${esc(live.look_here?.text || "")}</p></div>
      <div><span>Guide tip</span><p>${esc(live.tip?.text || "")}</p></div>
    </div>` : `<p class="muted">Pick a character for welcome-back, look-here, and tip text. Lines rotate by day; AI can paraphrase them later from the same banks — still text only.</p>`;
  return `<div class="stack">
    <div class="char-grid">${cards}</div>
    ${picked ? `<button class="btn" data-act="fav-char" data-id="">Clear favorite</button>` : ""}
    ${samples}
  </div>`;
}

function dataRow() {
  const { count = 0, updated = "", error = "" } = state.idMap || {};
  const where = state.whereMap || {};
  const note = count
    ? `${count.toLocaleString()} anime, updated ${updated}.${error ? ` Last check: ${error}` : ""}`
    : error ? `Not downloaded yet: ${error}` : "Downloading the list of anime used for search and matching…";
  const whereNote = where.count
    ? `${where.count.toLocaleString()} popular Netflix/Prime/Hulu links (${where.source || "feed"}, partial gap fill — not a full catalog), updated ${where.updated || "—"}.${where.error ? ` Last check: ${where.error}` : ""}`
    : where.error ? `Gap map not loaded: ${where.error}` : "Gap map for Netflix, Prime Video and Hulu loads with the feeds.";
  const ready = state.title;
  const readyNote = ready
    ? `Match ${ready.canMatch ? "ready" : "waiting"}; availability ${ready.canShowAvailability ? "ready" : "waiting"}.${ready.catalogsRead?.length ? ` Catalogs: ${ready.catalogsRead.join(", ")}.` : ""}`
    : "";
  return `<div class="stack">
    <div class="panel line">
      <div class="grow"><b>Master list</b><small>${esc(note)}</small></div>
      <button class="btn" data-act="refresh-feeds" ${checkingFeeds ? "disabled" : ""}>${checkingFeeds ? "Checking…" : "Check now"}</button>
    </div>
    <div class="panel line"><div class="grow"><b>Where-to-watch gap map</b><small>${esc(whereNote)}</small></div></div>
    ${readyNote ? `<div class="panel line"><div class="grow"><b>Title layer</b><small>${esc(readyNote)}</small></div></div>` : ""}
  </div>`;
}

const STATUS = { CURRENT: "Watching", COMPLETED: "Completed", PLANNING: "Planning", PAUSED: "Paused", DROPPED: "Dropped", REPEATING: "Rewatching" };
const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const day = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");

function entryText(entry, total) {
  if (!entry?.status) return "Not on your list";
  return `${STATUS[entry.status] || entry.status} · ${entry.progress || 0}${total ? ` of ${total}` : ""}`;
}

const share = (done, total) => (total ? Math.min(1, Math.max(0, done / total)) : 0);

// Import all: reading the sites is most of the work, then matching and checking AniList.
function overallPercent(job) {
  if (job.phase === "matching") return 82 + share(job.done, job.total) * 6;
  if (job.phase === "anilist") return 88 + share(job.done, job.total) * 12;
  const finished = job.sites.filter((site) => site.state === "done" || site.state === "skipped").length;
  const current = job.sites.some((site) => site.state === "reading") ? (job.total ? share(job.done, job.total) : 0.4) : 0;
  return ((finished + current) / job.sites.length) * 80;
}

function siteBar(site, job) {
  const reading = site.state === "reading" && job.phase === "reading";
  const known = reading && job.total;
  const width = site.state === "done" || site.state === "skipped" ? 100 : known ? Math.round(share(job.done, job.total) * 100) : 0;
  const text = site.state === "waiting" ? "Waiting"
    : site.state === "skipped" ? `Skipped: ${site.note}`
      : site.state === "done" ? (site.seen ? `${site.seen.toLocaleString()} new · ${site.found.toLocaleString()} to match` : "Nothing new")
        : reading ? `${(job.done || 0).toLocaleString()}${job.total ? ` of ${job.total.toLocaleString()}` : ""} entries` : "Read";
  return `<div class="site-bar ${site.state}"><b>${esc(site.name)}</b>
    <div class="bar"><span style="width:${reading && !known ? 30 : width}%" class="${reading && !known ? "spin" : ""}"></span></div>
    <small title="${esc(text)}">${esc(text)}</small></div>`;
}

function jobCard(job) {
  if (job.sites?.length) {
    const overall = Math.round(overallPercent(job));
    return `<div class="panel">
      <div class="line"><div class="grow"><b>${esc(job.note || "Working…")}</b><small>${esc(TRIGGERS[job.trigger] || "Import all")} · ${overall}% overall</small></div>
        ${job.phase === "reading" ? `<button class="btn" data-act="import-cancel">Stop</button>` : ""}</div>
      <div class="bar master"><span style="width:${overall}%"></span></div>
      <div class="site-bars">${job.sites.map((site) => siteBar(site, job)).join("")}</div>
    </div>`;
  }
  const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  return `<div class="panel">
    <div class="line"><div class="grow"><b>${esc(job.note || "Working…")}</b>
      ${job.total ? `<small>${job.done.toLocaleString()} of ${job.total.toLocaleString()}</small>` : ""}</div>
      ${job.phase === "reading" || job.phase === "saving" ? `<button class="btn" data-act="import-cancel">Stop</button>` : ""}</div>
    <div class="bar"><span style="width:${job.total ? pct : 30}%" class="${job.total ? "" : "spin"}"></span></div>
  </div>`;
}

const HOW = {
  crunchyroll: "Keep a Crunchyroll tab open and signed in while importing.",
  netflix: "Imports the profile open in your Netflix tab; switch profiles on Netflix and import again for each one. No connection needed for the file from netflix.com/viewingactivity (Download all).",
  prime: "Imports the profile open in your Prime Video tab; switch profiles there and import again for each one.",
  hidive: "Imports the profile open in your HIDIVE tab; switch profiles there and import again for each one. Only episodes HIDIVE shows as mostly watched count.",
};

function pointText(point) {
  const who = point.label ? `${point.label}: ` : "";
  return `${who}imported up to ${when(point.newestAt)}.${point.end ? ` All history read, back to ${day(point.oldestAt)}.` : point.resume ? " Older history is still to read; the next import continues it." : ""}`;
}

function lockReason() {
  if (imp?.job?.running) return "Wait for the current step to finish, or stop it above.";
  if (imp?.preview) return `Apply or dismiss the ${sourceName(imp.preview.service)} preview above first.`;
  return "";
}

// Past imports can still name a site that was removed.
const OLD_SOURCES = { youtube: "YouTube", retrocrush: "RetroCrush" };
const sourceName = (id) => (id === "all" ? "All sites" : serviceById(id)?.name || LIST_SOURCES[id]?.name || OLD_SOURCES[id] || id);
const isList = (id) => Boolean(LIST_SOURCES[id]);

function serviceImportRows() {
  const locked = imp?.job?.running || Boolean(imp?.preview) || busy;
  const why = lockReason();
  const ready = new URLSearchParams(parseHash().query).get("ready");
  return SERVICES.map((service) => {
    const on = state.connected.includes(service.id);
    const hot = ready === service.id && !locked ? " pulse" : "";
    const points = imp?.checkpoints?.[service.id] || [];
    const status = service.untested ? accountHint(service)
      : service.tracks ? `${service.name} keeps no watch history to import. Turn on tracking under Automatic updates below and episodes are noted as you finish them.${on ? "" : " Connect it first."}`
      : !service.imports ? `History import from ${service.name} is coming soon.${on ? "" : " Connecting now gets it ready."}`
      : !on ? `Not connected. Connect it to import from the site${service.file ? ", or upload a file" : ""}.`
        : points.length ? points.map(pointText).join(" ") : "Not imported yet. The first import reads your whole history, which can take a few minutes.";
    return `<div class="panel${ready === service.id ? " ready" : ""}${service.untested ? " off" : ""}" data-row="${esc(service.id)}">
      <div class="line">
        <div class="grow"><b>${esc(service.name)}</b><small>${esc(status)}</small>${HOW[service.id] ? `<small class="hint">${esc(HOW[service.id])}</small>` : ""}</div>
        <span class="pill${on ? " on" : ""}">${on ? "Connected" : "Not connected"}</span>
      </div>
      <div class="line actions">
        ${openButton(service)}
        ${service.id === "netflix" ? `<label class="btn${locked ? " disabled" : ""}">Upload file<input type="file" accept=".csv,text/csv" data-act="netflix-csv" hidden ${locked ? "disabled" : ""}></label>` : ""}
        <span class="grow"></span>
        ${on ? "" : connectButton(service, on)}
        ${service.untested ? '<button class="btn" disabled>Not available yet</button>'
          : service.tracks ? '<button class="btn" disabled>Tracks as you watch</button>'
          : !service.imports ? '<button class="btn" disabled>Import coming soon</button>'
          : on ? `<button class="btn" data-act="import-start" data-full="1" data-svc="${esc(service.id)}" ${locked ? "disabled" : ""} title="Reads everything again from the newest entry">Full rescan</button>
        <button class="btn accent${hot}" data-act="import-start" data-svc="${esc(service.id)}" ${locked ? "disabled" : ""}>Import history</button>` : ""}
      </div>
      ${why && service.imports ? `<small class="lock muted">${esc(why)}</small>` : ""}
      ${pastFold(service.id)}
    </div>`;
  }).join("");
}

// Lists kept on other trackers: brought over once, never lowering anything already on AniList.
function listImportRows() {
  const locked = imp?.job?.running || Boolean(imp?.preview) || busy;
  const why = lockReason();
  return `<div class="panel">
      <div class="line"><div class="grow"><b>MyAnimeList</b><small>Upload the file from MyAnimeList's Export page (Anime list). The .gz download works as it is.</small></div></div>
      <div class="line actions">
        <a class="btn" href="${esc(LIST_SOURCES.mal.exportUrl)}" target="_blank" rel="noopener">Open MyAnimeList export</a>
        <span class="grow"></span>
        <label class="btn accent${locked ? " disabled" : ""}">Upload list file<input type="file" accept=".xml,.gz,application/xml,text/xml,application/gzip" data-act="mal-file" hidden ${locked ? "disabled" : ""}></label>
      </div>
      ${why ? `<small class="lock muted">${esc(why)}</small>` : ""}
      ${pastFold("mal")}
    </div>
    <div class="panel">
      <div class="line"><div class="grow"><b>Kitsu</b><small>Reads a public Kitsu library by username. Chrome asks once to allow kitsu.app.</small></div></div>
      <div class="line actions">
        <a class="btn" href="${esc(LIST_SOURCES.kitsu.home)}" target="_blank" rel="noopener">Open Kitsu</a>
        <input class="field" id="kitsu-name" placeholder="Kitsu username" aria-label="Kitsu username" ${locked ? "disabled" : ""}>
        <button class="btn accent" data-act="kitsu-import" ${locked ? "disabled" : ""}>Import from Kitsu</button>
      </div>
      ${why ? `<small class="lock muted">${esc(why)}</small>` : ""}
      ${pastFold("kitsu")}
    </div>`;
}

function missedList(names = [], service = "netflix") {
  if (!names.length) return "";
  return `<p class="hint-note"><b>${sourceName(service)} calls ${names.length === 1 ? "this" : `these ${names.length}`} anime, but found no AniList match:</b> ${esc(names.join(" · "))}</p>`;
}

function droppedList(preview) {
  const names = preview.droppedNames || [];
  if (!names.length && !preview.animeMissed?.length) return "";
  if (isList(preview.service)) return `<details class="dropped"><summary>${names.length.toLocaleString()} show${names.length === 1 ? "" : "s"} not found on AniList</summary><p>${esc(names.join(" · "))}</p></details>`;
  return `${missedList(preview.animeMissed, preview.service)}${names.length ? `<details class="dropped"><summary>${names.length.toLocaleString()} title${names.length === 1 ? "" : "s"} skipped as not anime</summary>
    <p class="muted small">Only titles that clearly match an anime are kept. Look here for any anime skipped by mistake.</p><p>${esc(names.join(" · "))}</p></details>` : ""}`;
}

function previewCard(preview) {
  const { changes = [], notes = [] } = preview;
  const stats = preview.stats || {};
  const chosen = changes.filter((change) => !skip.has(change.anilistId)).length;
  const running = imp?.job?.running || busy;
  const summary = !preview.stats ? "From the shows you picked."
    : isList(preview.service) ? `${(stats.entries || 0).toLocaleString()} shows on your ${sourceName(preview.service)} list. ${(stats.unchanged || 0).toLocaleString()} already up to date${stats.dropped ? `, ${stats.dropped.toLocaleString()} not found on AniList` : ""}.`
      : `${(stats.entries || 0).toLocaleString()} new history entries, ${(stats.seasons || 0).toLocaleString()} seasons. ${(stats.unchanged || 0).toLocaleString()} already up to date${stats.pending ? `, ${stats.pending} need your pick` : ""}${stats.dropped ? `, ${stats.dropped.toLocaleString()} not anime (skipped)` : ""}.`;
  if (!changes.length) {
    return `<div class="panel"><div class="line"><div class="grow"><b>Nothing to change on AniList</b><small>${esc(summary)} Your AniList already matches this history.</small></div>
      <button class="btn accent" data-act="import-close" ${running ? "disabled" : ""}>Close</button></div>${droppedList(preview)}</div>`;
  }
  const list = changes.map((change) => `<label class="change">
      <input type="checkbox" data-pick="${change.anilistId}" ${skip.has(change.anilistId) ? "" : "checked"}>
      <span class="grow"><b>${esc(change.title || `AniList ${change.anilistId}`)}</b>
        <small>${esc(entryText(change.before, change.episodes))} → ${esc(entryText(change.after, change.episodes))}</small>
        ${change.from?.length ? `<small class="from">From ${esc(change.from.join("; "))}</small>` : ""}
        ${(change.notes || []).map((note) => `<small class="hint-note">${esc(note)}</small>`).join("")}</span>
      <a class="small-link" href="https://anilist.co/anime/${change.anilistId}" target="_blank" rel="noopener">AniList</a>
    </label>`).join("");
  return `<div class="panel">
    <div class="line"><div class="grow"><b>${preview.trigger ? `${esc(TRIGGERS[preview.trigger] || "Sync")} found updates` : "Ready to update AniList"}</b>
      <small>${esc(summary)}</small></div>
      <button class="btn" data-act="import-dismiss" ${running ? "disabled" : ""} title="Keeps your AniList as it is; the next import starts after this one">Dismiss</button>
      <button class="btn accent" data-act="import-apply" ${running || !chosen ? "disabled" : ""}>Apply ${chosen} change${chosen === 1 ? "" : "s"}</button></div>
    ${notes.map((note) => `<p class="hint-note">${esc(note)}</p>`).join("")}
    ${droppedList(preview)}
    <div class="line tools"><button class="link" data-act="pick-all">Select all</button><button class="link" data-act="pick-none">Select none</button></div><div class="changes">${list}</div>
  </div>`;
}

function pendingCard() {
  const items = imp?.pending || [];
  if (!items.length) return "";
  return importGroup(
    "Needs your pick",
    "History import found these titles but wasn’t sure which AniList show they are. Until you choose, their episodes stay out of AniList. Your pick is remembered for next time. Tap a suggested title, paste an AniList link and Confirm link, or Skip for now (site history stays).",
    `<div class="stack">${items.map((item) => {
      const site = item.service ? sourceName(item.service) : "your service";
      const fromSite = `${item.series}${item.season && item.season !== item.series ? ` — ${item.season}` : ""}`;
      return `<div class="panel pending" data-key="${esc(item.key)}">
      <p class="muted" style="margin:0;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase">From ${esc(site)}</p>
      <b>${esc(fromSite)}</b>
      <small class="muted">${item.episodes} episode${item.episodes === 1 ? "" : "s"} waiting. ${esc(item.reason || "Couldn’t match this name for sure.")}</small>
      ${item.candidates.length ? `<p class="muted" style="margin:8px 0 0;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase">Suggested AniList titles — tap the one you watched</p>
        <div class="choices">${item.candidates.map((candidate) => `<button class="choice" type="button" data-act="pending-pick" data-id="${candidate.anilistId}">
        <b>${esc(candidate.english || candidate.title)}</b><small>${esc([candidate.english && candidate.title && candidate.english !== candidate.title ? candidate.title : "", candidate.format, candidate.year, candidate.episodes ? `${candidate.episodes} eps` : ""].filter(Boolean).join(" · "))}</small></button>`).join("")}</div>` : `<p class="muted">No close AniList suggestion — paste a link below, or skip</p>`}
      <p class="muted" style="margin:8px 0 0;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase">Or paste an AniList anime link / id</p>
      <div class="line manual"><input class="field" placeholder="https://anilist.co/anime/…" aria-label="AniList anime link or id">
        <button class="btn" data-act="pending-manual">Confirm link</button><button class="btn" data-act="pending-skip">Skip for now</button></div>
    </div>`;
    }).join("")}</div>`,
    imp.pendingCount || items.length,
  );
}

// One past import. inSite: shown under its own site, so the site's name is left out.
function logItem(item, { inSite = false } = {}) {
  const running = imp?.job?.running || busy;
  const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
  const outcome = (item) => item.outcome === "dismissed" ? `Dismissed; ${plural(item.offered || 0, "change")} not sent.`
    : item.outcome === "nothing" ? "Nothing to change."
      : `${plural(item.count, "change")} sent to AniList.${item.left ? ` ${item.left} left unchecked.` : ""}${item.upToDate ? ` ${item.upToDate} already up to date.` : ""}`;
  const details = (item) => {
    const stats = item.stats;
    if (!stats && !item.notes.length) return "";
    const list = isList(item.service);
    const facts = stats ? [
      list ? plural(stats.entries || 0, "show") + " on the list" : `${(stats.entries || 0).toLocaleString()} new history ${stats.entries === 1 ? "entry" : "entries"}`,
      list ? "" : plural(stats.seasons || 0, "season"),
      `${(stats.matched || 0).toLocaleString()} matched`,
      `${(stats.unchanged || 0).toLocaleString()} already up to date`,
      stats.pending ? `${stats.pending} sent to Needs your pick` : "",
      stats.dropped ? `${stats.dropped.toLocaleString()} ${list ? "not found on AniList" : "skipped as not anime"}` : "",
    ].filter(Boolean).join(" · ") : "";
    return `<details class="report"><summary>Details</summary>
      ${facts ? `<p>${esc(facts)}</p>` : ""}
      ${item.notes.map((note) => `<p class="hint-note">${esc(note)}</p>`).join("")}
      ${missedList(item.animeMissed, item.service)}
      ${item.droppedNames.length ? `<p class="muted"><b>${list ? "Not found on AniList" : "Skipped as not anime"}:</b> ${esc(item.droppedNames.join(" · "))}</p>` : ""}
    </details>`;
  };
  const title = [item.trigger ? TRIGGERS[item.trigger] || item.trigger : "", inSite ? "" : sourceName(item.service), when(item.at)].filter(Boolean).join(" · ");
  return `<div class="panel">
    <div class="line"><div class="grow"><b>${esc(title)}</b>
      <small>${esc(outcome(item))}${item.undoneAt ? ` Undone ${esc(when(item.undoneAt))}.` : ""}${item.undoKept.length ? ` Left alone because they changed since: ${esc(item.undoKept.slice(0, 5).join(", "))}${item.undoKept.length > 5 ? "…" : ""}.` : ""}</small></div>
    ${item.undoneAt || !item.count ? "" : `<button class="btn" data-act="import-undo" data-id="${esc(item.id)}" ${running ? "disabled" : ""}>Undo</button>`}</div>
    ${details(item)}
  </div>`;
}

// A site's or list's own past imports, folded under its row. Import all runs have their own page.
const openPast = new Set();
function pastFold(source) {
  const items = (imp?.log || []).filter((item) => item.service === source);
  if (!items.length) return "";
  return `<details class="past" data-past="${esc(source)}" ${openPast.has(source) ? "open" : ""}>
    <summary>Past imports <span class="pill">${items.length}</span><span class="muted"> · last ${esc(when(items[0].at))}</span></summary>
    <div class="stack">${items.map((item) => logItem(item, { inSite: true })).join("")}</div>
  </details>`;
}

const allRuns = () => (imp?.log || []).filter((item) => item.service === "all");

function importsPage() {
  const items = allRuns();
  return `<p><a class="small-link" href="#settings/import">← Back to Import</a></p>
    <h1 class="page-title">Import all history</h1>
    <p class="page-sub">Every Import all run, and daily syncs that read more than one site. Details list what each site found.
      Undo puts AniList back as it was, leaving alone anything changed since. Imports from a single site are listed under that site in Import.</p>
    ${imp?.job?.running && imp.job.service === "all" ? `<div class="stack imp-status">${jobCard(imp.job)}</div>` : ""}
    ${items.length ? `<div class="stack">${items.map((item) => logItem(item)).join("")}</div>`
      : '<div class="panel"><p class="muted">No Import all runs yet. Start one from <a href="#settings/import">Import</a>.</p></div>'}`;
}

// Every connected site that can be read, one after another, into one preview.
function importAllRow() {
  const locked = imp?.job?.running || Boolean(imp?.preview) || busy;
  const ready = SERVICES.filter((service) => service.imports && state.connected.includes(service.id));
  const about = ready.length
    ? `Reads ${listNames(ready.map((service) => service.name))} one after another and shows one preview. Sites without an open tab can be opened for you first.`
    : "Connect a site in Accounts first.";
  const runs = allRuns();
  return `<div class="panel"><div class="line"><div class="grow"><b>Import all</b><small>${esc(about)}</small>
      ${runs.length ? `<small class="hint">Last run ${esc(when(runs[0].at))}.</small>` : ""}</div>
    ${runs.length ? `<a class="btn" href="#imports">Past runs <span class="pill">${runs.length}</span></a>` : ""}
    <button class="btn accent" data-act="import-all" ${locked || !ready.length ? "disabled" : ""}>Import all</button></div></div>`;
}

const TRIGGERS = { daily: "Daily sync", tracking: "Tracking" };
const WATCH_SWITCHES = [
  ["tubi", "trackTubi", "Track Tubi as you watch", "When you finish an anime episode or film on Tubi, AniList is updated a minute later, with Undo in Past imports. Only titles Tubi files under anime count."],
];

function settingSwitch(key, label, about, { disabled = false } = {}) {
  const on = Boolean(state.settings?.[key]);
  return `<div class="set-row${disabled ? " off" : ""}"><div class="grow"><b>${esc(label)}</b><small>${esc(about)}</small></div>
    <button class="switch${on ? " on" : ""}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-setting="${esc(key)}" ${disabled ? "disabled" : ""}></button></div>`;
}

// Opt-in updates that run without a click. They only read sites already open in a tab and never lower anything on AniList.
function autoRows() {
  const settings = state.settings || {};
  const sync = state.sync || {};
  const netflixOn = state.connected.includes("netflix");
  const netflixDone = (imp?.checkpoints?.netflix || []).length > 0;
  const syncNote = sync.lastRun ? ` Last ran ${when(sync.lastRun)}.` : "";
  const trackNote = !netflixOn ? " Connect Netflix first." : !netflixDone ? " Import Netflix once first." : sync.lastTrack ? ` Last checked ${when(sync.lastTrack)}.` : "";
  const hidiveOn = state.connected.includes("hidive");
  const hidiveNote = !hidiveOn ? " Connect HIDIVE first." : !(imp?.checkpoints?.hidive || []).length ? " Import HIDIVE once first." : "";
  return `<div class="panel">
    ${settingSwitch("dailySync", "Daily sync", `Once a day, catches up on new history from each connected site that's open in a tab, starting where the last import stopped. Sites never imported are left for you to import first, and a Netflix, Prime Video or HIDIVE profile is skipped unless you've imported it before, so a family member's profile left open in the tab is never synced.${syncNote}`)}
    ${settingSwitch("syncApply", "Apply daily sync without a preview", "Sends what it finds straight to AniList. Each run shows in Past imports with Undo. When off, a preview waits here and the toolbar icon shows a !", { disabled: !settings.dailySync })}
    ${settingSwitch("trackNetflix", "Track Netflix as you watch", `A couple of minutes after you finish an episode on Netflix, its viewing activity is caught up and AniList updated, with Undo in Past imports. Only profiles you've imported before are tracked.${trackNote}`, { disabled: !netflixOn })}
    ${settingSwitch("trackHidive", "Track HIDIVE as you watch", `A couple of minutes after you finish an episode on HIDIVE, its watch history is caught up and AniList updated, with Undo in Past imports. Only profiles you've imported before are tracked.${hidiveNote}`, { disabled: !hidiveOn && !settings.trackHidive })}
    ${settings.dailySync && sync.lastResult ? `<small class="hint">${esc(sync.lastResult)}</small>` : ""}
    ${WATCH_SWITCHES.map(([id, key, label, about]) => {
      const on = state.connected.includes(id);
      const seen = sync.watch?.[id];
      const last = settings[key] && seen ? ` Last noticed ${when(seen.at)}: ${seen.note}` : "";
      return settingSwitch(key, label, `${about}${on ? "" : ` Connect ${serviceById(id).name} first.`}${last}`, { disabled: !on && !settings[key] });
    }).join("")}
    ${WATCH_SWITCHES.some(([, key]) => settings[key]) || settings.trackNetflix || settings.trackHidive ? (sync.trackResult ? `<small class="hint">${esc(sync.trackResult)}</small>` : "") : ""}
  </div>`;
}

// One titled block inside the Import section, set apart from the next by a divider.
function importGroup(title, about, body, count = null) {
  return `<section class="imp-group">
    <div class="imp-head"><h4>${esc(title)}</h4>${count ? `<span class="pill">${count.toLocaleString()}</span>` : ""}</div>
    ${about ? `<p class="imp-about">${esc(about)}</p>` : ""}${body}</section>`;
}

function importSection() {
  const anilistReady = state.anilist?.connected;
  const status = [
    anilistReady ? "" : '<div class="panel"><p class="muted">Connect AniList in Accounts first.</p></div>',
    imp?.job?.error ? `<div class="panel warn">${esc(imp.job.error)}</div>` : "",
    imp?.job?.message && !imp.job.running ? `<div class="panel info">${esc(imp.job.message)}</div>` : "",
    imp?.job?.running ? jobCard(imp.job) : "",
    imp?.preview ? previewCard(imp.preview) : "",
  ].join("");
  return `${status ? `<div class="stack imp-status">${status}</div>` : ""}
    ${anilistReady ? importGroup("Watch history from sites", "Read from each site with your own sign-in. Each import picks up where the last one stopped.", `<div class="stack">${importAllRow()}${serviceImportRows()}</div>`) : ""}
    ${anilistReady ? importGroup("Automatic updates", "Off unless you switch them on. Only sites already open in a tab are read, and nothing on AniList is ever lowered.", autoRows()) : ""}
    ${anilistReady ? importGroup("Lists from other trackers", "Brought over once. Nothing already further along on AniList is lowered.", `<div class="stack">${listImportRows()}</div>`) : ""}
    ${pendingCard()}
    <p class="muted fold-foot">Sign-ins stay with each site; Crunchyroll's is only kept until you close the browser. Titles with no anime match are skipped and counted.</p>`;
}

async function loadImport() {
  const reply = await send("importStatus");
  if (reply?.ok) {
    const previewId = imp?.preview?.id;
    imp = reply;
    if (reply.preview?.id !== previewId) skip = new Set();
  }
  return reply;
}

// Every second while something runs; otherwise a slow check on Settings, so a daily sync or Netflix tracking run shows up.
const IDLE_POLL_MS = 15_000;
function schedulePoll() {
  clearTimeout(pollTimer);
  const running = imp?.job?.running;
  const watched = ["settings", "imports"].includes(parseHash().name);
  if (!running && !watched) return;
  pollTimer = setTimeout(async () => {
    await loadImport();
    const typing = main.contains(document.activeElement) && document.activeElement.matches("input.field");
    if (running && !imp?.job?.running) return refresh();
    if ((running || imp?.job?.running) && ["settings", "imports"].includes(parseHash().name) && !typing) route();
    schedulePoll();
  }, running ? 1000 : IDLE_POLL_MS);
}

function parseAnilistId(text) {
  const value = String(text || "").trim();
  const match = /anilist\.co\/anime\/(\d+)/i.exec(value) || /^(\d{1,7})$/.exec(value);
  return match ? Number(match[1]) : null;
}

const SITE_WAIT_MS = 30_000;
const listNames = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

// Before Import all: offer to open the connected sites that have no tab yet, then wait for them to load.
// Declining still imports the sites that are ready.
async function openMissingSites() {
  const needs = await send("importAllNeeds");
  const missing = needs?.ok ? needs.missing : [];
  if (!missing.length) return;
  const names = missing.map((id) => serviceById(id)?.name || id);
  const profile = missing.includes("netflix") ? "\n\nNetflix may ask who's watching first. If it does, pick your profile in its tab, or it's skipped this time." : "";
  const message = `Open ${listNames(names)} in new tabs so ${missing.length === 1 ? "it" : "they"} can be included?\n\nThey open in the background, and the import starts once they've loaded.${profile}\n\nCancel to import only the sites already open.`;
  if (!confirm(message)) return;
  busy = true;
  route();
  toast(`Opening ${listNames(names)}…`);
  const opened = await send("openSites", { services: missing });
  if (opened?.ok) {
    for (const until = Date.now() + SITE_WAIT_MS; Date.now() < until;) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const now = await send("importAllNeeds");
      if (!now?.ok || !missing.some((id) => now.missing.includes(id))) break;
    }
  } else toast(opened?.error || "Those sites didn't open");
  busy = false;
}

async function importAction(act, target) {
  const call = async (type, extra) => {
    busy = true;
    route();
    const reply = await send(type, extra);
    busy = false;
    if (reply?.ok) imp = { ...imp, ...reply };
    else if (reply?.code !== "tab") toast(reply?.error || "That didn't work");
    route();
    schedulePoll();
    return reply;
  };
  if (act === "import-all") {
    await openMissingSites();
    const reply = await call("startImportAll");
    if (reply?.ok) toast("Import all started");
  } else if (act === "import-start") {
    if (location.hash.includes("ready=")) history.replaceState(null, "", "#settings/import");
    const reply = await call("startImport", { service: target.dataset.svc, full: target.dataset.full === "1" });
    if (reply?.ok) toast("Import started");
    else if (reply?.code === "tab") await openSite(target.dataset.svc);
  } else if (act === "import-close") {
    await call("dismissImport");
  } else if (act === "import-cancel") {
    await call("cancelImport");
  } else if (act === "import-dismiss") {
    if (!confirm("Dismiss this preview? Your AniList stays as it is, and the next import starts after this history.")) return;
    await call("dismissImport");
  } else if (act === "import-apply") {
    const reply = await call("applyImport", { skip: [...skip] });
    if (reply?.ok) toast(reply.result?.error ? `Stopped: ${reply.result.error}` : `Updated ${reply.result.applied} on AniList`);
  } else if (act === "import-undo") {
    if (!confirm("Put these AniList entries back the way they were? Entries you changed since are left alone.")) return;
    const reply = await call("undoImport", { id: target.dataset.id });
    if (reply?.ok) toast(`Restored ${reply.result.restored}${reply.result.kept.length ? `, left ${reply.result.kept.length} alone` : ""}`);
  } else if (act === "pick-all" || act === "pick-none") {
    skip = act === "pick-all" ? new Set() : new Set((imp?.preview?.changes || []).map((change) => change.anilistId));
    route();
  } else {
    const card = target.closest("[data-key]");
    if (!card) return;
    let anilistId = null;
    if (act === "pending-pick") anilistId = Number(target.dataset.id);
    if (act === "pending-manual") {
      anilistId = parseAnilistId(card.querySelector("input.field")?.value);
      if (!anilistId) return toast("Paste an AniList anime link or its number");
    }
    const reply = await call("resolvePending", { key: card.dataset.key, anilistId: act === "pending-skip" ? null : anilistId });
    if (reply?.ok) toast(act === "pending-skip" ? "Skipped" : reply.result?.added ? "Matched and added to the preview" : "Matched; AniList is already up to date for it");
  }
}

const credits = () => CREDITS.map((credit) => `<a href="${esc(credit.url)}" target="_blank" rel="noopener">${esc(credit.name)}</a> by ${esc(credit.by)} (${esc(credit.license)})`).join("; ");

function backupRows() {
  return `<div class="panel line"><div class="grow"><b>Backup</b><small>Saves your matches, picks, import history and settings to a file. Sign-ins are never included.</small></div>
      <button class="btn" data-act="backup-save">Download backup</button>
      <label class="btn">Restore…<input type="file" accept=".json,application/json" data-act="backup-restore" hidden></label></div>
    <div class="panel line"><div class="grow"><b>Diagnostics</b><small>Copies a short report (versions, connections, recent imports) for a bug report. No tokens or account names.</small></div>
      <button class="btn" data-act="copy-diagnostics">Copy diagnostics</button></div>
    <div class="panel line"><div class="grow"><b>Guided setup</b><small>${state.settings?.setupDone ? "Finished. Run it again any time." : "Not finished yet."}</small></div>
      <a class="btn" href="#welcome">${state.settings?.setupDone ? "Run setup again" : "Continue setup"}</a></div>`;
}

// Settings sections fold open and closed; which ones are open is remembered on this device.
const FOLDS_KEY = "cs-settings-open";
let openFolds = new Set(["accounts"]);
try { const saved = JSON.parse(localStorage.getItem(FOLDS_KEY)); if (Array.isArray(saved)) openFolds = new Set(saved); } catch { /* nothing saved */ }

function fold(id, title, about, body, { forceOpen = false } = {}) {
  return `<details class="set-card fold" data-fold="${id}" ${forceOpen || openFolds.has(id) ? "open" : ""}>
    <summary><div class="grow"><h3>${title}</h3><p>${about}</p></div></summary>
    <div class="fold-body">${body}</div></details>`;
}

function settingsPage() {
  const importBusy = Boolean(imp?.job?.running || imp?.preview);
  return `<h1 class="page-title">Settings</h1><p class="page-sub">Accounts, imports, looks and data for this browser.</p>
    ${fold("accounts", "Accounts", "Trackers and the sites you watch on.", `<div class="stack">${trackerRows()}${serviceRows()}</div>`)}
    ${fold("import", "Import", "Bring in what you've watched. Imports pick up where the last one stopped, and nothing changes on AniList until you apply the preview.", importSection(), { forceOpen: importBusy })}
    ${fold("where", "Where to watch", "Switch off sites you don't want to see, and their links and Watch buttons disappear. That works for connected sites too; their history and imports keep working.", `${catalogRows()}${settingSwitch("hideOffSiteShows", "Hide shows only on switched-off sites", "Home, Browse, search and airing leave out shows that only stream on sites switched off below. Shows with no known place to watch stay, and My list still shows everything.")}${listingRows()}`)}
    ${fold("character", "Favorite character", "Mockup: short text lines for welcome-back, look-here notices, and guide tips. Optional AI can paraphrase later from the same banks — no audio.", characterSection())}
    ${fold("appearance", "Appearance", "Colors, light or dark, and card size. Saved on this device.", prism.appearanceBody())}
    ${fold("data", "Data", "The master list, backups, diagnostics and setup.", `<div class="stack">${dataRow()}${backupRows()}</div>`)}
    <p class="foot">Crunchilist Search ${esc(state.version)}. Anime data: ${credits()}. <a href="privacy.html">Privacy</a>.</p>`;
}

main.addEventListener("toggle", (event) => {
  const id = event.target.dataset?.fold;
  if (!id) return;
  if (event.target.open) openFolds.add(id);
  else openFolds.delete(id);
  localStorage.setItem(FOLDS_KEY, JSON.stringify([...openFolds]));
}, true);

function setupStep(number, title, done, body) {
  return `<section class="setup-step${done ? " done" : ""}"><div class="setup-num">${done ? "✓" : number}</div>
    <div class="setup-body"><h3>${title}</h3>${body}</div></section>`;
}

function welcomePage() {
  const anilistDone = Boolean(state.anilist?.connected);
  const sitesDone = state.connected.length > 0;
  const hiddenDone = (state.settings?.hiddenSites || []).length > 0;
  const imported = (imp?.log || []).length > 0;
  return `<h1 class="page-title">Set up Crunchilist Search</h1>
    <p class="page-sub">Four quick steps. Skip any of them; everything here is also in Settings.</p>
    <div class="setup">
      ${setupStep(1, "Connect AniList", anilistDone, `<p class="muted">Your list lives on AniList. Connecting lets search, show pages and imports update it.</p><div class="stack">${anilistRow()}</div>`)}
      ${setupStep(2, "Connect the sites you watch on", sitesDone, `<p class="muted">Chrome asks before each one. Crunchyroll and Netflix can import history today; the rest get ready for it.</p><div class="stack">${serviceRows()}</div>`)}
      ${setupStep(3, "Hide sites you don't use", hiddenDone, `<p class="muted">Optional. Hidden sites drop out of where-to-watch links.</p><div class="set-card">${listingRows()}</div>`)}
      ${setupStep(4, "Bring in what you've watched", imported, `<p class="muted">Import history from a connected site, or a list from MyAnimeList or Kitsu. Nothing changes on AniList until you apply the preview.</p><a class="btn" href="#settings/import">Open Import</a>`)}
    </div>
    <div class="setup-end"><button class="btn accent" data-act="setup-finish">${state.settings?.setupDone ? "Done" : "Finish setup"}</button></div>
    <p class="foot">Crunchilist Search only reads what you've watched, using your own sign-in, and keeps it in this browser.</p>`;
}

const pages = {
  welcome: welcomePage,
  settings: settingsPage,
  imports: importsPage,
};

main.addEventListener("toggle", (event) => {
  const fold = event.target.closest?.("details[data-past]");
  if (!fold) return;
  if (fold.open) openPast.add(fold.dataset.past);
  else openPast.delete(fold.dataset.past);
}, true);

async function saveSettings(patch) {
  const reply = await send("saveSettings", { patch });
  if (!reply?.ok) return toast(reply?.error || "That setting wasn't saved");
  state = { ...state, settings: reply.settings, mineServices: reply.mineServices || [] };
  if ("hiddenSites" in patch || "readCatalogs" in patch || "hideOffSiteShows" in patch) prism.catalogsChanged();
  route();
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const THEME_KEY = "cs-theme";
async function dataAction(act) {
  if (act === "backup-save") {
    let theme = null;
    try { theme = JSON.parse(localStorage.getItem(THEME_KEY)); } catch { /* no theme saved */ }
    const reply = await send("backup", { theme });
    if (!reply?.ok) return toast(reply?.error || "The backup wasn't made");
    download(`crunchilist-search-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(reply.file, null, 2));
    return toast("Backup downloaded");
  }
  if (act === "copy-diagnostics") {
    const reply = await send("copyDiagnostics", { userAgent: navigator.userAgent });
    if (!reply?.ok) return toast(reply?.error || "Diagnostics weren't made");
    await navigator.clipboard.writeText(reply.text).then(() => toast("Diagnostics copied"), () => toast("Couldn't reach the clipboard"));
    return;
  }
  if (act === "setup-finish") {
    await saveSettings({ setupDone: true });
    location.hash = "#";
  }
}

// Kitsu's site is asked for inside the click, where Chrome allows the prompt.
async function kitsuImport() {
  const username = main.querySelector("#kitsu-name")?.value.trim();
  if (!username) return toast("Enter your Kitsu username");
  const granted = await chrome.permissions.request({ origins: [LIST_SOURCES.kitsu.origin] }).catch(() => false);
  if (!granted) return toast("Kitsu needs that permission to read your library");
  busy = true;
  route();
  const reply = await send("importKitsu", { username });
  busy = false;
  if (reply?.ok) { imp = { ...imp, ...reply }; toast("Reading your Kitsu library"); }
  else toast(reply?.error || "Kitsu import didn't start");
  route();
  schedulePoll();
}

async function readListFile(file) {
  if (!/\.gz$/i.test(file.name)) return file.text();
  return new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

// #name?query/arg — e.g. #show/21, #search?q=frieren, #list/PLANNING
function parseHash() {
  const raw = location.hash.replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  const [name = "", arg = ""] = path.split("/");
  return { name: name || "home", arg: decodeURIComponent(arg), query };
}

let lastFold = "";

function route() {
  const { name, arg, query } = parseHash();
  // The Import page became a Settings section; old links land there.
  if (name === "import") {
    history.replaceState(null, "", `#settings/import${query ? `?${query}` : ""}`);
    return route();
  }
  if (name === "settings" && arg) openFolds.add(arg);
  const page = (pages[name] || prism.PAGES.includes(name)) ? name : "home";
  document.body.dataset.page = page;
  main.innerHTML = pages[page] ? `<div class="page">${pages[page]()}</div>` : prism.render(page, { arg, query });
  for (const link of document.querySelectorAll("[data-route]")) link.classList.toggle("on", link.dataset.route === page);
  prism.applyTheme();
  prism.paintAvatar();
  if (!pages[page]) prism.after(page, { arg });
  const target = page === "settings" && arg ? arg : "";
  if (target && target !== lastFold && !query.includes("ready=")) main.querySelector(`[data-fold="${CSS.escape(target)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  lastFold = target;
  showReady();
}

async function refresh() {
  const wasConnected = state.anilist?.connected;
  const [reply] = await Promise.all([send("status"), loadImport()]);
  if (reply?.ok) state = { ...state, version: reply.version, connected: reply.connected, anilist: reply.anilist, mal: reply.mal, kitsu: reply.kitsu, favorite: reply.favorite, lines: reply.lines, idMap: reply.idMap, whereMap: reply.whereMap, title: reply.title, settings: reply.settings, sync: reply.sync, catalogs: reply.catalogs || {}, mineServices: reply.mineServices || [] };
  if (state.anilist?.connected !== wasConnected) await prism.loadList();
  route();
  schedulePoll();
  takeCatalogKick().catch(() => {});
}

async function anilistAction(act) {
  if (act === "anilist-connect") {
    connecting = true;
    route();
    const reply = await send("connectAnilist");
    connecting = false;
    toast(reply?.ok ? `Connected to AniList as ${reply.anilist?.name || "you"}` : reply?.error || "AniList sign-in didn't finish");
  } else {
    await send("disconnectAnilist");
    toast("Disconnected from AniList");
  }
  await refresh();
}

async function malAction(act) {
  if (act === "mal-client-save") {
    const clientId = main.querySelector("#mal-client-id")?.value.trim() || "";
    const reply = await send("setMalClientId", { clientId });
    toast(reply?.ok ? (clientId ? "MyAnimeList client id saved" : "MyAnimeList client id cleared") : reply?.error || "Couldn't save client id");
    await refresh();
    return;
  }
  if (act === "mal-connect") {
    connecting = true;
    route();
    const reply = await send("connectMal");
    connecting = false;
    toast(reply?.ok ? `Connected to MyAnimeList as ${reply.mal?.name || "you"}` : reply?.error || "MyAnimeList sign-in didn't finish");
    await refresh();
    return;
  }
  if (act === "mal-disconnect") {
    await send("disconnectMal");
    toast("Disconnected from MyAnimeList");
    await refresh();
    return;
  }
  if (act === "mal-pull") {
    busy = true;
    route();
    const reply = await send("importMalApi");
    busy = false;
    if (reply?.ok) { imp = { ...imp, ...reply }; toast("Reading your MyAnimeList"); }
    else toast(reply?.error || "MyAnimeList pull didn't start");
    route();
    schedulePoll();
  }
}

async function kitsuLinkAction(act) {
  if (act === "kitsu-link") {
    const username = main.querySelector("#kitsu-link-name")?.value.trim();
    if (!username) return toast("Enter your Kitsu username");
    const granted = await chrome.permissions.request({ origins: [LIST_SOURCES.kitsu.origin] }).catch(() => false);
    if (!granted) return toast("Kitsu needs that permission to read your library");
    const reply = await send("connectKitsu", { username });
    toast(reply?.ok ? `Linked Kitsu as ${reply.kitsu?.username || username}` : reply?.error || "Couldn't link Kitsu");
    await refresh();
    return;
  }
  if (act === "kitsu-disconnect") {
    await send("disconnectKitsu");
    toast("Unlinked Kitsu");
    await refresh();
    return;
  }
  if (act === "kitsu-pull") {
    const username = state.kitsu?.username;
    if (!username) return toast("Link Kitsu first");
    const granted = await chrome.permissions.request({ origins: [LIST_SOURCES.kitsu.origin] }).catch(() => false);
    if (!granted) return toast("Kitsu needs that permission to read your library");
    busy = true;
    route();
    const reply = await send("importKitsu", { username });
    busy = false;
    if (reply?.ok) { imp = { ...imp, ...reply }; toast("Reading your Kitsu library"); }
    else toast(reply?.error || "Kitsu pull didn't start");
    route();
    schedulePoll();
  }
}

async function trackerPullNow() {
  busy = true;
  route();
  if (state.kitsu?.connected) {
    const granted = await chrome.permissions.request({ origins: [LIST_SOURCES.kitsu.origin] }).catch(() => false);
    if (!granted) {
      busy = false;
      route();
      return toast("Kitsu needs that permission to pull");
    }
  }
  const reply = await send("pullTrackers");
  busy = false;
  if (reply?.ok) {
    imp = { ...imp, ...reply };
    toast(reply.tried?.length ? `Pulled ${reply.tried.join(" + ")}` : reply.sync?.trackerPullResult || "Nothing to pull");
  } else toast(reply?.error || "Tracker pull didn't start");
  await refresh();
  schedulePoll();
}

// Chrome only shows its permission prompt from inside the click, so the request happens here, not in the background.
main.addEventListener("click", async (event) => {
  const account = event.target.closest('[data-act^="anilist-"]');
  if (account) return anilistAction(account.dataset.act);
  const mal = event.target.closest('[data-act^="mal-"]');
  if (mal) return malAction(mal.dataset.act);
  const kitsuAct = event.target.closest('[data-act="kitsu-link"], [data-act="kitsu-disconnect"], [data-act="kitsu-pull"]');
  if (kitsuAct) return kitsuLinkAction(kitsuAct.dataset.act);
  if (event.target.closest('[data-act="tracker-pull"]')) return trackerPullNow();
  const fav = event.target.closest('[data-act="fav-char"]');
  if (fav) {
    const reply = await send("setFavoriteCharacter", { id: fav.dataset.id || "" });
    if (reply?.ok) {
      state = { ...state, favorite: reply.favorite, lines: reply.lines };
      toast(reply.favorite?.id ? `${reply.favorite.name} is your favorite character` : "Favorite character cleared");
      route();
    } else toast(reply?.error || "Couldn't save favorite");
    return;
  }
  const step = event.target.closest('[data-act^="import-"], [data-act^="pending-"], [data-act^="pick-"]');
  if (step) return importAction(step.dataset.act, step);
  const data = event.target.closest('[data-act="backup-save"], [data-act="copy-diagnostics"], [data-act="setup-finish"]');
  if (data) return dataAction(data.dataset.act);
  if (event.target.closest('[data-act="kitsu-import"]')) return kitsuImport();
  const setting = event.target.closest("[data-setting]");
  if (setting) {
    const key = setting.dataset.setting;
    const on = !state.settings?.[key];
    await saveSettings({ [key]: on, ...(key === "dailySync" && !on ? { syncApply: false } : {}) });
    const watchSwitch = WATCH_SWITCHES.find(([, name]) => name === key);
    if (on) toast(key === "trackNetflix" ? "Netflix tracking is on. Keep a Netflix tab open while you watch."
      : key === "trackHidive" ? "HIDIVE tracking is on. It catches up after you finish an episode on HIDIVE."
      : key === "readCatalogs" ? "Catalogs are read when Crunchyroll, HIDIVE, Tubi or Netflix is open in a tab."
      : key === "hideOffSiteShows" ? "Shows only on sites you've switched off are hidden."
      : key === "weeklyTrackerPull" ? "Weekly tracker pull is on."
      : key === "writeMal" ? "MyAnimeList writes are on when connected."
      : watchSwitch ? `${serviceById(watchSwitch[0]).name} tracking is on. Episodes count once most of them has played.` : key === "dailySync" ? "Daily sync is on. It runs when a connected site is open in a tab." : "Daily sync will apply what it finds");
    return;
  }
  const catalog = event.target.closest('[data-act="catalog-read"]');
  if (catalog) return readCatalogNow(catalog.dataset.catalog);
  const listing = event.target.closest("[data-listing]");
  if (listing) {
    const site = listing.dataset.listing;
    const hidden = new Set(state.settings?.hiddenSites || []);
    if (hidden.has(site)) hidden.delete(site);
    else hidden.add(site);
    return saveSettings({ hiddenSites: [...hidden] });
  }
  if (event.target.closest('[data-act="refresh-feeds"]')) {
    checkingFeeds = true;
    route();
    const reply = await send("refreshFeeds");
    checkingFeeds = false;
    toast(reply?.idMap?.error ? reply.idMap.error : "Master list is up to date");
    return refresh();
  }
  const button = event.target.closest("[data-service]");
  if (!button) return;
  const service = serviceById(button.dataset.service);
  if (!service) return;
  if (button.dataset.act === "connect") {
    const granted = await chrome.permissions.request({ origins: service.origins }).catch(() => false);
    if (!granted) return toast(`${service.name} wasn't connected`);
    await send("syncServices");
    await refresh();
    return openSite(service.id);
  }
  await chrome.permissions.remove({ origins: service.origins }).catch(() => false);
  await send("syncServices");
  if (confirm(`${service.name} is disconnected. Also forget your ${service.name} data on this device?\n\nThat clears its remembered matches, waiting picks, tracked episodes and where imports left off, so a later import starts fresh. Your AniList list and Past imports stay as they are.\n\nOK forgets it; Cancel keeps it.`)) {
    const reply = await send("forgetSiteData", { service: service.id });
    toast(reply?.ok ? reply.note : `${service.name} disconnected. ${reply?.error || "Its data wasn't forgotten."}`);
    if (reply?.ok) prism.catalogsChanged();
  } else toast(`${service.name} disconnected. Its data is kept.`);
  await refresh();
});

// Opens the site in a new tab; a card there sends the user back here when they're ready.
async function openSite(id) {
  const service = serviceById(id);
  const reply = await send("openSite", { service: id });
  if (!reply?.ok) return toast(reply?.error || `${service?.name || "That site"} didn't open`);
  toast(`Opened ${service.name}. ${id === "netflix" ? "Pick your profile there, then" : "When it's loaded,"} click Back to Crunchilist Search.`);
}

async function readCatalogNow(id, { fromReturn = false } = {}) {
  const service = serviceById(id);
  if (!service) return;
  if (readingCatalog === id) return;
  readingCatalog = id;
  route();
  // After Back, wait for the site tab to say hello before reading; never open a second tab.
  let reply;
  try {
    reply = await send("refreshCatalogs", { service: id, openIfNeeded: !fromReturn, wait: fromReturn });
  } finally {
    readingCatalog = "";
  }
  if (reply?.opened) {
    toast(`Opened ${service.name}. ${id === "netflix" ? "Pick your profile, keep the tab open, then" : "Keep the tab open, then"} click Back to Crunchilist Search.`);
    return refresh();
  }
  const result = reply?.results?.[0];
  toast(!reply?.ok ? reply?.error || "That catalog couldn't be read" : result?.ok ? `${service.name}'s catalog is up to date` : result?.error || "That catalog couldn't be read");
  prism.catalogsChanged();
  return refresh();
}

async function takeCatalogKick() {
  const kick = (await chrome.storage.session.get(KEYS.catalogKick))[KEYS.catalogKick];
  if (!kick?.service || Date.now() - (kick.at || 0) > 120_000) return;
  await chrome.storage.session.remove(KEYS.catalogKick);
  lastCatalogRead = kick.service;
  if (location.hash !== "#settings") history.replaceState(null, "", "#settings");
  await readCatalogNow(kick.service, { fromReturn: true });
}
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes[KEYS.catalogKick]?.newValue?.service) takeCatalogKick().catch(() => {});
});

// Back from a site's tab: point at that service's Import button, or finish a catalog read.
let lastReady = "";
let lastCatalogRead = "";
function showReady() {
  const { name, query } = parseHash();
  const params = name === "settings" ? new URLSearchParams(query) : null;
  const readCatalog = params?.get("readCatalog") || "";
  if (readCatalog && readCatalog !== lastCatalogRead) {
    lastCatalogRead = readCatalog;
    history.replaceState(null, "", "#settings");
    readCatalogNow(readCatalog, { fromReturn: true });
    return;
  }
  if (!readCatalog) lastCatalogRead = "";
  const ready = params?.get("ready") || "";
  if (!ready || ready === lastReady) { if (!ready) lastReady = ""; return; }
  lastReady = ready;
  const service = serviceById(ready);
  const row = main.querySelector(`[data-row="${CSS.escape(ready)}"]`);
  if (!service || !row) return;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.querySelector(".pulse")?.focus({ preventScroll: true });
  toast(service.imports === true ? `${service.name} is ready. Press Import history when you are.`
    : service.tracks ? `${service.name} is connected. Turn on its tracking under Automatic updates.`
      : `${service.name} is connected.`);
}

main.addEventListener("change", async (event) => {
  const file = event.target.closest('[data-act="netflix-csv"]');
  if (file) {
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    if (chosen.size > 30_000_000) return toast("That file is too big");
    busy = true;
    route();
    const reply = await send("importNetflixCsv", { text: await chosen.text() });
    busy = false;
    if (reply?.ok) { imp = { ...imp, ...reply }; toast("Reading your Netflix file"); }
    else toast(reply?.error || "That file couldn't be read");
    route();
    schedulePoll();
    return;
  }
  const mal = event.target.closest('[data-act="mal-file"]');
  if (mal) {
    const chosen = mal.files?.[0];
    mal.value = "";
    if (!chosen) return;
    if (chosen.size > 60_000_000) return toast("That file is too big");
    busy = true;
    route();
    const text = await readListFile(chosen).catch(() => "");
    const reply = text ? await send("importMalFile", { text }) : { ok: false, error: "That file couldn't be opened" };
    busy = false;
    if (reply?.ok) { imp = { ...imp, ...reply }; toast("Reading your MyAnimeList list"); }
    else toast(reply?.error || "That file couldn't be read");
    route();
    schedulePoll();
    return;
  }
  const restore = event.target.closest('[data-act="backup-restore"]');
  if (restore) {
    const chosen = restore.files?.[0];
    restore.value = "";
    if (!chosen) return;
    if (chosen.size > 50_000_000) return toast("That file is too big");
    if (!confirm("Restore this backup? Your current matches, picks, import history and settings are replaced. AniList itself isn't touched.")) return;
    const reply = await send("restore", { text: await chosen.text() });
    if (!reply?.ok) return toast(reply?.error || "That backup couldn't be restored");
    if (reply.theme) localStorage.setItem(THEME_KEY, JSON.stringify(reply.theme));
    location.reload();
    return;
  }
  const box = event.target.closest("[data-pick]");
  if (!box) return;
  const id = Number(box.dataset.pick);
  if (box.checked) skip.delete(id);
  else skip.add(id);
  const apply = main.querySelector('[data-act="import-apply"]');
  const chosen = (imp?.preview?.changes || []).filter((change) => !skip.has(change.anilistId)).length;
  if (apply) { apply.textContent = `Apply ${chosen} change${chosen === 1 ? "" : "s"}`; apply.disabled = !chosen || Boolean(imp?.job?.running); }
});
main.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches(".pending input.field")) event.target.closest(".pending").querySelector('[data-act="pending-manual"]')?.click();
  if (event.key === "Enter" && event.target.matches("#kitsu-name")) kitsuImport();
});

document.getElementById("nav").outerHTML = prism.nav();
prism.init({ send, toast, state: () => state, rerender: route });
addEventListener("hashchange", () => { route(); scrollTo(0, 0); schedulePoll(); });
refresh();
