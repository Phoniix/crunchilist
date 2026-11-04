// Guided setup: active guide character walks through AniList, sites, automatic updates, AI keys, then import.
import { TRACK_SITE_KEYS } from "../lib/settings.js";
import { PROVIDERS } from "../lib/providers.js";
import { SERVICES } from "../lib/services.js";
import { activeCharacterId, characterPortraitPath } from "../lib/guide.js";
import { characterById } from "../lib/characters.js";
import { guideBubbleHtml } from "./guide-bubble.js";

const STEPS = ["anilist", "sites", "autos", "ai", "import"];

const LINES = {
  anilist: "First stop — AniList. Without it I can’t sync your list, mark episodes, or apply imports.",
  sites: "Connect every service you actually watch. That’s how I find your history and keep Continue Watching honest.",
  autos: "These stay off until you opt in. Preview daily sync is the safe default — you review before AniList changes.",
  ai: "Chrome can rank on this PC with no key. A free cloud key makes Home picks and search mood ranking noticeably sharper.",
  import: "Last stop — pull history from the sites you connected. You’ll review a preview before anything hits AniList.",
  done: "You’re set. I’ll meet you on Home — your map’s ready when you are.",
};

const DAILY_ABOUT = {
  off: "No automatic catch-up. You’ll import by hand when you want.",
  preview: "Once a day I re-read recent history on connected sites and leave a preview for you. AniList stays unchanged until you tap Apply on that preview.",
  apply: "Once a day I re-read recent history and send matching updates straight to AniList — no review step.",
};

let m = null;
let step = 0;
let busy = "";
let sitesCache = [];
let importBusy = false;
let importDone = false;
let importJob = null;
let importNote = "";
let openedTabIds = [];
let importPoll = 0;

const share = (done, total) => (total ? Math.min(1, Math.max(0, done / total)) : 0);

function overallPercent(job) {
  if (!job?.sites?.length) return job?.total ? Math.round(share(job.done, job.total) * 100) : 0;
  if (job.phase === "matching") return Math.round(82 + share(job.done, job.total) * 6);
  if (job.phase === "anilist") return Math.round(88 + share(job.done, job.total) * 12);
  const finished = job.sites.filter((site) => site.state === "done" || site.state === "skipped").length;
  const current = job.sites.some((site) => site.state === "reading") ? (job.total ? share(job.done, job.total) : 0.4) : 0;
  return Math.round(((finished + current) / job.sites.length) * 80);
}

export function createWelcome() {
  return { render, after, handleAct, maybeOpen };
}

function settings() {
  return m?.settings?.() || {};
}

function esc(text) {
  return m.esc(text);
}

function guideWho() {
  const id = activeCharacterId(null, settings().favoriteCharacterId || "");
  const pack = characterById(id);
  return { name: pack?.name || "Kivi", portraitSrc: `../${characterPortraitPath(id)}` };
}

function kiviSay(text) {
  const who = guideWho();
  return guideBubbleHtml({
    text,
    name: who.name,
    portraitSrc: who.portraitSrc,
    layout: "tour",
  }, esc);
}

function stepShell(id, title, done, body) {
  const on = STEPS[step] === id;
  const line = LINES[id] || LINES.anilist;
  return `<section class="tour-step${on ? " on" : ""}${done ? " done" : ""}" data-step="${id}">
    <header class="tour-step-head"><span class="tour-num">${STEPS.indexOf(id) + 1}</span>
      <h3>${esc(title)}</h3>${done ? `<span class="pill on">Done</span>` : ""}</header>
    ${on ? `<div class="tour-step-main">
      ${kiviSay(line)}
      <div class="tour-step-body">${body}</div>
    </div>` : ""}
  </section>`;
}

function why(text) {
  return `<p class="tour-why">${esc(text)}</p>`;
}

function anilistBody() {
  const s = settings();
  const connected = Boolean(s.anilistConnected);
  return `${why("AniList is the list of record. Connect once so progress you mark here, imports you apply, and daily sync all write to the same account.")}
    <div class="tour-acts">
      ${connected
    ? `<span class="pill on">Connected as ${esc(s.anilistViewerName || "you")}</span>
         <button class="btn accent" type="button" data-act="tour-next">Next: connect sites</button>`
    : `<button class="btn accent" type="button" data-act="tour-anilist" ${busy === "anilist" ? "disabled" : ""}>${busy === "anilist" ? "Connecting…" : "Connect AniList"}</button>
         <button class="btn ghost" type="button" data-act="tour-next">Skip for now</button>`}
    </div>
    <p class="muted fold-foot">Need your own AniList app credentials? <button class="btn link" type="button" data-act="tour-anilist-advanced">Advanced setup</button></p>`;
}

function sitesBody() {
  const rows = (sitesCache.length ? sitesCache : SERVICES.filter((s) => !s.untested)).map((site) => {
    const connected = Boolean(site.connected ?? site.id === "crunchyroll");
    const required = site.required || site.id === "crunchyroll";
    const disabled = site.untested || site.id === "hulu";
    const blurb = required ? "Built in — catalog and Crunchyroll history work from here."
      : disabled ? "Not ready to connect yet."
        : connected
          ? (site.imports ? "Connected — history import and panels are available." : site.tracks ? "Connected — can track what you finish." : "Connected.")
          : site.imports ? "Connect so I can read watch history and import it."
            : site.tracks ? "Connect so I can notice episodes as you finish them."
              : "Connect for the on-site panel and where-to-watch links.";
    return `<div class="set-row${disabled && !connected ? " off" : ""}">
      <div class="grow"><b>${esc(site.name)}</b><small>${esc(blurb)}</small></div>
      ${required || disabled
    ? `<span class="pill${connected ? " on" : ""}">${required ? "Ready" : "Soon"}</span>`
    : connected
      ? `<button class="btn ghost" type="button" data-act="tour-disconnect-site" data-site="${esc(site.id)}" ${busy === `site:${site.id}` ? "disabled" : ""}">Disconnect</button>`
      : `<button class="btn accent" type="button" data-act="tour-connect-site" data-site="${esc(site.id)}" ${busy === `site:${site.id}` ? "disabled" : ""}">${busy === `site:${site.id}` ? "Connecting…" : "Connect"}</button>`}
    </div>`;
  }).join("");
  return `${why("Chrome will ask permission per site — only the ones you click. Skipping means no history import or tracking for that service.")}
    <div class="stack tour-sites">${rows || `<p class="muted">Loading sites…</p>`}</div>
    <div class="tour-acts">
      <button class="btn ghost" type="button" data-act="tour-back">Back</button>
      <button class="btn accent" type="button" data-act="tour-next">Next: automatic updates</button>
    </div>`;
}

function autosBody() {
  const s = settings();
  const mode = s.dailySyncMode || (s.dailySync ? (s.syncApply ? "apply" : "preview") : "off");
  const trackable = (sitesCache.length ? sitesCache : SERVICES).filter((site) => site.tracks || TRACK_SITE_KEYS[site.id]);
  const trackRows = trackable.filter((site) => site.connected || sitesCache.find((row) => row.id === site.id)?.connected).map((site) => {
    const key = TRACK_SITE_KEYS[site.id];
    if (!key) return "";
    const on = Boolean(s[key]);
    return `<div class="set-row"><div class="grow"><b>Track while watching on ${esc(site.name)}</b>
      <small>When you play an episode, Continue Watching jumps to that title so Home stays current. Nothing is written to AniList until you mark progress or apply an import.</small></div>
      <button class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}" data-act="tour-track" data-key="${key}" aria-label="Track ${esc(site.name)}"></button></div>`;
  }).filter(Boolean).join("");
  return `${why("Opt in only if you want the app to keep up without opening Import every time. You can change this later under Settings → Import & tracking.")}
    <div class="tour-block">
      <div class="set-row"><div class="grow"><b>Daily sync</b><small>About once a day, re-read the last few days of history on connected sites.</small></div>
        <div class="seg">${[["off", "Off"], ["preview", "Preview"], ["apply", "Apply"]].map(([v, l]) =>
    `<button type="button" class="${mode === v ? "on" : ""}" data-act="tour-daily" data-mode="${v}">${l}</button>`).join("")}</div></div>
      <p class="tour-detail"><b>${mode === "preview" ? "Preview (recommended)" : mode === "apply" ? "Apply" : "Off"}:</b> ${esc(DAILY_ABOUT[mode] || DAILY_ABOUT.off)}</p>
    </div>
    <div class="tour-block">
      <p class="tour-block-title">Track while watching</p>
      ${trackRows || `<p class="muted">Connect Netflix, HIDIVE, or Tubi in the previous step to turn this on for those sites.</p>`}
    </div>
    <div class="tour-acts">
      <button class="btn ghost" type="button" data-act="tour-back">Back</button>
      <button class="btn accent" type="button" data-act="tour-next">Next: AI (optional)</button>
    </div>`;
}

function aiBody() {
  const s = settings();
  const keys = s.keys || {};
  const rows = PROVIDERS.map((provider) => {
    const has = Boolean(keys[provider.id]);
    return `<div class="set-row tour-ai-row">
      <div class="grow"><b>${esc(provider.label)}${provider.free ? " · free tier" : " · paid"}</b>
        <small>${esc(provider.hint || "")}</small></div>
      ${has
    ? `<span class="pill on">Key saved</span><button class="btn ghost" type="button" data-act="tour-clear-key" data-id="${esc(provider.id)}">Remove key</button>`
    : `<a class="btn accent" href="${esc(provider.keyUrl)}" target="_blank" rel="noopener">Get a ${esc(provider.label)} key</a>
           <div class="tour-key">
             <input type="password" name="key" placeholder="Paste key here" autocomplete="off" aria-label="${esc(provider.label)} API key" data-key-for="${esc(provider.id)}">
             <button class="btn" type="button" data-act="tour-save-key" data-id="${esc(provider.id)}">Save key</button>
           </div>`}
    </div>`;
  }).join("");
  return `${why("Without a key, ranking still works with Chrome’s on-device model when available. Add a free key if you want stronger “Picked for you,” banner ranking, and mood search — your key stays on this device and only talks to that provider.")}
    <p class="tour-detail">Pick one free provider, open <b>Get a key</b>, create the key on their site, then paste it below and save. You can skip and use Chrome-only AI instead.</p>
    <div class="stack tour-ai">${rows}</div>
    <div class="tour-acts">
      <button class="btn ghost" type="button" data-act="tour-back">Back</button>
      <button class="btn accent" type="button" data-act="tour-next">Next: import history</button>
      <button class="btn ghost" type="button" data-act="tour-next">Skip AI</button>
    </div>`;
}

function importProgressHtml() {
  const job = importJob;
  if (!job && !importBusy && !importDone) return "";
  if (importDone && !job?.running) {
    const pct = 100;
    const label = importNote || job?.message || job?.error || "Import finished";
    return `<div class="tour-import-progress">
      <div class="line"><div class="grow"><b>${esc(label)}</b><small>100% · review any preview under Settings → Import when you’re ready</small></div></div>
      <div class="bar master"><span style="width:${pct}%"></span></div>
    </div>`;
  }
  if (!job) {
    return `<div class="tour-import-progress">
      <div class="line"><div class="grow"><b>Starting import…</b><small>Opening site tabs if needed</small></div></div>
      <div class="bar master"><span style="width:30%" class="spin"></span></div>
    </div>`;
  }
  const overall = job.running ? overallPercent(job) : 100;
  const label = job.running ? (job.note || "Working…") : (job.error || job.message || "Finished");
  const sites = Array.isArray(job.sites) ? job.sites : [];
  return `<div class="tour-import-progress">
    <div class="line"><div class="grow"><b>${esc(label)}</b><small>${overall}% overall</small></div>
      ${job.phase === "reading" ? `<button class="btn ghost" type="button" data-act="tour-import-cancel">Stop</button>` : ""}</div>
    <div class="bar master"><span style="width:${overall}%" class="${job.running && !job.total && !sites.length ? "spin" : ""}"></span></div>
    ${sites.length ? `<div class="site-bars">${sites.map((site) => {
    const reading = site.state === "reading" && job.phase === "reading";
    const width = site.state === "done" || site.state === "skipped" ? 100 : reading && job.total ? Math.round(share(job.done, job.total) * 100) : reading ? 30 : 0;
    const text = site.state === "waiting" ? "Waiting"
      : site.state === "skipped" ? `Skipped: ${site.note || ""}`
        : site.state === "done" ? (site.seen ? `${site.seen.toLocaleString()} new` : "Nothing new")
          : reading ? "Reading…" : "Queued";
    return `<div class="site-bar ${esc(site.state)}"><b>${esc(site.name)}</b>
        <div class="bar"><span style="width:${width}%" class="${reading && !job.total ? "spin" : ""}"></span></div>
        <small>${esc(text)}</small></div>`;
  }).join("")}</div>` : ""}
  </div>`;
}

function importBody() {
  const importable = (sitesCache || []).filter((site) => site.connected && site.imports);
  const list = importable.length
    ? importable.map((site) => `<div class="set-row"><div class="grow"><b>${esc(site.name)}</b><small>I’ll read watch history while you’re signed in on that site.</small></div>
        <span class="pill on">Ready</span></div>`).join("")
    : `<p class="muted">No importable sites connected yet. Finish setup, then connect sites and import from Settings whenever you’re ready.</p>`;

  if (importDone) {
    const canClose = openedTabIds.length > 0;
    return `${why("Catch-up is done. You can close the site tabs we opened for this import, then head to Home.")}
      ${importProgressHtml()}
      <div class="tour-acts">
        ${canClose
    ? `<button class="btn accent" type="button" data-act="tour-close-tabs-finish">Close opened tabs & finish</button>
             <button class="btn ghost" type="button" data-act="tour-finish">Finish & leave tabs open</button>`
    : `<button class="btn accent" type="button" data-act="tour-finish">Finish setup</button>`}
      </div>`;
  }

  return `${why("This is the big catch-up: seed Continue Watching and your library from real history. Results land as a preview — you choose what to apply to AniList.")}
    <p class="tour-warn"><b>Before you start:</b> we’ll open a tab for each connected site that isn’t ready yet. Switch to those tabs, sign in, and <b>pick the right profile</b> (Netflix, Prime, HIDIVE, etc.) so history can be read. Leave the tabs open while the import runs.</p>
    <div class="stack">${list}</div>
    ${importProgressHtml()}
    <div class="tour-acts">
      <button class="btn ghost" type="button" data-act="tour-back" ${importBusy ? "disabled" : ""}>Back</button>
      ${importable.length
    ? `<button class="btn accent" type="button" data-act="tour-import-all" ${importBusy ? "disabled" : ""}>${importBusy ? "Import running…" : "Import all connected sites"}</button>
         <button class="btn ghost" type="button" data-act="tour-finish" ${importBusy ? "disabled" : ""}>Skip import & finish</button>`
    : `<button class="btn accent" type="button" data-act="tour-finish">Finish setup</button>`}
    </div>`;
}

function doneFlags() {
  const s = settings();
  const connectedSites = (sitesCache || []).filter((site) => site.connected && site.id !== "crunchyroll").length;
  return {
    anilist: Boolean(s.anilistConnected),
    sites: connectedSites > 0 || Boolean(s.anilistConnected),
    autos: Boolean(s.dailySync || s.trackNetflix || s.trackHidive || s.trackTubi),
    ai: Boolean(s.hasKey),
    import: false,
  };
}

function render(api) {
  m = api;
  const flags = doneFlags();
  const bodies = {
    anilist: anilistBody,
    sites: sitesBody,
    autos: autosBody,
    ai: aiBody,
    import: importBody,
  };
  return `<section class="tour">
    <h1 class="page-title">Guided setup</h1>
    <p class="page-sub">Kivi walks you through the opt-ins that make the app feel complete. Skip anything — you can change it later in Settings.</p>
    <div class="tour-steps">
      ${stepShell("anilist", "Connect AniList", flags.anilist, bodies.anilist())}
      ${stepShell("sites", "Connect the sites you watch", flags.sites && step > 0, bodies.sites())}
      ${stepShell("autos", "Opt in to automatic updates", flags.autos && step > 1, bodies.autos())}
      ${stepShell("ai", "Optional: sharper AI with a free key", flags.ai && step > 2, bodies.ai())}
      ${stepShell("import", "Import history from connected sites", false, bodies.import())}
    </div>
  </section>`;
}

async function after(_page, api) {
  m = api;
  if (document.body.dataset.page !== "welcome") return;
  await refreshSites();
  const body = document.querySelector(".tour-step.on .tour-step-body");
  if (!body) return;
  if (STEPS[step] === "sites") body.innerHTML = sitesBody();
  else if (STEPS[step] === "autos") body.innerHTML = autosBody();
  else if (STEPS[step] === "import") body.innerHTML = importBody();
}

function stopImportPoll() {
  clearTimeout(importPoll);
  importPoll = 0;
}

async function pollImport() {
  stopImportPoll();
  const reply = await m.send("importStatus");
  if (reply?.ok) importJob = reply.job || null;
  const running = Boolean(importJob?.running);
  if (!running && importBusy) {
    importBusy = false;
    importDone = true;
    importNote = importJob?.error || importJob?.message || (importJob?.phase === "preview" ? "Finished — a preview is ready to review." : "Import finished.");
    m.toast(importNote);
  }
  rerender();
  if (running || (importBusy && !importDone)) {
    importPoll = setTimeout(() => pollImport().catch(() => {}), 900);
  }
}

async function refreshSites() {
  if (!m?.send) return;
  const reply = await m.send("siteConnections");
  if (reply?.ok) sitesCache = reply.sites || [];
}

function rerender() {
  m?.rerender?.(true);
}

async function handleAct(act, target, event) {
  if (!act?.startsWith("tour-")) return false;
  event?.preventDefault?.();
  if (act === "tour-next") {
    step = Math.min(step + 1, STEPS.length - 1);
    rerender();
    return true;
  }
  if (act === "tour-back") {
    step = Math.max(step - 1, 0);
    rerender();
    return true;
  }
  if (act === "tour-anilist-advanced") {
    await m.send("openOptions");
    return true;
  }
  if (act === "tour-anilist") {
    busy = "anilist";
    rerender();
    const reply = await m.send("startAnilistOneClick");
    busy = "";
    if (!reply?.ok) {
      m.toast(reply?.error || "AniList sign-in didn't finish");
      rerender();
      return true;
    }
    if (reply.view) m.applyView?.(reply.view);
    m.toast(reply.viewerName ? `Connected as ${reply.viewerName}` : "AniList connected");
    step = Math.min(step + 1, STEPS.length - 1);
    rerender();
    return true;
  }
  if (act === "tour-connect-site" || act === "tour-disconnect-site") {
    const id = target.dataset.site;
    busy = `site:${id}`;
    rerender();
    const type = act === "tour-connect-site" ? "connectSite" : "disconnectSite";
    const reply = await m.send(type, { service: id });
    busy = "";
    if (!reply?.ok) m.toast(reply?.error || "Couldn't update that site");
    if (act === "tour-connect-site" && reply?.ok) {
      const opened = await m.send("openSite", { service: id });
      if (opened?.ok) m.toast(`Opened ${id}. Stay signed in, then come back.`);
    }
    await refreshSites();
    rerender();
    return true;
  }
  if (act === "tour-track") {
    const key = target.dataset.key;
    const on = !target.classList.contains("on");
    await m.setSettings?.({ [key]: on });
    rerender();
    return true;
  }
  if (act === "tour-daily") {
    await m.setSettings?.({ dailySyncMode: target.dataset.mode });
    rerender();
    return true;
  }
  if (act === "tour-save-key") {
    const id = target.dataset.id;
    const key = document.querySelector(`input[data-key-for="${CSS.escape(id)}"]`)?.value?.trim() || "";
    if (!key) {
      m.toast("Paste an API key first");
      return true;
    }
    await m.setSettings?.({ providerKey: { id, key } });
    m.toast("Key saved");
    rerender();
    return true;
  }
  if (act === "tour-clear-key") {
    await m.setSettings?.({ providerKey: { id: target.dataset.id, key: "" } });
    rerender();
    return true;
  }
  if (act === "tour-import-all") {
    importBusy = true;
    importDone = false;
    importJob = null;
    importNote = "";
    openedTabIds = [];
    rerender();
    const needs = await m.send("importAllNeeds");
    const missing = needs?.ok ? needs.missing : [];
    if (missing.length) {
      m.toast(`Opening ${missing.length} site tab${missing.length === 1 ? "" : "s"} — pick profiles, then come back.`);
      const opened = await m.send("openSites", { services: missing });
      if (opened?.ok && Array.isArray(opened.tabIds)) openedTabIds = opened.tabIds;
      await new Promise((r) => setTimeout(r, 4500));
    }
    const reply = await m.send("startImportAll");
    if (!reply?.ok) {
      importBusy = false;
      importDone = false;
      m.toast(reply?.error || "Import couldn't start");
      rerender();
      return true;
    }
    importJob = reply.job || null;
    m.toast("Import started — keep site tabs open and profiles selected.");
    pollImport().catch(() => {});
    return true;
  }
  if (act === "tour-import-cancel") {
    await m.send("cancelImport");
    importBusy = false;
    importDone = true;
    importNote = "Import stopped.";
    stopImportPoll();
    rerender();
    return true;
  }
  if (act === "tour-close-tabs-finish") {
    if (openedTabIds.length) {
      const reply = await m.send("closeTabs", { tabIds: openedTabIds });
      if (reply?.ok) m.toast(reply.closed ? `Closed ${reply.closed} tab${reply.closed === 1 ? "" : "s"}.` : "Those tabs were already closed.");
    }
    openedTabIds = [];
    await finish();
    return true;
  }
  if (act === "tour-finish") {
    await finish();
    return true;
  }
  return false;
}

async function finish() {
  stopImportPoll();
  await m.setSettings?.({ setupDone: true });
  m.toast?.(LINES.done);
  location.hash = "#";
  step = 0;
  importBusy = false;
  importDone = false;
  importJob = null;
  importNote = "";
  openedTabIds = [];
}

async function resetSetupFlag() {
  await m.setSettings?.({ setupDone: false });
  step = 0;
  importBusy = false;
  importDone = false;
  importJob = null;
  importNote = "";
  openedTabIds = [];
  stopImportPoll();
  if (location.hash !== "#welcome") location.hash = "#welcome";
  return true;
}

async function maybeOpen(api) {
  m = api;
  // Explicit replay only — never hijack Home on every load.
  if (/#welcome\?reset\b/.test(location.hash)) {
    await resetSetupFlag();
    return true;
  }
  // Mark setup complete when leaving the incomplete auto-tour state, unless already on the tour.
  if (!settings().setupDone && !location.hash.startsWith("#welcome")) {
    await m.setSettings?.({ setupDone: true });
  }
  return false;
}
