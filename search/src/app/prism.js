// Prism, the Crunchilist look, for Crunchilist Search: Home, Browse, Airing, My list, show pages and Search.
// Catalog/title data from AniList + local feeds. Favorite-character text lines are a local mockup (optional later AI).
import { serviceById, serviceForSite, visibleLink } from "../lib/services.js";

let ctx = { send: async () => ({ ok: false }), toast: () => {}, state: () => ({}) };
const byId = new Map();
let homeData = null;
let homeLoading = null;
let list = { connected: false, entries: {}, shows: [], loaded: false };
let options = null;

const PALETTES = [
  { id: "ember", name: "Ember", colors: ["#ff7a2f", "#ffb347"] },
  { id: "midnight", name: "Midnight", colors: ["#8b7bff", "#4fd1ff"] },
  { id: "sakura", name: "Sakura", colors: ["#ff6fa5", "#ffc2d4"] },
  { id: "matcha", name: "Matcha", colors: ["#8be05f", "#ecd56b"] },
  { id: "ocean", name: "Ocean", colors: ["#2ed3c6", "#6aa8ff"] },
  { id: "mono", name: "Mono", colors: ["#f5f5f5", "#555555"] },
];
const STATUS = { CURRENT: "Watching", PLANNING: "Plan to watch", COMPLETED: "Completed", PAUSED: "Paused", DROPPED: "Dropped" };
const icons = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  rows: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
};
export const icon = (name, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ""}</svg>`;
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cssUrl = (url) => esc(String(url || "").replace(/["'()\\\s]/g, (c) => encodeURIComponent(c)));
const score = (show) => (show.score ? (show.score / 10).toFixed(1) : "–");
const eps = (show) => (show.episodes ? `${show.episodes} eps` : show.status === "RELEASING" ? "Ongoing" : show.format === "MOVIE" ? "Movie" : "–");
const formatName = (show) => ({ TV: "Series", TV_SHORT: "Short series", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "Web series", MUSIC: "Music" })[show.format] || "Series";
const titleCase = (word) => (word ? `${word[0]}${word.slice(1).toLowerCase()}` : "");
const clip = (text, max) => {
  const value = String(text || "");
  if (value.length <= max) return value;
  const cut = value.lastIndexOf(" ", max);
  return `${value.slice(0, cut > 0 ? cut : max)}…`;
};
const artOf = (show) => show.banner || show.cover || "";
const posterImg = (show, cls = "") => (show.cover
  ? `<img class="${cls}" src="${esc(show.cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
  : `<span class="ph ${cls}">${esc((show.title || "?")[0].toUpperCase())}</span>`);
const remember = (shows) => { for (const show of shows || []) if (show?.id) byId.set(show.id, { ...byId.get(show.id), ...show }); return shows || []; };

// List state
const entryOf = (show) => list.entries[show?.id];
const statusOf = (show) => { const status = entryOf(show)?.status; return status === "REPEATING" ? "CURRENT" : status; };
const inStatus = (status) => list.shows.filter((show) => statusOf(show) === status).map((show) => byId.get(show.id) || show);

// Where to watch: sites switched off in Settings are left out (unless connected); connected services come first.
const connectedSites = () => (ctx.state().connected || []).map((id) => serviceById(id)?.name).filter(Boolean);
const isMine = (site) => (ctx.state().connected || []).includes(serviceForSite(site)?.id);
const visible = (link) => visibleLink(link.site, ctx.state().settings?.hiddenSites || []);
// Links confirmed by a catalog or your history come first, then other connected services.
function sources(show) {
  const known = (link) => Boolean(link.checked || link.seen);
  return (show.streaming || []).filter(visible).sort((a, b) => known(b) - known(a) || isMine(b.site) - isMine(a.site));
}
function whereNote(link) {
  const site = esc(link.site);
  const id = serviceForSite(link.site)?.id;
  const catalogued = id === "crunchyroll" || id === "hidive" || id === "tubi";
  if (link.checked && link.seen) return catalogued ? `In your ${site} catalog · you've watched it there` : `Listed on ${site} · you've watched it there`;
  if (link.checked) return catalogued ? `In your ${site} catalog · opens in a new tab` : `Listed on ${site} · opens in a new tab`;
  if (link.seen) return `You've watched it on ${site} · opens in a new tab`;
  return isMine(link.site) ? "Connected · opens in a new tab" : "Opens in a new tab";
}

// "On my services": Home and Browse keep to shows in your services' catalogs or your watch history on any service. Kept on this device.
const MINE_KEY = "cs-mine";
let mineOnly = localStorage.getItem(MINE_KEY) === "1";
const catalogNames = () => ctx.state().mineServices || [];
const mineActive = () => mineOnly && catalogNames().length > 0;
function mineChips() {
  const names = catalogNames();
  if (!names.length) return "";
  return `<button class="chip ${mineActive() ? "" : "on"}" data-mine="false">Everything</button><button class="chip ${mineActive() ? "on" : ""}" data-mine="true" title="Shows on or watched on ${esc(names.join(", "))}">On my services</button>`;
}
export function catalogsChanged() {
  homeData = null;
  details.clear();
  search.key = "";
}
const noLinks = (show) => (show.streaming?.length ? "Only on sites you've hidden in Settings." : "AniList doesn't list a streaming site for this one.");
const brand = (link) => link.color || "#8a7b71";
function watchButton(show, cls = "btn sm accent") {
  const link = sources(show)[0];
  if (!link) return `<a class="${cls.replace("accent", "")}" href="#show/${esc(show.id)}">Details</a>`;
  return `<a class="${cls}" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${icon("play")} ${esc(link.site)}</a>`;
}

function statusBadge(show) {
  const status = statusOf(show);
  return status ? `<span class="badge">${esc(STATUS[status])}</span>` : show.status === "RELEASING" ? '<span class="badge">Airing</span>' : "";
}
function meter(show) {
  const item = entryOf(show);
  if (statusOf(show) !== "CURRENT" || !show.episodes) return "";
  return `<div class="meter"><i style="width:${Math.min(100, (item.progress / show.episodes) * 100)}%"></i></div>`;
}
function listButton(show, cls = "btn sm icon") {
  if (!list.connected) return "";
  const status = statusOf(show);
  return `<button class="${cls}" data-act="toggle" data-show="${esc(show.id)}" title="${status ? `${STATUS[status]}. Click to remove` : "Add to Plan to watch"}">${icon(status ? "check" : "plus")}</button>`;
}

// Cards
function card(show, opts = {}) {
  remember([show]);
  const rank = opts.rank ? `<span class="rank-num">${opts.rank}</span>` : "";
  const peek = `<div class="peek">
      <div class="peek-art" style="background-image:url('${cssUrl(artOf(show))}')"></div>
      <div class="peek-body">
        <h4>${esc(show.title)}</h4>
        <div class="peek-meta"><span class="star">★ ${score(show)}</span>${show.year ? `<span>${show.year}</span>` : ""}<span>${eps(show)}</span></div>
        ${show.about ? `<p>${esc(clip(show.about, 220))}</p>` : ""}
        <div class="peek-tags">${show.genres.slice(0, 3).map((g) => `<span>${esc(g)}</span>`).join("")}</div>
        <div class="peek-actions">${watchButton(show)}${listButton(show)}<a class="btn sm ghost" href="#show/${esc(show.id)}">Details</a></div>
      </div>
    </div>`.replace(/<(button|a) /g, '<$1 tabindex="-1" ');
  return `<div class="card${opts.rank ? " ranked" : ""}" data-show="${esc(show.id)}" tabindex="0" role="link" aria-label="${esc(show.title)}">
    ${rank}
    <div class="poster">${posterImg(show)}${statusBadge(show)}${meter(show)}</div>
    ${peek}
    <div class="cap"><div class="title">${esc(show.title)}</div><div class="sub">${esc(show.genres[0] || formatName(show))} · ${eps(show)}</div></div>
  </div>`;
}
function wide(show) {
  const item = entryOf(show);
  const next = Math.min((item?.progress || 0) + 1, show.episodes || Infinity);
  const play = sources(show)[0];
  // Continue watching opens the service when we have a watch URL; otherwise the show page.
  if (play?.url) {
    return `<a class="wide" href="${esc(play.url)}" target="_blank" rel="noopener noreferrer" title="Continue on ${esc(play.site)}" aria-label="Continue ${esc(show.title)} on ${esc(play.site)}">
      <div class="wide-art">${artOf(show) ? `<img src="${esc(artOf(show))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}<div class="wide-play">${icon("play")}</div>
        <div class="wide-copy"><b>${esc(show.title)}</b><small>Episode ${next}${show.episodes ? ` of ${show.episodes}` : ""} · ${esc(play.site)}</small>${meter(show)}</div>
      </div>
    </a>`;
  }
  return `<div class="wide" data-show="${esc(show.id)}" tabindex="0" role="link" aria-label="${esc(show.title)}">
    <div class="wide-art">${artOf(show) ? `<img src="${esc(artOf(show))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}<div class="wide-play">${icon("play")}</div>
      <div class="wide-copy"><b>${esc(show.title)}</b><small>Episode ${next}${show.episodes ? ` of ${show.episodes}` : ""}</small>${meter(show)}</div>
    </div>
  </div>`;
}
function rail(title, items, opts = {}) {
  if (!items.length) return "";
  const render = opts.render || ((show, i) => card(show, { rank: opts.ranked && i < 10 ? i + 1 : 0 }));
  return `<section class="row">
    <div class="row-head"><h2>${title}</h2>${opts.sub ? `<span class="muted">${opts.sub}</span>` : ""}${opts.href === false ? "" : `<a href="${opts.href || "#browse"}">See all</a>`}</div>
    <div class="rail-wrap">
      <button class="rail-arrow prev" data-act="rail-prev" aria-label="Scroll ${esc(title)} left" tabindex="-1">${icon("left")}</button>
      <div class="rail">${items.map(render).join("")}</div>
      <button class="rail-arrow next" data-act="rail-next" aria-label="Scroll ${esc(title)} right" tabindex="-1">${icon("right")}</button>
    </div>
  </section>`;
}
const loadingPage = (text = "Loading from AniList…") => `<div class="loading"><span class="spinner"></span><p class="muted">${esc(text)}</p></div>`;
const errorPage = (text) => `<div class="empty"><h1 class="page-title">AniList didn't answer</h1><p class="muted">${esc(text || "Check your connection and try again.")}</p><button class="btn accent" data-act="retry">Try again</button></div>`;

// Theme: palette, light or dark, and card size, kept on this device.
const THEME_KEY = "cs-theme";
let theme = { palette: "ember", mode: "dark", size: "m" };
function loadTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY)) || {};
    const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
    theme = { palette: pick(saved.palette, PALETTES.map((p) => p.id), "ember"), mode: pick(saved.mode, ["light", "dark", "system"], "dark"), size: pick(saved.size, ["s", "m", "l"], "m") };
  } catch { /* defaults */ }
}
export function applyTheme() {
  const root = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  root.dataset.palette = theme.palette;
  root.dataset.mode = theme.mode === "system" ? system : theme.mode;
  root.dataset.size = theme.size;
  localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  document.querySelectorAll("[data-set-palette]").forEach((el) => el.classList.toggle("on", el.dataset.setPalette === theme.palette));
  document.querySelectorAll("[data-set-mode]").forEach((el) => el.classList.toggle("on", el.dataset.setMode === theme.mode));
  document.querySelectorAll("[data-set-size]").forEach((el) => el.classList.toggle("on", el.dataset.setSize === theme.size));
  document.querySelectorAll(".theme-tile").forEach((el) => { el.dataset.mode = root.dataset.mode; });
}
export function appearanceBody() {
  return `<div class="themes">${PALETTES.map((p) => `<button class="theme-tile" data-set-palette="${p.id}" data-palette="${p.id}" data-mode="dark">
      <div class="theme-prev"><i></i><i></i><i></i></div><div class="theme-name">${p.name}<span>${p.colors.map((c) => `<i style="background:${c}"></i>`).join("")}</span></div></button>`).join("")}</div>
    <div class="set-row"><div class="grow"><b>Mode</b><small>Auto follows your system</small></div><div class="seg"><button data-set-mode="light">Light</button><button data-set-mode="dark">Dark</button><button data-set-mode="system">Auto</button></div></div>
    <div class="set-row"><div class="grow"><b>Card size</b></div><div class="seg"><button data-set-size="s">Small</button><button data-set-size="m">Medium</button><button data-set-size="l">Large</button></div></div>`;
}
function themePop() {
  return `<div class="pop" id="theme-pop"><h4>Theme</h4>
    <div class="swatches">${PALETTES.map((p) => `<button class="swatch" title="${p.name}" data-set-palette="${p.id}" style="background:linear-gradient(135deg,${p.colors[0]},${p.colors[1]})"></button>`).join("")}</div>
    <h4>Mode</h4><div class="seg"><button data-set-mode="light">Light</button><button data-set-mode="dark">Dark</button><button data-set-mode="system">Auto</button></div>
    <a href="#settings">More settings →</a></div>`;
}

export function nav() {
  return `<nav class="nav">
    <a class="brand" href="#"><img class="brand-logo" src="../icons/crunchilist-logo.svg" alt=""><span class="brand-word">Crunchilist<small>Search</small></span></a>
    <a class="nav-link" data-route="home" href="#">${icon("home")}<span>Home</span></a>
    <a class="nav-link" data-route="browse" href="#browse">${icon("compass")}<span>Browse</span></a>
    <a class="nav-link" data-route="airing" href="#airing">${icon("calendar")}<span>Airing</span></a>
    <a class="nav-link" data-route="list" href="#list">${icon("list")}<span>My list</span></a>
    <span class="nav-spacer"></span>
    <div class="kbar-group"><div class="kbar" data-act="kpal" role="button" tabindex="0" aria-label="Search">${icon("search")}<span class="kbar-text">Search titles…</span><kbd>Ctrl K</kbd></div></div>
    <button class="nav-btn nav-search" data-act="kpal" aria-label="Search">${icon("search")}</button>
    <button class="nav-btn" data-act="theme" title="Theme" aria-label="Theme">${icon("palette")}</button>
    <a class="nav-btn" data-route="settings" href="#settings" title="Settings" aria-label="Settings">${icon("gear")}</a>
    <a class="nav-btn profile-btn" href="#settings" title="Accounts" data-avatar></a>
  </nav>${themePop()}`;
}
export function paintAvatar() {
  const box = document.querySelector("[data-avatar]");
  if (!box) return;
  const { connected, name, avatar } = ctx.state().anilist || {};
  box.innerHTML = connected && avatar ? `<img class="avatar" src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${esc((connected && name ? name[0] : "?").toUpperCase())}</span>`;
  box.title = connected ? `AniList: ${name}` : "Connect AniList in Settings";
  // My list only means something once AniList is connected.
  document.querySelector('.nav-link[data-route="list"]')?.toggleAttribute("hidden", !connected);
}

// Home
async function loadHome(force = false) {
  if (homeData && !force && homeData.mine === mineActive()) return homeData;
  const mine = mineActive();
  homeLoading ||= ctx.send("homeRows", { mine }).then((reply) => {
    homeLoading = null;
    if (!reply?.ok) throw new Error(reply?.error || "AniList didn't answer");
    homeData = { ...reply, mine };
    for (const key of ["trending", "thisSeason", "airing", "popular", "top"]) remember(reply[key]);
    return reply;
  }, (error) => { homeLoading = null; throw error; });
  return homeLoading;
}
function characterBanner() {
  const line = ctx.state().lines?.welcome;
  const fav = ctx.state().favorite;
  if (!line?.text || !fav?.name) return "";
  return `<aside class="char-banner" aria-label="Welcome from ${esc(fav.name)}">
    <div class="char-who"><b>${esc(fav.name)}</b><small>${esc(fav.show)}</small></div>
    <p>${esc(line.text)}</p>
    <a class="char-edit" href="#settings/character">Change</a>
  </aside>`;
}

function pageHome() {
  if (!homeData || homeData.mine !== mineActive()) return loadingPage();
  const spots = homeData.trending.filter((show) => show.banner).slice(0, 12);
  hero.ids = spots.map((show) => show.id);
  const { season, year } = homeData.season;
  return `${spots.length ? `<section class="hero">
      <div class="hero-bg"></div><div class="hero-video"></div>
      <div class="hero-copy"></div>
      <div class="hero-nav"><div class="hero-bars"><div class="hero-page on">${spots.map((show, i) => `<button class="hero-bar" data-act="hero" data-i="${i}" aria-label="${esc(show.title)}"><i></i>
        <span class="hero-tip"><span style="background-image:url('${cssUrl(artOf(show))}')"></span><b>${esc(show.title)}</b></span></button>`).join("")}</div></div></div>
    </section>` : ""}
    ${characterBanner()}
    ${mineChips() ? `<div class="search-tools home-tools">${mineChips()}</div>` : ""}
    ${rail("Continue watching", inStatus("CURRENT"), { render: wide, href: "#list/CURRENT" })}
    ${rail("Trending now", homeData.trending.slice(0, 10), { ranked: true, sub: "Most watched on AniList this week", href: "#browse?sort=trending" })}
    ${rail(`${titleCase(season)} ${year}`, homeData.thisSeason, { sub: "Popular this season", href: "#browse?when=now" })}
    ${rail("Airing now", homeData.airing, { href: "#airing" })}
    ${rail("Your plan to watch", inStatus("PLANNING"), { href: "#list/PLANNING" })}
    ${rail("All-time popular", homeData.popular, { href: "#browse?sort=popular" })}
    ${rail("Highest rated", homeData.top, { href: "#browse?sort=rated" })}`;
}

const hero = { ids: [], slide: 0, timer: 0, running: false, left: 0, clock: 0 };
const SLIDE_MS = 9000;
function heroCopy(show) {
  const status = statusOf(show);
  const n = String(show.title).length;
  const size = n > 70 ? "xl" : n > 44 ? "l" : n > 26 ? "m" : "";
  return `<div class="hero-tag"><i></i>Trending #${hero.ids.indexOf(show.id) + 1} on AniList</div>
    <h1${size ? ` data-size="${size}"` : ""} title="${esc(show.title)}">${esc(show.title)}</h1>
    <div class="peek-meta"><span class="star">★ ${score(show)}</span>${show.year ? `<span>${show.year}</span>` : ""}<span>${eps(show)}</span>${show.genres.length ? `<span>${esc(show.genres.slice(0, 3).join(" · "))}</span>` : ""}</div>
    ${show.about ? `<p>${esc(show.about)}</p>` : ""}
    <div class="peek-actions">${watchButton(show, "btn accent")}
      <button class="btn" data-act="toggle" data-show="${esc(show.id)}">${icon(status ? "check" : "plus")} ${status ? STATUS[status] : "My list"}</button><a class="btn" href="#show/${esc(show.id)}">Details</a></div>`;
}
function showSlide(i) {
  const box = document.querySelector(".hero");
  if (!box || !hero.ids.length) return;
  hero.slide = (i + hero.ids.length) % hero.ids.length;
  const show = byId.get(hero.ids[hero.slide]);
  const old = [...box.querySelectorAll(".hero-bg:not(.out)")];
  const next = document.createElement("div");
  next.className = "hero-bg";
  next.style.backgroundImage = `url("${String(artOf(show)).replace(/["'()\\\s]/g, (c) => encodeURIComponent(c))}")`;
  (old.at(-1) || box.querySelector(".hero-video")).insertAdjacentElement(old.length ? "afterend" : "beforebegin", next);
  void next.offsetWidth;
  next.classList.add("on");
  for (const layer of old) { layer.classList.add("out"); setTimeout(() => layer.remove(), 1300); }
  const copy = box.querySelector(".hero-copy");
  copy.style.animation = "none"; void copy.offsetWidth; copy.style.animation = "";
  copy.innerHTML = heroCopy(show);
  box.querySelectorAll(".hero-bar").forEach((bar, n) => {
    bar.classList.remove("on", "done", "paused"); void bar.offsetWidth;
    bar.classList.toggle("done", n < hero.slide);
    bar.classList.toggle("on", n === hero.slide);
    bar.style.setProperty("--dur", `${SLIDE_MS / 1000}s`);
  });
  setAmbient(artOf(show));
  clearTimeout(hero.timer);
  hero.left = SLIDE_MS;
  if (hero.running) startHero();
}
function startHero() {
  hero.clock = Date.now();
  hero.timer = setTimeout(() => showSlide(hero.slide + 1), hero.left);
}
function syncHero(inView = true) {
  const box = document.querySelector(".hero");
  const run = Boolean(box) && inView && !document.hidden;
  if (run === hero.running) return;
  hero.running = run;
  box?.querySelector(".hero-bar.on")?.classList.toggle("paused", !run);
  if (run) startHero();
  else { clearTimeout(hero.timer); hero.left = Math.max(0, hero.left - (Date.now() - hero.clock)); }
}
const heroWatch = new IntersectionObserver(([seen]) => syncHero(seen.intersectionRatio >= 0.35), { threshold: [0, 0.35, 1] });

let ambientFlip = false;
function setAmbient(url) {
  const layers = document.querySelectorAll(".ambient i");
  if (!url || !layers.length || layers[ambientFlip ? 1 : 0].dataset.url === url) return;
  ambientFlip = !ambientFlip;
  const next = layers[ambientFlip ? 1 : 0];
  next.dataset.url = url;
  next.style.backgroundImage = `url("${String(url).replace(/["'()\\\s]/g, (c) => encodeURIComponent(c))}")`;
  next.classList.add("on");
  layers[ambientFlip ? 0 : 1].classList.remove("on");
}

// Grids: AniList pages of 40 load as the end of the grid comes into view.
let gridObserver = null;
function mountPagedGrid(target, first, loadPage) {
  gridObserver?.disconnect();
  target.innerHTML = '<div class="grid"></div><div class="grid-more" aria-hidden="true"></div>';
  const gridEl = target.firstElementChild;
  const more = target.lastElementChild;
  let page = 1;
  let busy = false;
  const add = (shows, hasMore) => {
    gridEl.insertAdjacentHTML("beforeend", remember(shows).map((show) => card(show)).join(""));
    more.hidden = !hasMore;
    if (!hasMore) gridObserver?.disconnect();
  };
  add(first.shows, first.more);
  if (!first.more) return;
  gridObserver = new IntersectionObserver(async (seen) => {
    if (busy || !seen.some((row) => row.isIntersecting)) return;
    busy = true;
    const next = await loadPage(page + 1);
    busy = false;
    if (!target.isConnected) return gridObserver?.disconnect();
    if (!next) return;
    page += 1;
    add(next.shows, next.more);
  }, { rootMargin: "0px 0px 1200px 0px" });
  gridObserver.observe(more);
}
function mountGrid(target, items) {
  gridObserver?.disconnect();
  target.innerHTML = `<div class="grid">${items.map((show) => card(show)).join("")}</div>`;
}

// Browse
const BROWSE_DEFAULT = { genre: "", when: "", status: "", length: "", format: "", sort: "popular", hideSeen: false, tags: [], without: [] };
let browse = { ...BROWSE_DEFAULT, tags: [], without: [] };
let browseSeq = 0;
const genreNames = () => new Set((options?.genres || []).map((g) => g.name));
function browseFilters() {
  const genres = genreNames();
  return {
    genres: [browse.genre, ...browse.tags.filter((t) => genres.has(t))].filter(Boolean),
    tags: browse.tags.filter((t) => !genres.has(t)),
    withoutGenres: browse.without.filter((t) => genres.has(t)),
    withoutTags: browse.without.filter((t) => !genres.has(t)),
    when: browse.when, status: browse.status, length: browse.length, format: browse.format, sort: browse.sort,
  };
}
const notSeen = (shows) => (browse.hideSeen ? shows.filter((show) => statusOf(show) !== "COMPLETED") : shows);
function browseSelect(key, label, choices) {
  return `<select class="select" data-browse="${key}" aria-label="${label}">${choices.map(([value, text]) => `<option value="${esc(value)}" ${browse[key] === value ? "selected" : ""}>${esc(text)}</option>`).join("")}</select>`;
}
function pageBrowse(query) {
  const params = new URLSearchParams(query || "");
  if (params.size) {
    browse = { ...BROWSE_DEFAULT, tags: [], without: [] };
    for (const key of ["genre", "when", "status", "sort"]) if (params.get(key)) browse[key] = params.get(key);
    history.replaceState(null, "", "#browse");
  }
  if (!options) return loadingPage();
  const year = new Date().getFullYear();
  const now = { season: ["WINTER", "SPRING", "SUMMER", "FALL"][Math.floor(new Date().getMonth() / 3)], year };
  const years = Array.from({ length: 7 }, (_, i) => year + 1 - i);
  const decades = Array.from({ length: 6 }, (_, i) => Math.floor((year - 7) / 10) * 10 - i * 10);
  const tiles = options.genres;
  return `<h1 class="page-title">Browse</h1><p class="page-sub">Every anime on AniList. Start with a genre, or narrow it down with the filters.</p>
    <div class="genre-tiles">${tiles.slice(0, 12).map((g) => `<button class="genre-tile ${g.name === browse.genre ? "on" : ""}" data-genre="${esc(g.name)}" style="background-image:linear-gradient(180deg,transparent 20%,rgba(0,0,0,.78))${g.art ? `,url('${cssUrl(g.art)}')` : ""}"><b>${esc(g.name)}</b></button>`).join("")}</div>
    ${tiles.length > 12 ? `<div class="genre-more"><span class="muted">More genres</span>${tiles.slice(12).map((g) => `<button class="chip ${g.name === browse.genre ? "on" : ""}" data-genre="${esc(g.name)}">${esc(g.name)}</button>`).join("")}</div>` : ""}
    <div class="browse-bar">
      ${browseSelect("when", "When", [["", "Any time"], ["now", `This season (${titleCase(now.season)} ${now.year})`], ...years.map((y) => [`y:${y}`, String(y)]), ...decades.map((d) => [`d:${d}`, `${d}s`])])}
      ${browseSelect("status", "Status", [["", "Any status"], ["airing", "Airing now"], ["finished", "Finished"], ["upcoming", "Not out yet"]])}
      ${browseSelect("length", "Length", [["", "Any length"], ["short", "Short (up to 13 eps)"], ["standard", "Standard (14 to 26 eps)"], ["long", "Long (27+ eps)"]])}
      ${browseSelect("format", "Format", [["", "Any format"], ["TV", "TV series"], ["MOVIE", "Movies"], ["ONA", "Web series"], ["OVA", "OVA"], ["SPECIAL", "Specials"]])}
      ${catalogNames().length ? `<button class="chip ${mineActive() ? "on" : ""}" data-mine="${mineActive() ? "false" : "true"}" title="Shows on or watched on ${esc(catalogNames().join(", "))}">On my services</button>` : ""}
      ${list.connected ? `<button class="chip ${browse.hideSeen ? "on" : ""}" data-bflag="hideSeen">Hide completed</button>` : ""}
      ${browseSelect("sort", "Sort", [["popular", "Most popular"], ["trending", "Trending"], ["rated", "Highest rated"], ["newest", "Newest"], ["az", "A to Z"]])}
    </div>
    <div class="tag-filter">
      <div class="tag-box">${icon("search")}<input id="tag-q" placeholder="Tags: include or exclude, like “time loop” or “gore”" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="tag-menu"><div class="tag-menu" id="tag-menu" role="listbox" hidden></div></div>
      <div class="tag-chips"></div>
    </div>
    <div id="browse-results"></div>`;
}
async function paintBrowse() {
  const out = document.querySelector("#browse-results");
  if (!out) return;
  document.querySelectorAll("[data-genre]").forEach((tile) => tile.classList.toggle("on", tile.dataset.genre === browse.genre));
  document.querySelectorAll("[data-browse]").forEach((el) => { el.value = browse[el.dataset.browse]; });
  document.querySelectorAll("[data-bflag]").forEach((el) => el.classList.toggle("on", browse[el.dataset.bflag]));
  const chips = document.querySelector(".tag-chips");
  if (chips) chips.innerHTML = [...browse.tags.map((tag) => [tag, "in"]), ...browse.without.map((tag) => [tag, "out"])].map(([tag, mode]) => `<span class="tag-chip ${mode}">
      <button data-tag-flip="${esc(tag)}" title="${mode === "in" ? "Switch to exclude" : "Switch to include"}">${mode === "in" ? "+" : "−"} ${esc(tag)}</button><button data-tag-remove="${esc(tag)}" aria-label="Remove ${esc(tag)}">${icon("close")}</button></span>`).join("");
  const filtered = Object.keys(BROWSE_DEFAULT).some((key) => key !== "sort" && (Array.isArray(browse[key]) ? browse[key].length : browse[key] !== BROWSE_DEFAULT[key]));
  const mine = mineActive();
  const head = (count) => `<div class="row-head"><h2>${esc(browse.genre || "All anime")}${mine ? " on your services" : ""}</h2><span class="muted">${count}</span>${filtered ? `<a href="#browse" data-act="browse-clear">Clear filters</a>` : ""}</div>`;
  out.innerHTML = `${head("Loading…")}${loadingPage("")}`;
  const seq = ++browseSeq;
  const filters = browseFilters();
  const reply = await ctx.send("browse", { filters, page: 1, mine });
  if (seq !== browseSeq || !out.isConnected) return;
  if (!reply?.ok) { out.innerHTML = head("") + errorPage(reply?.error); return; }
  const shows = notSeen(reply.shows);
  out.innerHTML = `${head(`${reply.total >= 5000 ? "5,000+" : reply.total.toLocaleString()} ${reply.total === 1 ? "show" : "shows"}`)}
    ${shows.length ? '<div id="browse-grid"></div>' : `<div class="empty"><p class="muted">No anime match all of these filters.</p><button class="btn" data-act="browse-clear">Clear filters</button></div>`}`;
  const target = out.querySelector("#browse-grid");
  if (target) mountPagedGrid(target, { shows, more: reply.more }, async (page) => {
    const next = await ctx.send("browse", { filters, page, mine });
    return next?.ok && seq === browseSeq ? { shows: notSeen(next.shows), more: next.more } : null;
  });
}
function tagPool() {
  const genres = (options?.genres || []).map((g) => ({ name: g.name, genre: true }));
  return [...genres, ...(options?.tags || []).map((t) => ({ name: t.name, genre: false, category: t.category }))];
}
function paintTagMenu(open = true) {
  const input = document.querySelector("#tag-q");
  const menu = document.querySelector("#tag-menu");
  if (!input || !menu) return;
  const q = input.value.trim().toLowerCase();
  const chosen = new Set([...browse.tags, ...browse.without]);
  const matches = tagPool().filter((tag) => !chosen.has(tag.name) && (!q || tag.name.toLowerCase().includes(q)))
    .sort((a, b) => (q ? !a.name.toLowerCase().startsWith(q) - !b.name.toLowerCase().startsWith(q) : b.genre - a.genre)).slice(0, 8);
  menu.hidden = !open;
  input.setAttribute("aria-expanded", String(open));
  menu.innerHTML = `${matches.map((tag, i) => `<div class="tag-opt ${i === 0 ? "sel" : ""}" role="option" data-tag="${esc(tag.name)}">
      <span>${esc(tag.name)}<small>${tag.genre ? "Genre" : esc(tag.category || "Tag")}</small></span>
      <button data-tag-add="${esc(tag.name)}" data-mode="in">${icon("plus")} Include</button><button data-tag-add="${esc(tag.name)}" data-mode="out">${icon("close")} Exclude</button></div>`).join("")
    || `<p class="muted">No tags match “${esc(input.value.trim())}”.</p>`}
    ${matches.length ? '<div class="tag-hint">Enter includes · Shift+Enter excludes · ↑↓ to choose</div>' : ""}`;
}
function setTag(tag, mode) {
  browse.tags = browse.tags.filter((t) => t !== tag);
  browse.without = browse.without.filter((t) => t !== tag);
  if (mode === "in") browse.tags.push(tag);
  if (mode === "out") browse.without.push(tag);
  paintBrowse();
}

// Airing
const DAY = 864e5;
let airing = null;
let airingMine = false;
const clock = (time) => new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function airItem({ show, at, episode }) {
  remember([show]);
  const mine = statusOf(show) === "CURRENT";
  const aired = at <= Date.now();
  const behind = mine && aired && (entryOf(show)?.progress || 0) < episode;
  return `<a class="air ${mine ? "mine" : ""} ${aired ? "aired" : ""}" href="#show/${esc(show.id)}" data-show="${esc(show.id)}">
    ${posterImg(show)}
    <div><span class="air-top"><time>${clock(at)}</time></span><b>${esc(show.title)}</b><small>Ep ${episode}${behind ? " · <em>New for you</em>" : aired ? " · Out now" : ""}</small></div>
  </a>`;
}
function pageAiring() {
  if (!airing) return loadingPage();
  const from = airing.from;
  const slots = airing.slots.map((slot) => ({ ...slot, at: slot.at * 1000 }));
  const shown = airingMine ? slots.filter((slot) => statusOf(slot.show) === "CURRENT") : slots;
  const mine = slots.filter((slot) => statusOf(slot.show) === "CURRENT");
  const next = mine.find((slot) => slot.at > Date.now());
  const day = (time) => { const n = Math.round((time - from) / DAY); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : new Date(time).toLocaleDateString([], { weekday: "long" }); };
  const columns = Array.from({ length: 7 }, (_, i) => {
    const start = from + i * DAY;
    const items = shown.filter((slot) => slot.at >= start && slot.at < start + DAY);
    return `<section class="air-day ${i === 0 ? "today" : ""}"><h3>${day(start)}<small>${new Date(start).toLocaleDateString([], { month: "short", day: "numeric" })}</small></h3>
      ${items.map(airItem).join("") || '<p class="muted air-none">Nothing airing</p>'}</section>`;
  }).join("");
  const sub = !list.connected ? "Every episode airing this week, from AniList."
    : mine.length ? `${mine.length} ${mine.length === 1 ? "episode" : "episodes"} from shows you're watching this week.${next ? ` Next up: ${esc(next.show.title)}, ${day(next.at).toLowerCase()} at ${clock(next.at)}.` : ""}`
    : "Nothing you're watching airs this week.";
  return `<h1 class="page-title">Airing this week</h1>
    <p class="page-sub">${sub} Times are in your time zone.</p>
    ${list.connected ? `<div class="search-tools air-tools"><button class="chip ${airingMine ? "" : "on"}" data-airing-mine="false">Everything airing</button><button class="chip ${airingMine ? "on" : ""}" data-airing-mine="true">Only shows I'm watching</button></div>` : ""}
    <div class="air-week">${columns}</div>`;
}

// My list
let listTab = "CURRENT";
let listView = "grid";
function pageList(tab) {
  if (tab && STATUS[tab]) listTab = tab;
  const { connected, name } = ctx.state().anilist || {};
  if (!connected) return `<h1 class="page-title">My list</h1><p class="page-sub">Your AniList list, right here.</p>
    <div class="sync-line"><span class="dot-state off"></span><span><b>Not connected</b> <span class="muted">· connect AniList to see and update your list</span></span><span class="nav-spacer"></span><a class="btn sm accent" href="#settings">Connect AniList</a></div>`;
  if (!list.loaded) return loadingPage("Loading your AniList list…");
  const items = inStatus(listTab);
  const viewToggle = `<div class="seg"><button class="${listView === "grid" ? "on" : ""}" data-view="grid" aria-label="Grid">${icon("grid")}</button><button class="${listView === "rows" ? "on" : ""}" data-view="rows" aria-label="Rows">${icon("rows")}</button></div>`;
  const rows = () => `<div class="lib-rows">${items.slice(0, 500).map((show) => {
    const item = entryOf(show);
    const pct = item.status === "COMPLETED" ? 100 : show.episodes ? Math.round((item.progress / show.episodes) * 100) : 0;
    return `<div class="lib-row" data-show="${esc(show.id)}">${posterImg(show)}<div><b>${esc(show.title)}</b><span class="muted">${esc(show.genres.slice(0, 2).join(" · "))}${show.genres.length ? " · " : ""}★ ${score(show)}</span></div>
      <div class="lib-prog">${item.progress} of ${show.episodes || "?"} episodes<div class="meter"><i style="width:${pct}%"></i></div></div>
      <div class="lib-acts">${listTab === "CURRENT" ? `<button class="btn sm" data-act="plus-one" data-show="${esc(show.id)}">+1 ep</button>` : ""}${sources(show)[0] ? watchButton(show, "btn sm accent") : ""}</div></div>`;
  }).join("")}</div>`;
  const body = !items.length ? `<div class="empty"><p class="muted">Nothing here yet.</p><a class="btn" href="#browse">Browse anime</a></div>`
    : listView === "grid" ? '<div id="list-grid"></div>' : rows();
  return `<h1 class="page-title">My list</h1><p class="page-sub">Your AniList list. Changes here save to AniList right away.</p>
    <div class="sync-line"><span class="dot-state"></span><span><b>Synced with AniList</b> <span class="muted">· ${esc(name || "your account")}</span></span><span class="nav-spacer"></span><button class="btn sm" data-act="list-refresh">Refresh</button>${viewToggle}</div>
    <div class="tabs">${Object.entries(STATUS).map(([key, label]) => `<a class="chip ${key === listTab ? "on" : ""}" href="#list/${key}">${label} <b>${inStatus(key).length}</b></a>`).join("")}</div>
    ${body}`;
}

// Show page
const details = new Map();
function pageShow(id) {
  const info = details.get(id);
  if (!info) return loadingPage();
  if (info.error) return `<h1 class="page-title">We couldn't find that show</h1><p class="page-sub">${esc(info.error)}</p>
    <div class="missing-acts"><a class="btn accent" href="#browse">Browse anime</a><a class="btn ghost" href="#">Back to home</a></div>`;
  const { show, related, similar } = info;
  const item = entryOf(show);
  const status = statusOf(show);
  const progress = status === "COMPLETED" ? show.episodes || item?.progress || 0 : item?.progress || 0;
  const out = show.status !== "NOT_YET_RELEASED";
  const aired = show.episodes || (show.airing ? show.airing.episode - 1 : 0);
  const count = aired && aired <= 300 ? aired : 0;
  const connected = list.connected;
  const links = sources(show);
  const epsGrid = !out ? `<div class="set-row"><div class="grow"><b>Not out yet</b><small>${show.year ? `Expected ${show.season ? `${titleCase(show.season)} ` : ""}${show.year}` : "No date announced"}.</small></div></div>`
    : count ? `<div class="eps ${connected ? "marking" : ""}">${Array.from({ length: count }, (_, i) => `<button class="ep ${i < progress ? "seen" : ""} ${i === progress && status !== "COMPLETED" && status ? "next" : ""}" data-ep="${i + 1}" data-show="${esc(show.id)}" title="${connected ? `Watched through episode ${i + 1}` : `Episode ${i + 1}`}">${i + 1}</button>`).join("")}</div>`
    : `<p class="muted">AniList doesn't list an episode count yet.</p>`;
  const relatedStrip = related.length ? `<h3>Related</h3><div class="seasons">${related.map((rel) => {
    const state = list.entries[rel.id];
    return `<a class="season ${state ? `st-${state.status === "CURRENT" ? "watching" : ""}` : ""}" href="#show/${esc(rel.id)}">
      ${rel.cover ? `<img src="${esc(rel.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
      <div><b>${esc(rel.relation)}</b><small title="${esc(rel.title)}">${esc(clip(rel.title, 40))}</small><small>${[formatName(rel), rel.year, rel.episodes ? `${rel.episodes} eps` : ""].filter(Boolean).join(" · ")}</small></div>
      ${state?.status === "COMPLETED" ? `<span class="season-check">${icon("check")}</span>` : ""}
    </a>`;
  }).join("")}</div>` : "";
  return `<section class="show-hero" style="--c:${esc(show.color)}">
    <div class="show-hero-bg" style="background-image:url('${cssUrl(artOf(show))}')"></div>
    <div class="show-hero-inner">
      <div class="show-poster">${posterImg(show)}</div>
      <div class="show-copy">
        <div class="show-heading">
          ${show.native ? `<div class="show-jp" lang="ja" title="${esc(show.native)}">${esc(show.native)}</div>` : ""}
          <h1 class="show-title">${esc(show.title)}</h1>
        </div>
        <div class="show-native">${show.romaji && show.romaji !== show.title ? esc(show.romaji) : ""}</div>
        <div class="show-meta"><span>★ ${score(show)}</span>${show.year ? `<span>${show.season ? `${titleCase(show.season)} ` : ""}${show.year}</span>` : ""}<span>${formatName(show)}</span><span>${show.episodes ? `${show.episodes} ${show.episodes === 1 ? "ep" : "eps"}` : "Ongoing"}</span>${show.duration && show.format !== "MOVIE" ? `<span>${show.duration} min</span>` : ""}${show.studio ? `<span>${esc(show.studio)}</span>` : ""}<span>${show.status === "RELEASING" ? "Airing" : out ? "Complete" : "Upcoming"}</span></div>
        <div class="show-actions">
          ${(() => {
            const next = status === "CURRENT" || status === "REPEATING" ? Math.min((progress || 0) + 1, show.episodes || (progress || 0) + 1) : null;
            const primary = links[0];
            const label = next && primary ? `Continue ep ${next} on ${primary.site}` : primary ? `Watch on ${primary.site}` : "";
            return links.slice(0, 2).map((link, i) => `<a class="btn ${i === 0 ? "accent" : ""}" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${icon("play")} ${i === 0 && label ? esc(label) : `Watch on ${esc(link.site)}`}</a>`).join("");
          })()}
          ${connected ? `<div class="seg status-seg">${Object.entries(STATUS).map(([key, label]) => `<button class="${status === key ? "on" : ""}" data-status="${key}" data-show="${esc(show.id)}" ${!out && key !== "PLANNING" ? "disabled" : ""}>${label}</button>`).join("")}</div>`
            : `<a class="btn" href="#settings">Connect AniList to track</a>`}
        </div>
      </div>
    </div>
  </section>
  <div class="show-body">
    <div>
      ${relatedStrip}
      ${show.about ? `<h3>Story</h3><p class="show-about">${esc(show.about)}</p>` : ""}
      <div class="eps-head"><h3>Episodes</h3>${count && connected ? '<span class="muted eps-hint">· tap the last one you watched</span>' : ""}</div>${epsGrid}
    </div>
    <aside>
      <div class="side-card"><h3>Where to watch</h3>${links.map((link) => `<a class="where" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer"><span class="where-dot" style="background:${esc(brand(link))}">${esc(link.site[0])}</span><div><b>${esc(link.site)}</b><small>${whereNote(link)}</small></div>${icon("right")}</a>`).join("") || `<p class="muted">${esc(noLinks(show))}</p>`}</div>
      <div class="side-card"><h3>Details</h3><dl class="facts">
        ${show.genres.length ? `<dt>Genres</dt><dd>${esc(show.genres.join(", "))}</dd>` : ""}
        <dt>Format</dt><dd>${formatName(show)}</dd>
        <dt>Episodes</dt><dd>${show.episodes || "Ongoing"}</dd>
        ${show.airing ? `<dt>Next</dt><dd>Ep ${show.airing.episode}, ${new Date(show.airing.at * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</dd>` : ""}
        <dt>Year</dt><dd>${show.year || "–"}</dd><dt>Studio</dt><dd>${esc(show.studio) || "–"}</dd><dt>Score</dt><dd>${score(show)} / 10</dd></dl></div>
      ${show.tags.length ? `<div class="side-card"><h3>Tags</h3><div class="tag-list">${show.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div></div>` : ""}
      <div class="side-card"><a class="btn ghost" style="width:100%" href="https://anilist.co/anime/${Number(show.anilistId)}" target="_blank" rel="noopener noreferrer">Open on AniList</a></div>
    </aside>
  </div>
  ${rail("More like this", similar, { href: false })}`;
}

// Search: plain title search on AniList, with genre chips, a service filter and sort.
let search = { query: "", genre: "", where: "all", sort: "match", shows: [], page: 1, more: false, total: 0, busy: false, error: "", key: "" };
let searchSeq = 0;
function searchMatches(show) {
  if (search.where === "mine") return sources(show).some((link) => isMine(link.site));
  if (search.where !== "all") return sources(show).some((link) => link.site === search.where);
  return true;
}
function sourcePill(show, link) {
  const mine = isMine(link.site);
  return `<a class="sx-src${mine ? " is-on" : ""}" style="--brand:${esc(brand(link))}" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="Open on ${esc(link.site)}"><span class="sx-dot"></span>${esc(link.site)}${mine ? "<i>Yours</i>" : ""}</a>`;
}
function searchCard(show, index) {
  remember([show]);
  const item = entryOf(show);
  const status = statusOf(show);
  const links = sources(show);
  return `<article class="sx-card" data-show="${esc(show.id)}" style="animation-delay:${Math.min(index, 8) * 28}ms">
    <a class="sx-art" href="#show/${esc(show.id)}" tabindex="-1" aria-hidden="true">${posterImg(show)}</a>
    <div class="sx-body">
      <div class="sx-head"><a class="sx-title" href="#show/${esc(show.id)}">${esc(show.title)}</a>
        <span class="sx-meta">${formatName(show)}${show.year ? ` · ${show.year}` : ""}${show.episodes ? ` · ${show.episodes} eps` : ""} · ★ ${score(show)}</span></div>
      ${show.about ? `<p class="sx-reason">${esc(clip(show.about, 200))}</p>` : ""}
      <div class="sx-where"><span class="sx-label">Where to watch</span>${links.map((link) => sourcePill(show, link)).join("") || `<span class="sx-meta">${esc(noLinks(show))}</span>`}</div>
      <div class="sx-foot">
        ${show.genres.slice(0, 4).map((tag) => `<span class="sx-tag">${esc(tag)}</span>`).join("")}
        <span class="sx-spacer"></span>
        ${list.connected ? `<select class="sx-status${status ? " has-status" : ""}" data-list-status="${esc(show.id)}" aria-label="AniList status">
          <option value="">${status ? "Remove from list" : "Add to AniList"}</option>
          ${Object.entries(STATUS).map(([key, label]) => `<option value="${key}"${key === status ? " selected" : ""}>${label}${key === status && show.episodes ? ` · ${item.progress}/${show.episodes}` : ""}</option>`).join("")}
        </select>` : ""}
        ${links[0] ? `<a class="sx-go" style="--brand:${esc(brand(links[0]))}" href="${esc(links[0].url)}" target="_blank" rel="noopener noreferrer"><b>Watch on ${esc(links[0].site)}</b><small>${isMine(links[0].site) ? "On your account" : "Opens in a new tab"}</small></a>` : ""}
      </div>
    </div>
  </article>`;
}
function searchResults() {
  if (search.error) return errorPage(search.error);
  if (search.busy && !search.shows.length) return loadingPage("Searching AniList…");
  const shown = search.shows.filter(searchMatches);
  const head = `<div class="row-head"><h2>${search.query ? "Results" : search.genre ? esc(search.genre) : "Popular right now"}</h2><span class="muted">${search.total >= 5000 ? "5,000+" : search.total.toLocaleString()}</span></div>`;
  if (!shown.length) return `${head}<div class="empty"><p class="muted">${search.shows.length ? "None of these stream on the service you picked. Try All services." : "No matches. Try fewer words, or another genre."}</p></div>`;
  return `${head}<div class="sx-list">${shown.map(searchCard).join("")}</div>
    ${search.more ? `<div class="sx-more"><button class="btn" data-act="search-more" ${search.busy ? "disabled" : ""}>${search.busy ? "Loading…" : "Load more"}</button></div>` : ""}`;
}
function searchFilters() {
  const connected = connectedSites();
  const fromResults = search.shows.flatMap((show) => sources(show).map((link) => link.site));
  const sites = [...new Set([...connected, ...fromResults])].sort((a, b) => isMine(b) - isMine(a) || a.localeCompare(b)).slice(0, 10);
  const chip = (value, label) => `<button class="chip ${search.where === value ? "on" : ""}" data-search-where="${esc(value)}" title="${value !== "all" && value !== "mine" ? `Only titles on ${label}` : ""}">${label}</button>`;
  return `${chip("all", "All services")}${connected.length ? chip("mine", "My services") : ""}${sites.map((site) => chip(site, esc(site))).join("")}
    <select class="select" data-search-sort aria-label="Sort">${[["match", "Best match"], ["popular", "Most popular"], ["rated", "Highest rated"], ["newest", "Newest"]].map(([v, t]) => `<option value="${v}" ${search.sort === v ? "selected" : ""}>${t}</option>`).join("")}</select>`;
}
function pageSearch(query) {
  if (query != null && query !== search.query) search.query = query;
  const genres = (options?.genres || []).map((g) => g.name);
  return `<div class="search-hero">
      <h1 class="page-title">Search</h1>
      <p class="page-sub">Search any anime title. Filter to one connected service with the chips below. Results open the show page; Watch / Continue go to the service when we have a link.</p>
      <form class="search-box" data-search-form role="search">${icon("search")}<input id="search-q" value="${esc(search.query)}" placeholder="Search a title" autocomplete="off" aria-label="Search a title"><button class="btn accent" type="submit">Search</button></form>
      <div class="search-tools">${genres.map((g) => `<button class="chip ${search.genre === g ? "on" : ""}" data-search-genre="${esc(g)}">${esc(g)}</button>`).join("")}</div>
    </div>
    <div class="search-tools sx-filters" id="search-filters">${searchFilters()}</div>
    <div id="search-results">${searchResults()}</div>`;
}
function paintSearch() {
  const out = document.querySelector("#search-results");
  if (!out) return;
  out.innerHTML = searchResults();
  document.querySelector("#search-filters").innerHTML = searchFilters();
  document.querySelectorAll("[data-search-genre]").forEach((el) => el.classList.toggle("on", el.dataset.searchGenre === search.genre));
}
async function runSearch({ more = false } = {}) {
  const filters = { query: search.query.trim(), genres: search.genre ? [search.genre] : [], sort: search.query.trim() ? search.sort : search.sort === "match" ? "popular" : search.sort };
  const key = JSON.stringify(filters);
  if (!more && key === search.key && (search.shows.length || search.busy)) return paintSearch();
  const seq = ++searchSeq;
  const page = more ? search.page + 1 : 1;
  search = { ...search, key, busy: true, error: "", ...(more ? {} : { shows: [], total: 0, more: false, page: 1 }) };
  paintSearch();
  const reply = await ctx.send("browse", { filters, page });
  if (seq !== searchSeq) return;
  if (!reply?.ok) search = { ...search, busy: false, error: reply?.error || "AniList didn't answer" };
  else search = { ...search, busy: false, shows: more ? [...search.shows, ...remember(reply.shows)] : remember(reply.shows), more: reply.more, total: reply.total, page };
  paintSearch();
}

// Ctrl+K palette: titles as you type; Enter opens the full search.
let suggestSeq = 0;
let suggestTimer = 0;
function palette(open) {
  let box = document.querySelector(".kpal");
  if (!box) {
    box = document.createElement("div");
    box.className = "kpal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Search");
    box.innerHTML = `<div class="kpal-box"><div class="kpal-in">${icon("search")}<input placeholder="Search titles…" aria-label="Search titles"><kbd>Esc</kbd></div><div class="kpal-list"></div></div>`;
    document.body.append(box);
    box.addEventListener("click", (e) => { if (e.target === box) palette(false); });
    const input = box.querySelector("input");
    input.addEventListener("input", () => { clearTimeout(suggestTimer); paintPalette(null); suggestTimer = setTimeout(suggest, 200); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") box.querySelector(".kpal-item.sel")?.click();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...box.querySelectorAll(".kpal-item")];
        const at = items.findIndex((x) => x.classList.contains("sel"));
        items[at]?.classList.remove("sel");
        items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.classList.add("sel");
        e.preventDefault();
      }
    });
  }
  box.classList.toggle("open", open);
  if (open) { const input = box.querySelector("input"); input.value = ""; paintPalette([]); setTimeout(() => input.focus(), 10); }
}
async function suggest() {
  const box = document.querySelector(".kpal");
  const q = box?.querySelector("input").value.trim();
  if (!q) return paintPalette([]);
  const seq = ++suggestSeq;
  const reply = await ctx.send("browse", { filters: { query: q }, page: 1 });
  if (seq !== suggestSeq || box.querySelector("input").value.trim() !== q) return;
  paintPalette(reply?.ok ? remember(reply.shows).slice(0, 7) : []);
}
function paintPalette(hits) {
  const box = document.querySelector(".kpal");
  const q = box.querySelector("input").value.trim();
  const out = box.querySelector(".kpal-list");
  if (hits === null && out.dataset.q === q) return;
  out.dataset.q = q;
  const shows = q ? hits || [] : inStatus("CURRENT").slice(0, 6);
  const sub = (s) => `${statusOf(s) ? STATUS[statusOf(s)] : esc(s.genres.slice(0, 2).join(" · ")) || formatName(s)} · ★ ${score(s)}`;
  out.innerHTML = `
    ${q ? `<h6>Search</h6><div class="kpal-item kpal-ask sel" data-go="#search?q=${encodeURIComponent(q)}"><span>${icon("search")}</span><div><b>Search for “${esc(q)}”</b><small>All results, with where to watch</small></div></div>` : ""}
    ${!q && !shows.length ? "" : `<h6>${q ? "Titles" : "Continue watching"}</h6>`}
    ${shows.map((s) => `<div class="kpal-item" data-go="#show/${encodeURIComponent(s.id)}">${posterImg(s)}<div><b>${esc(s.title)}</b><small>${sub(s)}</small></div>${icon("right")}</div>`).join("")
      || (q ? `<p class="muted kpal-note">${hits === null ? "Looking…" : "No titles match. Press Enter to search."}</p>` : "")}
    ${q ? "" : `<h6>Go to</h6>${[["#search", "Search", "search"], ["#browse", "Browse by genre", "compass"], ["#airing", "Airing this week", "calendar"], ["#list", "My list", "list"], ["#settings/import", "Import history", "download"], ["#settings", "Settings", "gear"]].filter(([h]) => list.connected || !["#list", "#settings/import"].includes(h)).map(([h, t, ic], i) => `<div class="kpal-item kpal-ask kpal-go ${!shows.length && i === 0 ? "sel" : ""}" data-go="${h}"><span>${icon(ic)}</span><div><b>${t}</b></div></div>`).join("")}`}`;
}

// List changes save straight to AniList, then update everything on screen.
async function saveStatus(show, status, progress) {
  if (!list.connected) { ctx.toast("Connect AniList in Settings to save to your list"); return; }
  const current = entryOf(show);
  if (!status && !Number.isInteger(progress)) {
    if (!current) return;
    const reply = await ctx.send("removeEntry", { entryId: current.entryId });
    if (!reply?.ok) return ctx.toast(reply?.error || "AniList didn't save that");
    delete list.entries[show.id];
    list.shows = list.shows.filter((other) => other.id !== show.id);
    ctx.toast(`Removed ${show.title}`);
    return rerender();
  }
  const reply = await ctx.send("saveEntry", { anilistId: show.anilistId, status, progress });
  if (!reply?.ok) return ctx.toast(reply?.error || "AniList didn't save that");
  list.entries[show.id] = reply.entry;
  if (!list.shows.some((other) => other.id === show.id)) list.shows.push(show);
  ctx.toast(Number.isInteger(progress) ? `${show.title}: watched through episode ${reply.entry.progress}` : `${show.title}: ${STATUS[reply.entry.status === "REPEATING" ? "CURRENT" : reply.entry.status]}`);
  rerender();
}
function markEpisode(show, n) {
  const current = entryOf(show);
  const progress = current?.progress === n ? n - 1 : n;
  const done = show.episodes && progress >= show.episodes;
  return saveStatus(show, done ? "COMPLETED" : progress > 0 ? "CURRENT" : current?.status || "PLANNING", progress);
}

export async function loadList() {
  if (!ctx.state().anilist?.connected) { list = { connected: false, entries: {}, shows: [], loaded: true }; return; }
  const reply = await ctx.send("myList");
  list = reply?.ok ? { connected: reply.connected, entries: reply.entries, shows: remember(reply.shows), loaded: true } : { connected: true, entries: {}, shows: [], loaded: true };
  if (!reply?.ok) ctx.toast(reply?.error || "Your AniList list didn't load");
}

// Router hooks: render returns the page; after fills in whatever needed loading.
let rerender = () => {};
export const PAGES = ["home", "browse", "airing", "list", "show", "search"];
export function render(page, { arg, query }) {
  gridObserver?.disconnect();
  clearTimeout(hero.timer);
  hero.running = false;
  heroWatch.disconnect();
  if (page === "home") return pageHome();
  if (page === "browse") return pageBrowse(query);
  if (page === "airing") return pageAiring();
  if (page === "list") return pageList(arg);
  if (page === "show") return pageShow(arg);
  if (page === "search") return pageSearch(new URLSearchParams(query || "").get("q"));
  return "";
}
export function after(page, { arg }) {
  if (!document.querySelector(".ambient")) document.body.insertAdjacentHTML("afterbegin", '<div class="ambient"><i></i><i></i></div>');
  const fill = (promise) => promise.then(() => rerender(), (error) => { const main = document.querySelector("main"); if (main && document.body.dataset.page === page) main.innerHTML = errorPage(error?.message); });
  if (page === "home") {
    if (!homeData || homeData.mine !== mineActive()) return fill(loadHome());
    if (document.querySelector(".hero")) { showSlide(0); heroWatch.observe(document.querySelector(".hero")); syncHero(); }
  }
  if (page === "browse") {
    if (!options) return fill(ctx.send("browseOptions").then((reply) => { if (!reply?.ok) throw new Error(reply?.error); options = reply; }));
    paintBrowse();
  }
  if (page === "airing" && !airing) {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    return fill(ctx.send("airingWeek", { from: from.getTime() }).then((reply) => { if (!reply?.ok) throw new Error(reply?.error); airing = { from: from.getTime(), slots: reply.slots }; }));
  }
  if (page === "list") {
    if (!list.loaded && ctx.state().anilist?.connected) return fill(loadList());
    const target = document.querySelector("#list-grid");
    if (target) mountGrid(target, inStatus(listTab));
  }
  if (page === "show") {
    if (!details.has(arg)) return fill(ctx.send("showDetails", { anilistId: arg }).then((reply) => {
      details.set(arg, reply?.ok ? { show: remember([reply.show])[0], related: reply.related, similar: remember(reply.similar) } : { error: reply?.error || "AniList didn't answer" });
    }));
    const info = details.get(arg);
    if (info?.show) setAmbient(artOf(info.show));
  }
  if (page === "search") {
    if (!options) ctx.send("browseOptions").then((reply) => { if (reply?.ok) { options = reply; if (document.body.dataset.page === "search") rerender(); } });
    runSearch();
    if (!search.query) setTimeout(() => document.querySelector("#search-q")?.focus(), 30);
  }
}

function bind() {
  document.addEventListener("click", (e) => {
    const target = e.target;
    const go = target.closest("[data-go]");
    if (go) { palette(false); location.hash = go.dataset.go; return; }
    const act = target.closest("[data-act]")?.dataset.act;
    if (act === "kpal") return palette(true);
    if (act === "theme") {
      const pop = document.querySelector("#theme-pop");
      const box = target.closest("[data-act]").getBoundingClientRect();
      pop.style.top = `${box.bottom + 10}px`;
      pop.style.left = `${Math.max(12, box.right - 290)}px`;
      pop.classList.toggle("open");
      return applyTheme();
    }
    if (!target.closest("#theme-pop")) document.querySelector("#theme-pop")?.classList.remove("open");
    const palettePick = target.closest("[data-set-palette]");
    if (palettePick) { theme.palette = palettePick.dataset.setPalette; return applyTheme(); }
    const modePick = target.closest("[data-set-mode]");
    if (modePick) { theme.mode = modePick.dataset.setMode; return applyTheme(); }
    const sizePick = target.closest("[data-set-size]");
    if (sizePick) { theme.size = sizePick.dataset.setSize; return applyTheme(); }
    if (act === "hero") return showSlide(Number(target.closest("[data-act]").dataset.i));
    if (act === "rail-prev" || act === "rail-next") {
      const railEl = target.closest(".rail-wrap").querySelector(".rail");
      return railEl.scrollBy({ left: (act === "rail-next" ? 1 : -1) * railEl.clientWidth * 0.8, behavior: "smooth" });
    }
    if (act === "retry") { homeData = null; options = null; airing = null; details.clear(); search.key = ""; return rerender(); }
    if (act === "list-refresh") { list.loaded = false; return rerender(); }
    if (act === "browse-clear") { e.preventDefault(); browse = { ...BROWSE_DEFAULT, tags: [], without: [] }; return paintBrowse(); }
    if (act === "search-more") return runSearch({ more: true });
    const showEl = target.closest("[data-show]");
    const show = showEl && byId.get(showEl.dataset.show);
    if (act === "toggle" && show) return saveStatus(show, statusOf(show) ? null : "PLANNING");
    if (act === "plus-one" && show) return markEpisode(show, (entryOf(show)?.progress || 0) + 1);
    const ep = target.closest("[data-ep]");
    if (ep && show) return list.connected ? markEpisode(show, Number(ep.dataset.ep)) : ctx.toast("Connect AniList in Settings to track episodes");
    const statusPick = target.closest("[data-status]");
    if (statusPick && show) return saveStatus(show, statusPick.classList.contains("on") ? null : statusPick.dataset.status);
    const viewPick = target.closest("[data-view]");
    if (viewPick) { listView = viewPick.dataset.view; return rerender(); }
    const mine = target.closest("[data-airing-mine]");
    if (mine) { airingMine = mine.dataset.airingMine === "true"; return rerender(); }
    const onMine = target.closest("[data-mine]");
    if (onMine) {
      mineOnly = onMine.dataset.mine === "true";
      localStorage.setItem(MINE_KEY, mineOnly ? "1" : "0");
      if (document.body.dataset.page === "browse") {
        onMine.dataset.mine = mineOnly ? "false" : "true";
        onMine.classList.toggle("on", mineOnly);
        return paintBrowse();
      }
      return rerender();
    }
    const genre = target.closest("[data-genre]");
    if (genre) { browse.genre = browse.genre === genre.dataset.genre ? "" : genre.dataset.genre; return paintBrowse(); }
    const flag = target.closest("[data-bflag]");
    if (flag) { browse[flag.dataset.bflag] = !browse[flag.dataset.bflag]; return paintBrowse(); }
    const tagAdd = target.closest("[data-tag-add]");
    if (tagAdd) { setTag(tagAdd.dataset.tagAdd, tagAdd.dataset.mode); const input = document.querySelector("#tag-q"); input.value = ""; input.focus(); return paintTagMenu(); }
    const tagOpt = target.closest(".tag-opt");
    if (tagOpt) { setTag(tagOpt.dataset.tag, "in"); return paintTagMenu(false); }
    const flip = target.closest("[data-tag-flip]");
    if (flip) return setTag(flip.dataset.tagFlip, browse.tags.includes(flip.dataset.tagFlip) ? "out" : "in");
    const remove = target.closest("[data-tag-remove]");
    if (remove) return setTag(remove.dataset.tagRemove, null);
    if (!target.closest(".tag-box")) paintTagMenu(false);
    const searchGenre = target.closest("[data-search-genre]");
    if (searchGenre) { search.genre = search.genre === searchGenre.dataset.searchGenre ? "" : searchGenre.dataset.searchGenre; return runSearch(); }
    const where = target.closest("[data-search-where]");
    if (where) { search.where = where.dataset.searchWhere; return paintSearch(); }
    // Anywhere else on a card opens its show page.
    const cardEl = target.closest(".card, .wide, .lib-row");
    if (cardEl && !target.closest("a, button, select")) location.hash = `#show/${cardEl.dataset.show}`;
  });
  document.addEventListener("submit", (e) => {
    if (!e.target.matches("[data-search-form]")) return;
    e.preventDefault();
    search.query = e.target.querySelector("input").value.trim();
    history.replaceState(null, "", search.query ? `#search?q=${encodeURIComponent(search.query)}` : "#search");
    runSearch();
  });
  document.addEventListener("change", (e) => {
    const sel = e.target;
    if (sel.matches("[data-browse]")) { browse[sel.dataset.browse] = sel.value; return paintBrowse(); }
    if (sel.matches("[data-search-sort]")) { search.sort = sel.value; return runSearch(); }
    if (sel.matches("[data-list-status]")) { const show = byId.get(sel.dataset.listStatus); if (show) saveStatus(show, sel.value || null); }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "tag-q") paintTagMenu(true); });
  document.addEventListener("focusin", (e) => { if (e.target.id === "tag-q") paintTagMenu(true); });
  document.addEventListener("keydown", (e) => {
    const typing = e.target.matches?.("input, textarea, select, [contenteditable]");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette(true); }
    if (e.key === "/" && !typing) { e.preventDefault(); palette(true); }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".kbar")) { e.preventDefault(); palette(true); }
    if (e.key === "Enter" && e.target.matches?.(".card, .wide")) location.hash = `#show/${e.target.dataset.show}`;
    if (e.key === "Escape") { palette(false); document.querySelector("#theme-pop")?.classList.remove("open"); paintTagMenu(false); }
    if (e.target.id === "tag-q") {
      const items = [...document.querySelectorAll(".tag-opt")];
      const at = items.findIndex((x) => x.classList.contains("sel"));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        items[at]?.classList.remove("sel");
        items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.classList.add("sel");
      }
      if (e.key === "Enter" && items[at]) { e.preventDefault(); setTag(items[at].dataset.tag, e.shiftKey ? "out" : "in"); e.target.value = ""; paintTagMenu(); }
    }
  });
  document.addEventListener("mouseover", (e) => {
    const cardEl = e.target.closest?.(".card, .wide");
    if (!cardEl) return;
    const show = byId.get(cardEl.dataset.show);
    if (show) setAmbient(artOf(show));
    if (cardEl.classList.contains("card")) {
      const box = cardEl.getBoundingClientRect();
      cardEl.dataset.edge = box.left < box.width * 0.6 ? "left" : innerWidth - box.right < box.width * 0.6 ? "right" : "";
    }
  });
  document.addEventListener("visibilitychange", () => syncHero());
  addEventListener("scroll", () => document.querySelector(".nav")?.classList.toggle("solid", scrollY > 30), { passive: true });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme);
}

export function init(context) {
  ctx = context;
  rerender = context.rerender;
  loadTheme();
  applyTheme();
  bind();
}
