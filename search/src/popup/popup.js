// Toolbar popup: title search across the master list / AniList, optional one-service filter, continue watching.
const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });
const els = {
  q: document.getElementById("q"),
  chips: document.getElementById("chips"),
  onlyRow: document.getElementById("only-row"),
  only: document.getElementById("only"),
  continue: document.getElementById("continue"),
  results: document.getElementById("results"),
  note: document.getElementById("note"),
  open: document.getElementById("open-app"),
  line: document.getElementById("char-line"),
};

let connected = [];
let service = "";
let timer = 0;
let seq = 0;

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function paintChips(services) {
  connected = services;
  els.chips.hidden = !services.length;
  els.onlyRow.hidden = !services.length;
  if (!services.length) { service = ""; els.only.checked = false; return; }
  els.chips.innerHTML = `<button type="button" class="pp-chip${!service ? " on" : ""}" data-service="">All</button>${
    services.map((item) => `<button type="button" class="pp-chip${service === item.id ? " on" : ""}" data-service="${esc(item.id)}" style="${service === item.id ? `background:${esc(item.color)};border-color:${esc(item.color)}` : ""}">${esc(item.name)}</button>`).join("")
  }`;
}

function row(show, { continueWatch = false } = {}) {
  const meta = continueWatch
    ? `Episode ${show.next}${show.episodes ? ` of ${show.episodes}` : ""}`
    : [show.year, show.episodes ? `${show.episodes} eps` : "", show.score != null ? `★ ${show.score}` : ""].filter(Boolean).join(" · ");
  const play = show.play?.url
    ? `<a class="pp-go" href="${esc(show.play.url)}" target="_blank" rel="noopener noreferrer" title="Watch on ${esc(show.play.site || "site")}" style="${show.play.color ? `background:${esc(show.play.color)}` : ""}">Play</a>`
    : `<button class="pp-go" type="button" data-open-show="${esc(show.id)}">Open</button>`;
  return `<div class="pp-item" data-open-show="${esc(show.id)}">
    ${show.cover ? `<img src="${esc(show.cover)}" alt="" referrerpolicy="no-referrer">` : "<span></span>"}
    <div><b>${esc(show.title)}</b><small>${esc(meta)}</small></div>${play}</div>`;
}

async function loadContinue() {
  const reply = await send("continueWatching", { service: els.only.checked ? service : "", limit: 5 });
  if (!reply?.ok || !reply.connected || !reply.shows?.length) { els.continue.hidden = true; els.continue.innerHTML = ""; return; }
  els.continue.hidden = false;
  els.continue.innerHTML = `<h6>Continue watching</h6>${reply.shows.map((show) => row(show, { continueWatch: true })).join("")}`;
}

async function runSearch() {
  const q = els.q.value.trim();
  const mine = ++seq;
  if (q.length < 2) {
    els.results.innerHTML = "";
    els.note.textContent = "Type at least two letters.";
    return;
  }
  els.note.textContent = "Searching…";
  const reply = await send("titleSearch", { query: q, service: els.only.checked ? service : "", limit: 12 });
  if (mine !== seq) return;
  if (!reply?.ok) { els.note.textContent = reply?.error || "Search didn't answer"; return; }
  els.results.innerHTML = reply.shows.length ? `<h6>Titles</h6>${reply.shows.map((show) => row(show)).join("")}` : "";
  els.note.textContent = reply.shows.length
    ? `${reply.shows.length} match${reply.shows.length === 1 ? "" : "es"}${reply.source === "catalog" ? " · master list" : " · AniList"}`
    : "No titles matched.";
}

async function boot() {
  const reply = await send("status");
  const services = (reply?.connected || []).map((id) => {
    const catalogs = reply.catalogs || {};
    const colors = { crunchyroll: "#F47521", netflix: "#E50914", prime: "#00A8E1", hidive: "#00AEEF", tubi: "#7408FF", hulu: "#1CE783" };
    const names = { crunchyroll: "Crunchyroll", netflix: "Netflix", prime: "Prime Video", hidive: "HIDIVE", tubi: "Tubi", hulu: "Hulu" };
    return { id, name: names[id] || id, color: colors[id] || "#ff7a2f", shows: catalogs[id]?.shows || 0 };
  }).filter((item) => item.id !== "hulu" || reply.connected.includes("hulu"));
  paintChips(services.filter((item) => item.id !== "hulu"));
  const look = reply?.lines?.look_here?.text;
  const who = reply?.favorite?.name;
  if (look && who) {
    els.line.hidden = false;
    els.line.innerHTML = `<b>${esc(who)}</b> ${esc(look)}`;
  } else {
    els.line.hidden = true;
    els.line.textContent = "";
  }
  await loadContinue();
  els.q.focus();
}

els.open.addEventListener("click", () => send("openApp", { hash: "" }).then(() => window.close()));
els.only.addEventListener("change", () => { runSearch(); loadContinue(); });
els.chips.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-service]");
  if (!chip) return;
  service = chip.dataset.service || "";
  if (service) els.only.checked = true;
  paintChips(connected);
  runSearch();
  loadContinue();
});
els.q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(runSearch, 180); });
document.body.addEventListener("click", (event) => {
  const play = event.target.closest("a.pp-go");
  if (play) return;
  const open = event.target.closest("[data-open-show]");
  if (!open) return;
  event.preventDefault();
  send("openApp", { hash: `#show/${open.dataset.openShow}` }).then(() => window.close());
});

boot().catch(() => { els.note.textContent = "Couldn't load Search."; });
