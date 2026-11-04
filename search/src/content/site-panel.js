// Light branded search panel on a connected streaming site: title search, "search this site only",
// and continue watching that opens the best play URL. Reads nothing from the page itself.
(async () => {
  if (window.top !== window || document.getElementById("crunchilist-search-panel")) return;
  const hello = await chrome.runtime.sendMessage({ type: "panelHello" }).catch(() => null);
  if (!hello?.ok || !hello.show) return;

  const color = hello.color || "#ff7a2f";
  const service = hello.service;
  const name = hello.name || "this site";
  const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });

  const host = document.createElement("div");
  host.id = "crunchilist-search-panel";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; width: 48px; height: 48px; border: 0; border-radius: 16px;
      background: ${color}; color: #111; font: 800 18px/1 "Segoe UI", system-ui, sans-serif; cursor: pointer;
      box-shadow: 0 12px 32px rgba(0,0,0,.35); }
    .fab:hover { filter: brightness(1.06); }
    .panel { position: fixed; right: 20px; bottom: 76px; z-index: 2147483647; width: 360px; max-height: min(70vh, 560px);
      display: none; flex-direction: column; gap: 10px; padding: 14px; border-radius: 16px; background: #14110f; color: #f7efe9;
      border: 1px solid color-mix(in srgb, ${color} 45%, #342a25); box-shadow: 0 18px 50px rgba(0,0,0,.5);
      font: 13px/1.4 "Segoe UI", system-ui, sans-serif; }
    .panel.open { display: flex; animation: rise .22s ease both; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    .top { display: flex; align-items: center; gap: 8px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: ${color}; box-shadow: 0 0 0 4px color-mix(in srgb, ${color} 25%, transparent); }
    b.brand { flex: 1; font-size: 14px; }
    .close, .open-app { border: 0; border-radius: 8px; background: #271f1b; color: #ab9a8f; cursor: pointer; }
    .close { width: 28px; height: 28px; font-size: 18px; line-height: 1; }
    .open-app { padding: 6px 10px; color: #f7efe9; }
    input[type="search"] { width: 100%; box-sizing: border-box; height: 38px; border-radius: 10px; border: 1px solid #342a25;
      background: #1c1714; color: #f7efe9; padding: 0 12px; font: inherit; }
    input[type="search"]:focus { outline: 2px solid color-mix(in srgb, ${color} 50%, transparent); border-color: ${color}; }
    .only { display: flex; align-items: center; gap: 8px; color: #ab9a8f; font-size: 12.5px; }
    .list { overflow: auto; max-height: 340px; }
    h6 { margin: 0 0 6px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #ab9a8f; }
    .item { display: grid; grid-template-columns: 36px 1fr auto; gap: 8px; align-items: center; width: 100%; margin: 0 0 6px;
      padding: 7px; border: 0; border-radius: 10px; background: #1c1714; color: inherit; text-align: left; cursor: pointer; text-decoration: none; box-sizing: border-box; font: inherit; }
    .item:hover { background: #271f1b; }
    .item img { width: 36px; height: 50px; object-fit: cover; border-radius: 5px; background: #271f1b; }
    .item b { display: block; font-size: 12.5px; }
    .item small { color: #ab9a8f; font-size: 11.5px; }
    .go { border: 0; border-radius: 8px; padding: 6px 8px; background: ${color}; color: #111; font-weight: 700; cursor: pointer; white-space: nowrap; text-decoration: none; }
    .note { margin: 0; color: #ab9a8f; font-size: 12px; }`;

  const fab = document.createElement("button");
  fab.className = "fab";
  fab.type = "button";
  fab.title = `Search with Crunchilist on ${name}`;
  fab.setAttribute("aria-label", `Open Crunchilist Search on ${name}`);
  fab.textContent = "C";

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `Crunchilist Search on ${name}`);
  panel.innerHTML = `
    <div class="top"><span class="dot"></span><b class="brand">${escapeHtml(name)} search</b>
      <button type="button" class="open-app">Full app</button>
      <button type="button" class="close" aria-label="Close">×</button></div>
    <input type="search" placeholder="Search titles…" autocomplete="off" spellcheck="false">
    <label class="only"><input type="checkbox" checked> Search ${escapeHtml(name)} only</label>
    <div class="continue" hidden></div>
    <div class="list"></div>
    <p class="note">Title search · no AI</p>`;

  root.append(style, fab, panel);
  document.documentElement.append(host);

  const input = panel.querySelector('input[type="search"]');
  const only = panel.querySelector('input[type="checkbox"]');
  const list = panel.querySelector(".list");
  const cont = panel.querySelector(".continue");
  const note = panel.querySelector(".note");
  let timer = 0;
  let seq = 0;

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function itemHtml(show, { continueWatch = false } = {}) {
    const meta = continueWatch
      ? `Episode ${show.next}${show.episodes ? ` of ${show.episodes}` : ""}`
      : [show.year, show.episodes ? `${show.episodes} eps` : ""].filter(Boolean).join(" · ");
    const play = show.play?.url
      ? `<a class="go" href="${escapeHtml(show.play.url)}" target="_blank" rel="noopener noreferrer">Play</a>`
      : `<button type="button" class="go" data-show="${escapeHtml(show.id)}">Open</button>`;
    return `<div class="item" data-show="${escapeHtml(show.id)}">
      ${show.cover ? `<img src="${escapeHtml(show.cover)}" alt="" referrerpolicy="no-referrer">` : "<span></span>"}
      <div><b>${escapeHtml(show.title)}</b><small>${escapeHtml(meta)}</small></div>${play}</div>`;
  }

  async function loadContinue() {
    const reply = await send("continueWatching", { service: only.checked ? service : "", limit: 5 });
    if (!reply?.ok || !reply.shows?.length) { cont.hidden = true; cont.innerHTML = ""; return; }
    cont.hidden = false;
    cont.innerHTML = `<h6>Continue watching</h6>${reply.shows.map((show) => itemHtml(show, { continueWatch: true })).join("")}`;
  }

  async function runSearch() {
    const q = input.value.trim();
    const mine = ++seq;
    if (q.length < 2) { list.innerHTML = ""; note.textContent = "Title search · no AI"; return; }
    note.textContent = "Searching…";
    const reply = await send("titleSearch", { query: q, service: only.checked ? service : "", limit: 10 });
    if (mine !== seq) return;
    if (!reply?.ok) { note.textContent = reply?.error || "Search failed"; return; }
    list.innerHTML = reply.shows.length ? `<h6>Titles</h6>${reply.shows.map((show) => itemHtml(show)).join("")}` : "";
    note.textContent = reply.shows.length ? `${reply.shows.length} match${reply.shows.length === 1 ? "" : "es"}` : "No titles matched.";
  }

  fab.addEventListener("click", () => {
    const open = !panel.classList.contains("open");
    panel.classList.toggle("open", open);
    if (open) { input.focus(); loadContinue(); }
  });
  panel.querySelector(".close").addEventListener("click", () => panel.classList.remove("open"));
  panel.querySelector(".open-app").addEventListener("click", () => send("openApp", { hash: "#search" }));
  only.addEventListener("change", () => { runSearch(); loadContinue(); });
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(runSearch, 180); });
  panel.addEventListener("click", (event) => {
    if (event.target.closest("a.go")) return;
    const row = event.target.closest("[data-show]");
    if (!row) return;
    event.preventDefault();
    send("openApp", { hash: `#show/${row.dataset.show}` });
  });
})();
