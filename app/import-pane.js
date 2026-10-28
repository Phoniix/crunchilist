// Prism Import pane: history imports, automatic updates, and list imports (from Search).
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const day = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");
const STATUS = { CURRENT: "Watching", COMPLETED: "Completed", PLANNING: "Planning", PAUSED: "Paused", DROPPED: "Dropped", REPEATING: "Rewatching" };
const TRIGGERS = { daily: "Daily sync", tracking: "Tracking" };
const HOW = {
  crunchyroll: "Keep a Crunchyroll tab open and signed in while importing.",
  netflix: "Imports the profile open in your Netflix tab. Or upload the CSV from netflix.com/viewingactivity (Download all).",
  prime: "Imports the profile open in your Prime Video tab.",
  hidive: "Imports the profile open in your HIDIVE tab. Only mostly-watched episodes count.",
};

const SERVICES = [
  { id: "crunchyroll", name: "Crunchyroll", imports: true, home: "https://www.crunchyroll.com/", file: false },
  { id: "netflix", name: "Netflix", imports: true, home: "https://www.netflix.com/", file: true },
  { id: "prime", name: "Prime Video", imports: true, home: "https://www.primevideo.com/", file: false },
  { id: "hidive", name: "HIDIVE", imports: true, home: "https://www.hidive.com/", file: false },
  { id: "tubi", name: "Tubi", imports: false, tracks: true, home: "https://tubitv.com/" },
  { id: "hulu", name: "Hulu", imports: false, untested: true, home: "https://www.hulu.com/" },
];

let skip = new Set();
let openPast = new Set();

const entryText = (entry, total) => (!entry?.status ? "Not on your list" : `${STATUS[entry.status] || entry.status} · ${entry.progress || 0}${total ? ` of ${total}` : ""}`);
const sourceName = (id) => (id === "all" ? "All sites" : SERVICES.find((s) => s.id === id)?.name || id);
const isList = (id) => id === "mal" || id === "kitsu";

function pointText(point) {
  const who = point.label ? `${point.label}: ` : "";
  return `${who}imported up to ${when(point.newestAt)}.${point.end ? ` All history read, back to ${day(point.oldestAt)}.` : point.resume ? " Older history is still to read; the next import continues it." : ""}`;
}

function lockReason(imp, serviceId = "", { needsAnilist = false } = {}) {
  if (needsAnilist) return "Connect AniList under Account to import or apply changes.";
  if (imp?.job?.running) return "Wait for the current step to finish, or stop it above.";
  const list = Array.isArray(imp?.previews) && imp.previews.length
    ? imp.previews
    : (imp?.preview ? [imp.preview] : []);
  const hit = list.find((preview) => {
    if (!serviceId || serviceId === "all") return true;
    return preview.service === serviceId || preview.service === "all";
  });
  if (hit) return `Apply or dismiss the ${sourceName(hit.service)} preview above first.`;
  return "";
}

function settingSwitch(settings, key, label, about, { disabled = false } = {}) {
  const on = Boolean(settings?.[key]);
  return `<div class="set-row${disabled ? " off" : ""}"><div class="grow"><b>${esc(label)}</b><small>${esc(about)}</small></div>
    <button class="switch${on ? " on" : ""}" role="switch" aria-checked="${on}" data-setting="${esc(key)}" ${disabled ? "disabled" : ""}></button></div>`;
}

const share = (done, total) => (total ? Math.min(1, Math.max(0, done / total)) : 0);

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
  return `<div class="site-bar ${esc(site.state)}"><b>${esc(site.name)}</b>
    <div class="bar"><span style="width:${reading && !known ? 30 : width}%" class="${reading && !known ? "spin" : ""}"></span></div>
    <small title="${esc(text)}">${esc(text)}</small></div>`;
}

function jobCard(job) {
  // Keep per-site bars after Import all finishes so skipped/done notes stay visible with the message.
  if (job.sites?.length && (job.running || job.message || job.error || job.phase === "preview")) {
    const overall = job.running ? Math.round(overallPercent(job)) : 100;
    const label = job.running
      ? (job.note || "Working…")
      : job.error || (job.phase === "preview" ? "Finished — review the preview below" : "Finished");
    return `<div class="panel"><div class="line"><div class="grow"><b>${esc(label)}</b><small>${esc(TRIGGERS[job.trigger] || "Import all")} · ${overall}% overall</small></div>
      ${job.phase === "reading" ? `<button class="btn ghost" data-act="import-cancel">Stop</button>` : ""}</div>
      <div class="bar master"><span style="width:${overall}%"></span></div>
      <div class="site-bars">${job.sites.map((site) => siteBar(site, job)).join("")}</div></div>`;
  }
  if (!job.running) return "";
  const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  return `<div class="panel"><div class="line"><div class="grow"><b>${esc(job.note || "Working…")}</b>
    ${job.total ? `<small>${job.done.toLocaleString()} of ${job.total.toLocaleString()}</small>` : ""}</div>
    ${job.phase === "reading" || job.phase === "saving" || job.phase === "matching" || job.phase === "anilist" ? `<button class="btn ghost" data-act="import-cancel">Stop</button>` : ""}</div>
    <div class="bar"><span style="width:${job.total ? pct : 30}%" class="${job.total ? "" : "spin"}"></span></div></div>`;
}

function pastFold(imp, source) {
  const items = (imp?.log || []).filter((item) => item.service === source);
  if (!items.length) return "";
  return `<details class="past" data-past="${esc(source)}" ${openPast.has(source) ? "open" : ""}>
    <summary>Past imports <span class="pill">${items.length}</span></summary>
    <div class="stack">${items.map((item) => logItem(item, true)).join("")}</div></details>`;
}

function logItem(item, inSite = false) {
  const outcome = item.outcome === "dismissed" ? `Dismissed; ${(item.offered || 0).toLocaleString()} change(s) not sent.`
    : item.outcome === "nothing" ? "Nothing to change."
      : `${(item.count || 0).toLocaleString()} change(s) sent to AniList.${item.left ? ` ${item.left} left unchecked.` : ""}`;
  const title = [item.trigger ? TRIGGERS[item.trigger] || item.trigger : "", inSite ? "" : sourceName(item.service), when(item.at)].filter(Boolean).join(" · ");
  return `<div class="panel"><div class="line"><div class="grow"><b>${esc(title)}</b><small>${esc(outcome)}${item.undoneAt ? ` Undone ${esc(when(item.undoneAt))}.` : ""}</small></div>
    ${item.undoneAt || !item.count ? "" : `<button class="btn ghost" data-act="import-undo" data-id="${esc(item.id)}">Undo</button>`}</div></div>`;
}

function onePreviewCard(imp, preview) {
  if (!preview) return "";
  const { changes = [], notes = [] } = preview;
  const stats = preview.stats || {};
  const chosen = changes.filter((change) => !skip.has(change.anilistId)).length;
  const summary = !preview.stats ? "From the shows you picked."
    : isList(preview.service)
      ? `${(stats.entries || 0).toLocaleString()} shows on your ${sourceName(preview.service)} list.`
      : `${(stats.entries || 0).toLocaleString()} new history entries, ${(stats.seasons || 0).toLocaleString()} seasons.`;
  const pendingNudge = stats.pending
    ? `<p class="hint-note"><a href="#needs-pick">${stats.pending.toLocaleString()} title${stats.pending === 1 ? "" : "s"} still need your pick</a> before those episodes can join AniList — open <b>Needs your pick</b> on this page.</p>`
    : "";
  const who = sourceName(preview.service);
  if (!changes.length) {
    return `<div class="panel" data-preview-svc="${esc(preview.service)}"><div class="line"><div class="grow"><b>${esc(who)}: nothing to change on AniList yet</b><small>${esc(summary)}</small></div>
      <button class="btn accent" data-act="import-close" data-svc="${esc(preview.service)}">Close</button></div>
      ${pendingNudge || (imp?.pendingCount ? `<p class="hint-note"><a href="#needs-pick">${imp.pendingCount.toLocaleString()} title${imp.pendingCount === 1 ? "" : "s"} waiting in Needs your pick</a>.</p>` : "")}</div>`;
  }
  const list = changes.map((change) => `<label class="change">
    <input type="checkbox" data-pick="${change.anilistId}" ${skip.has(change.anilistId) ? "" : "checked"}>
    <span class="grow"><b>${esc(change.title || `AniList ${change.anilistId}`)}</b>
      <small>${esc(entryText(change.before, change.episodes))} → ${esc(entryText(change.after, change.episodes))}</small></span>
    <a class="small-link" href="https://anilist.co/anime/${change.anilistId}" target="_blank" rel="noopener">AniList</a>
  </label>`).join("");
  return `<div class="panel" data-preview-svc="${esc(preview.service)}"><div class="line"><div class="grow"><b>${preview.trigger ? `${esc(TRIGGERS[preview.trigger] || "Sync")} · ${esc(who)}` : `${esc(who)}: ready to update AniList`}</b>
    <small>${esc(summary)}</small></div>
    <button class="btn ghost" data-act="import-dismiss" data-svc="${esc(preview.service)}">Dismiss</button>
    <button class="btn accent" data-act="import-apply" data-svc="${esc(preview.service)}" ${!chosen ? "disabled" : ""}>Apply ${chosen} change${chosen === 1 ? "" : "s"}</button></div>
    ${pendingNudge}
    ${notes.map((note) => `<p class="hint-note">${esc(note)}</p>`).join("")}
    <div class="line tools"><button class="link" data-act="pick-all">Select all</button><button class="link" data-act="pick-none">Select none</button></div>
    <div class="changes">${list}</div></div>`;
}

function previewCard(imp) {
  const list = Array.isArray(imp?.previews) && imp.previews.length ? imp.previews : (imp?.preview ? [imp.preview] : []);
  return list.map((preview) => onePreviewCard(imp, preview)).join("");
}

function pendingCard(imp) {
  const items = imp?.pending || [];
  if (!items.length) return "";
  const count = imp.pendingCount || items.length;
  return `<section class="imp-group pending-group" id="needs-pick">
    <div class="imp-head"><h4>Needs your pick</h4><span class="pill">${count.toLocaleString()}</span></div>
    <p class="imp-about">History import found these titles but wasn’t sure which AniList show they are. Until you choose, their episodes stay out of AniList. Your pick is remembered for next time.</p>
    <ul class="imp-howto">
      <li><b>From Netflix / HIDIVE / …</b> is the title that service used — not AniList’s name yet.</li>
      <li><b>Suggested AniList titles</b> — tap <b>Use this show</b> on the match you watched.</li>
      <li><b>Paste link</b> if none fit, then <b>Confirm link</b>.</li>
      <li><b>Skip for now</b> leaves these episodes off AniList (site history stays).</li>
    </ul>
    <div class="stack">${items.map((item) => {
      const site = item.service ? sourceName(item.service) : "";
      const fromSite = `${item.series}${item.season && item.season !== item.series ? ` — ${item.season}` : ""}`;
      const ep = `${item.episodes} episode${item.episodes === 1 ? "" : "s"} waiting`;
      const hasChoices = Boolean(item.candidates?.length);
      return `<div class="panel pending" data-key="${esc(item.key)}">
      <p class="pending-label">From ${esc(site || "your service")}</p>
      <b class="pending-from">${esc(fromSite)}</b>
      <small class="muted pending-why">${esc(ep)}. ${esc(item.reason || "Couldn’t match this name for sure.")}</small>
      ${hasChoices ? `<p class="pending-label">Suggested AniList titles — tap the one you watched</p>
      <div class="choices">${item.candidates.map((c) => {
        // `title` is already English/romaji-first from the matcher; `english` holds the native alt when different.
        const name = c.title || c.english;
        const meta = [c.english && c.english !== c.title ? c.english : "", c.format, c.year, c.episodes ? `${c.episodes} eps` : ""].filter(Boolean).join(" · ");
        return `<button class="choice" type="button" data-act="pending-pick" data-id="${c.anilistId}" title="Use this AniList show">
          <b>${esc(name)}</b>${meta ? `<small>${esc(meta)}</small>` : ""}
          <span class="choice-act">Use this show</span>
        </button>`;
      }).join("")}</div>` : `<p class="pending-label">No close AniList suggestion — paste a link below, or skip</p>`}
      <p class="pending-label">Or paste an AniList anime link / id</p>
      <div class="line manual">
        <input class="field" placeholder="https://anilist.co/anime/…" aria-label="AniList anime link or id">
        <button class="btn accent" type="button" data-act="pending-manual" title="Map this service title to the AniList id you pasted">Confirm link</button>
        <button class="btn ghost" type="button" data-act="pending-skip" title="Don’t add these episodes to AniList">Skip for now</button>
      </div>
      <small class="hint pending-hint">Confirm link maps this service title to that AniList show and queues the episodes in your import preview. Skip for now ignores this batch only.</small>
    </div>`;
    }).join("")}</div>
  </section>`;
}

function choiceRow(label, about, key, choices, current, { disabled = false } = {}) {
  return `<div class="set-row${disabled ? " off" : ""}"><div class="grow"><b>${esc(label)}</b><small data-choice-about="${esc(key)}">${esc(about)}</small></div>
    <div class="seg">${choices.map(([value, text]) => `<button type="button" class="${current === value ? "on" : ""}" data-choice="${esc(key)}:${esc(value)}" ${disabled ? "disabled" : ""}>${esc(text)}</button>`).join("")}</div></div>`;
}

function autoRows(state, { needsAnilist = false } = {}) {
  const settings = state.settings || {};
  const sync = state.sync || {};
  const connected = new Set(state.connected || []);
  const netflixOn = connected.has("netflix");
  const hidiveOn = connected.has("hidive");
  const tubiOn = connected.has("tubi");
  const syncNote = sync.lastRun ? ` Last ran ${when(sync.lastRun)}.` : "";
  const mode = settings.dailySyncMode || (settings.dailySync ? (settings.syncApply ? "apply" : "preview") : "off");
  const trackingOn = Boolean(settings.trackWhileWatching || settings.trackNetflix || settings.trackHidive || settings.trackTubi);
  const trackSites = [
    {
      key: "trackNetflix",
      name: "Netflix",
      about: !netflixOn ? "Connect Netflix first." : sync.lastTrack ? `Last checked ${when(sync.lastTrack)}.` : "Updates AniList a couple of minutes after you finish an episode.",
      disabled: !netflixOn || needsAnilist,
    },
    {
      key: "trackHidive",
      name: "HIDIVE",
      about: !hidiveOn ? "Connect HIDIVE first." : "Updates AniList a couple of minutes after you finish an episode.",
      disabled: (!hidiveOn && !settings.trackHidive) || needsAnilist,
    },
    {
      key: "trackTubi",
      name: "Tubi",
      about: tubiOn ? "Updates AniList about a minute after you finish an anime episode." : "Connect Tubi first.",
      disabled: (!tubiOn && !settings.trackTubi) || needsAnilist,
    },
  ];
  return `<div class="panel">
    ${choiceRow("Daily sync", mode === "apply" ? `Once a day, reads the last few days of history on connected sites and sends changes straight to AniList.${syncNote}` : mode === "preview" ? `Once a day, reads the last few days of history on connected sites and leaves a preview to apply.${syncNote}` : `Daily catch-up is off.${syncNote}`, "dailySyncMode", [["off", "Off"], ["preview", "Preview"], ["apply", "Apply"]], mode, { disabled: needsAnilist })}
    ${settingSwitch({ ...settings, trackWhileWatching: trackingOn }, "trackWhileWatching", "Track while watching", "After you finish an episode on a connected site below, AniList is updated. Turn this off to pause every site at once.", { disabled: needsAnilist })}
    ${trackingOn ? trackSites.map((site) => settingSwitch(settings, site.key, site.name, site.about, { disabled: site.disabled })).join("") : ""}
    ${sync.lastResult && settings.dailySync ? `<small class="hint">${esc(sync.lastResult)}</small>` : ""}
    ${sync.trackResult ? `<small class="hint">${esc(sync.trackResult)}</small>` : ""}
  </div>`;
}

function serviceRows(state, { needsAnilist = false } = {}) {
  const imp = state;
  const connected = new Set(state.connected || []);
  const ready = new URLSearchParams(location.hash.split("?")[1] || "").get("ready");
  return SERVICES.map((service) => {
    const why = lockReason(imp, service.id, { needsAnilist });
    const locked = imp?.job?.running || Boolean(why);
    const on = connected.has(service.id) || service.id === "crunchyroll";
    const points = imp?.checkpoints?.[service.id] || [];
    const status = service.id === "hulu" ? "Coming later — Hulu isn't connectable yet."
      : service.untested ? "Not available yet."
      : service.tracks ? `${service.name} keeps no watch history to import. Turn on tracking under Automatic updates.${on ? "" : " Connect it first."}`
        : !service.imports ? `History import from ${service.name} is coming soon.`
          : !on ? "Not connected. Connect it under Where to watch."
            : points.length ? points.map(pointText).join(" ") : "Not imported yet. The first import reads your whole history.";
    return `<div class="panel${ready === service.id ? " ready" : ""}${service.untested ? " off" : ""}" data-row="${esc(service.id)}">
      <div class="line"><div class="grow"><b>${esc(service.name)}</b><small class="svc-status"> ${esc(status)}</small>${HOW[service.id] ? `<small class="hint">${esc(HOW[service.id])}</small>` : ""}</div>
        <span class="pill${on ? " on" : ""}">${on ? "Connected" : "Not connected"}</span></div>
      <div class="line actions">
        <a class="btn ghost" href="${esc(service.home)}" target="_blank" rel="noopener">Open</a>
        ${service.id === "netflix" ? `<label class="btn ghost${locked ? " disabled" : ""}">Upload file<input type="file" accept=".csv,text/csv" data-act="netflix-csv" hidden ${locked ? "disabled" : ""}></label>` : ""}
        <span class="grow"></span>
        ${service.untested || service.tracks || !service.imports ? `<button class="btn ghost" disabled>${service.tracks ? "Tracks as you watch" : "Not available"}</button>`
          : on ? `<button class="btn ghost" data-act="import-start" data-full="1" data-svc="${esc(service.id)}" ${locked ? "disabled" : ""}>Full rescan</button>
        <button class="btn accent" data-act="import-start" data-svc="${esc(service.id)}" ${locked ? "disabled" : ""}>Import history</button>` : ""}
      </div>
      ${why && service.imports ? `<small class="lock muted">${esc(why)}</small>` : ""}
      ${pastFold(imp, service.id)}
    </div>`;
  }).join("");
}

function listRows(state, { needsAnilist = false } = {}) {
  const why = lockReason(state, "", { needsAnilist });
  const locked = state?.job?.running || Boolean(state?.preview) || Boolean(why);
  return `<div class="panel"><div class="line"><div class="grow"><b>MyAnimeList</b><small>Upload the file from MyAnimeList's Export page (Anime list). The .gz download works as it is.</small></div></div>
      <div class="line actions"><a class="btn ghost" href="https://myanimelist.net/panel.php?go=export" target="_blank" rel="noopener">Open MAL export</a>
        <span class="grow"></span>
        <label class="btn accent${locked ? " disabled" : ""}">Upload list file<input type="file" accept=".xml,.gz,application/xml,text/xml,application/gzip" data-act="mal-file" hidden ${locked ? "disabled" : ""}></label></div>
      ${why ? `<small class="lock muted">${esc(why)}</small>` : ""}${pastFold(state, "mal")}</div>
    <div class="panel"><div class="line"><div class="grow"><b>Kitsu</b><small>Reads a public Kitsu library by username.</small></div></div>
      <div class="line actions"><a class="btn ghost" href="https://kitsu.app" target="_blank" rel="noopener">Open Kitsu</a>
        <input class="field" id="kitsu-name" placeholder="Kitsu username" ${locked ? "disabled" : ""}>
        <button class="btn accent" data-act="kitsu-import" ${locked ? "disabled" : ""}>Import from Kitsu</button></div>
      ${why ? `<small class="lock muted">${esc(why)}</small>` : ""}${pastFold(state, "kitsu")}</div>`;
}

const allRuns = (state) => (state?.log || []).filter((item) => item.service === "all");

function malApiRow(state, locked) {
  const mal = state.mal || {};
  const connected = Boolean(mal.connected);
  const configured = Boolean(mal.configured);
  const note = connected
    ? `Signed in as ${mal.name || "your MyAnimeList account"}.${mal.renewSoon ? " Sign in again soon." : ""}`
    : mal.expired ? "Your MyAnimeList sign-in expired. Connect again."
      : configured ? "Sign in for weekly library pull and optional write-back when you apply imports."
        : "Add an API client id from myanimelist.net/apiconfig, then connect.";
  const redirect = typeof chrome?.identity?.getRedirectURL === "function" ? chrome.identity.getRedirectURL() : "";
  return `<div class="panel stack">
    <div class="line"><div class="grow"><b>MyAnimeList account</b><small>${esc(note)}</small></div>
      <span class="pill${connected ? " on" : ""}">${connected ? "Connected" : mal.expired ? "Expired" : configured ? "Not connected" : "Needs client id"}</span>
      ${configured ? `<button class="btn ghost" data-act="${connected ? "mal-disconnect" : "mal-connect"}">${connected ? "Disconnect" : "Connect"}</button>` : ""}
    </div>
    <label class="field-row"><span>API client id</span>
      <input class="field" id="mal-client-id" type="text" autocomplete="off" spellcheck="false" placeholder="From myanimelist.net/apiconfig" value="">
      <button class="btn ghost" data-act="mal-client-save">Save</button></label>
    ${redirect ? `<small class="hint">Redirect URI for the MAL app: <code>${esc(redirect)}</code></small>` : ""}
    <small class="muted">File upload for one-off imports is below. This section is for OAuth and weekly pulls.</small>
  </div>`;
}

function trackerSyncRows(state, locked, { needsAnilist = false } = {}) {
  const settings = state.settings || {};
  const pullNote = state.sync?.trackerPullResult ? `<small class="hint">${esc(state.sync.trackerPullResult)}</small>` : "";
  const canPull = state.mal?.connected || state.kitsu?.connected;
  const off = locked || needsAnilist;
  return `<div class="panel">
    ${settingSwitch(settings, "weeklyTrackerPull", "Weekly tracker pull", "About once a week, pull connected MyAnimeList and Kitsu libraries into an Import preview for AniList.", { disabled: needsAnilist })}
    ${settingSwitch(settings, "writeMal", "Write to MyAnimeList", "When you apply imports or edit your list, also update MyAnimeList if it's connected. Never lowers progress.", { disabled: needsAnilist })}
    ${pullNote}
    ${canPull ? `<button class="btn ghost" data-act="tracker-pull" ${off ? "disabled" : ""}>Pull trackers now</button>` : ""}
  </div>`;
}

function importAllRow(state, { needsAnilist = false } = {}) {
  const why = lockReason(state, "all", { needsAnilist });
  const locked = state?.job?.running || Boolean(state?.preview) || Boolean(why);
  const connected = new Set(state.connected || []);
  connected.add("crunchyroll");
  const ready = SERVICES.filter((s) => s.imports && connected.has(s.id));
  const runs = allRuns(state);
  const about = ready.length
    ? `Reads ${ready.map((s) => s.name).join(", ")} one after another into one preview.`
    : "Connect a site under Where to watch first.";
  return `<div class="panel"><div class="line"><div class="grow"><b>Import all</b><small>${esc(about)}</small>
    ${runs.length ? `<small class="hint">Last run ${when(runs[0].at)}.</small>` : ""}</div>
    ${runs.length ? `<a class="btn ghost" href="#imports">Past runs <span class="pill">${runs.length}</span></a>` : ""}
    <button class="btn accent" data-act="import-all" ${locked || !ready.length ? "disabled" : ""}>Import all</button></div>
    ${why ? `<small class="lock muted">${esc(why)}</small>` : ""}</div>`;
}

export function renderImportsHistory(state) {
  const items = allRuns(state);
  const job = state?.job?.running && state.job.service === "all" ? jobCard(state.job) : "";
  return `<h1 class="page-title">Import all history</h1>
    <p class="page-sub"><a class="small-link" href="#settings/import">← Back to Import</a></p>
    <p class="page-sub">Every Import all run, and daily syncs that read more than one site. Single-site imports stay under that site in Import.</p>
    ${job ? `<div class="stack imp-status">${job}</div>` : ""}
    ${items.length ? `<div class="stack">${items.map((item) => logItem(item)).join("")}</div>`
      : `<div class="panel"><p class="muted">No Import all runs yet. Start one from <a href="#settings/import">Import</a>.</p></div>`}`;
}

export function renderImportPane(state, { anilistConnected = false } = {}) {
  const gated = !anilistConnected;
  const gate = { needsAnilist: gated };
  const status = [
    gated ? `<div class="panel info">Connect <a href="#settings/account">AniList under Account</a> to apply imports. You can still connect sites and browse this page; Apply and automatic updates stay off until AniList is connected.</div>` : "",
    state?.job?.error ? `<div class="panel warn">${esc(state.job.error)}</div>` : "",
    state?.job?.message && !state.job.running ? `<div class="panel info">${esc(state.job.message)}</div>` : "",
    jobCard(state?.job || {}),
    previewCard(state),
  ].join("");
  const pending = pendingCard(state);
  // Browse the full Import UI without AniList; apply / sync / tracking actions stay disabled.
  return `<div class="set-card"><h3>Import</h3><p>${gated
    ? "Bring watch history from streaming sites (and MAL/Kitsu) into AniList. Connect AniList under Account when you're ready to apply changes."
    : "AniList is connected — your list is already here. Use this page to import watch history from streaming sites (and MAL/Kitsu). Imports pick up where the last one stopped, and nothing changes on AniList until you apply the preview."}</p>
    ${status ? `<div class="stack imp-status">${status}</div>` : ""}
    ${pending}
    <h4 class="set-sub">Watch history from sites</h4>
    <div class="stack">${importAllRow(state, gate)}${serviceRows(state, gate)}</div>
    <h4 class="set-sub">Automatic updates</h4>
    ${autoRows(state, gate)}
    <h4 class="set-sub">Trackers (MAL &amp; Kitsu)</h4>
    <div class="stack">${malApiRow(state)}${trackerSyncRows(state, Boolean(state?.job?.running || state?.preview), gate)}</div>
    <h4 class="set-sub">Lists from other trackers</h4>
    <div class="stack">${listRows(state, gate)}</div>
    <p class="muted fold-foot">Sign-ins stay with each site. Titles with no anime match are skipped and counted.</p>
  </div>`;
}

function parseAnilistId(text) {
  const value = String(text || "").trim();
  const match = /anilist\.co\/anime\/(\d+)/i.exec(value) || /^(\d{1,7})$/.exec(value);
  return match ? Number(match[1]) : null;
}

export async function handleImportAct(act, target, { send, toast, refresh, confirm: ask = confirm } = {}) {
  const call = async (type, extra) => {
    const reply = await send(type, extra);
    if (reply?.ok) await refresh();
    else if (reply?.code !== "tab") toast(reply?.error || "That didn't work");
    return reply;
  };
  if (act === "import-all") {
    const needs = await send("importAllNeeds");
    const missing = needs?.ok ? needs.missing : [];
    if (missing.length) {
      const names = missing.map((id) => SERVICES.find((s) => s.id === id)?.name || id);
      if (ask(`Open ${names.join(", ")} in new tabs so they can be included?\n\nCancel to import only sites already open.`)) {
        await send("openSites", { services: missing });
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    const reply = await call("startImportAll");
    if (reply?.ok) toast("Import all started");
  } else if (act === "import-start") {
    const reply = await call("startImport", { service: target.dataset.svc, full: target.dataset.full === "1" });
    if (reply?.ok) toast("Import started");
    else if (reply?.code === "tab") {
      await send("openSite", { service: target.dataset.svc });
      toast(`Open ${target.dataset.svc} while signed in, then try again`);
    }
  } else if (act === "import-close" || act === "import-dismiss") {
    if (act === "import-dismiss" && !ask("Dismiss this preview? Your AniList stays as it is.")) return;
    await call("dismissImport", { service: target.dataset.svc || "" });
  } else if (act === "import-cancel") await call("cancelImport");
  else if (act === "import-apply") {
    const reply = await call("applyImport", { skip: [...skip], service: target.dataset.svc || "" });
    if (reply?.ok) toast(reply.result?.error ? `Stopped: ${reply.result.error}` : `Updated ${reply.result.applied} on AniList`);
  } else if (act === "import-undo") {
    if (!ask("Put these AniList entries back the way they were?")) return;
    const reply = await call("undoImport", { id: target.dataset.id });
    if (reply?.ok) toast(`Restored ${reply.result.restored}`);
  } else if (act === "pick-all") { skip = new Set(); await refresh(); }
  else if (act === "pick-none") {
    const reply = await send("importStatus");
    skip = new Set((reply?.preview?.changes || []).map((c) => c.anilistId));
    await refresh();
  } else if (act === "kitsu-import") {
    const username = document.querySelector("#kitsu-name")?.value?.trim();
    if (!username) return toast("Enter a Kitsu username");
    await call("importKitsu", { username });
  } else if (act === "pending-pick" || act === "pending-manual" || act === "pending-skip") {
    const card = target.closest("[data-key]");
    if (!card) return;
    let anilistId = null;
    if (act === "pending-pick") anilistId = Number(target.dataset.id);
    if (act === "pending-manual") {
      anilistId = parseAnilistId(card.querySelector("input.field")?.value);
      if (!anilistId) return toast("Paste an AniList anime link or its number");
    }
    await call("resolvePending", { key: card.dataset.key, anilistId: act === "pending-skip" ? null : anilistId });
  } else if (act === "netflix-csv" || act === "mal-file") {
    const file = target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await call(act === "netflix-csv" ? "importNetflixCsv" : "importMalFile", { text });
    target.value = "";
  } else if (act === "mal-client-save") {
    const clientId = document.querySelector("#mal-client-id")?.value?.trim();
    if (!clientId) return toast("Enter a MyAnimeList API client id");
    const reply = await send("setMalClientId", { clientId });
    if (reply?.ok) { await refresh(); toast("Client id saved"); }
    else toast(reply?.error || "Couldn't save client id");
  } else if (act === "mal-disconnect") {
    if (!ask("Disconnect MyAnimeList on this device?")) return;
    await call("disconnectMal");
    toast("MyAnimeList disconnected");
  } else if (act === "mal-connect") {
    const reply = await send("connectMal");
    if (reply?.ok) { await refresh(); toast("MyAnimeList connected"); }
    else toast(reply?.error || "MyAnimeList didn't connect");
  } else if (act === "tracker-pull") {
    const reply = await call("pullTrackers");
    if (reply?.ok) toast(reply.message || "Tracker pull finished");
  }
}

export function noteImportState(state) {
  const field = document.querySelector("#mal-client-id");
  if (field && document.activeElement !== field && state?.mal?.clientId) field.value = state.mal.clientId;
}

export function onImportToggle(event) {
  const fold = event.target.closest?.("details[data-past]");
  if (!fold) return;
  if (fold.open) openPast.add(fold.dataset.past);
  else openPast.delete(fold.dataset.past);
}

export function onImportPick(event) {
  const pick = event.target.closest?.("[data-pick]");
  if (!pick) return;
  const id = Number(pick.dataset.pick);
  if (pick.checked) skip.delete(id);
  else skip.add(id);
}
