import { DEMO_EPISODES } from "./demo.js";
import { mountPlayer } from "./player.js";
import { formatTime, sourceKind } from "./player-core.js";

let episodes = DEMO_EPISODES.slice();
const player = mountPlayer(document.querySelector("#player"), { episodes });
let added = 0;

function addEpisode(title, src) {
  added += 1;
  const episode = { id: `added:${added}:${src.slice(0, 80)}`, label: `+${added}`, title, src };
  episodes = [...episodes, episode];
  player.setEpisodes(episodes, { play: episode.id });
}

const form = document.querySelector(".lab-source");
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = form.url.value.trim();
  if (!sourceKind(url) || sourceKind(url) === "file") return form.url.setCustomValidity("Use an http(s) video link or a YouTube link"), form.url.reportValidity();
  form.url.setCustomValidity("");
  addEpisode(url.replace(/^https?:\/\//, "").slice(0, 60), url);
  form.url.value = "";
});
form.url.addEventListener("input", () => form.url.setCustomValidity(""));
form.file.addEventListener("change", () => {
  const file = form.file.files[0];
  if (file) addEpisode(file.name, URL.createObjectURL(file));
  form.file.value = "";
});

// Shows from AniList's official YouTube links that the Crunchyroll catalog doesn't have (scripts/youtube-check.mjs).
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const FORMATS = { TV: "Series", TV_SHORT: "Shorts", ONA: "Web series", OVA: "OVA", MOVIE: "Movie", SPECIAL: "Special", MUSIC: "Music" };
const shelf = document.querySelector(".yt");
const grid = shelf.querySelector(".yt-grid");
const panel = shelf.querySelector(".yt-show");
let shows = [];

const label = (show, index) => (show.items.length === 1 && show.format === "MOVIE" ? "Movie" : `E${index + 1}`);
const toEpisodes = (show) => show.items.map((item, index) => ({ id: `yt:${item.id}`, label: label(show, index), title: show.items.length === 1 ? show.title : item.title, src: `https://www.youtube.com/watch?v=${item.id}` }));

function paintGrid(filter = "") {
  const query = filter.trim().toLowerCase();
  const visible = shows.filter((show) => !query || show.title.toLowerCase().includes(query));
  grid.innerHTML = visible.map((show) => `
    <button class="yt-card" data-show="${show.id}" style="--tint:${esc(show.color || "#333")}">
      <img src="${esc(show.cover)}" alt="" loading="lazy">
      <b>${esc(show.title)}</b>
      <small>${esc(FORMATS[show.format] || show.format)} · ${esc(show.year || "")} · ${show.items.length === 1 ? formatTime(show.items[0].seconds) : `${show.items.length}${show.partial ? "+" : ""} videos`}${show.flags?.length ? ` · <span class="yt-warn">${esc(show.flags[0])}</span>` : ""}</small>
    </button>`).join("");
}

function openShow(id) {
  const show = shows.find((entry) => entry.id === Number(id));
  if (!show) return;
  panel.hidden = false;
  panel.innerHTML = `
    <div class="yt-info">
      <img src="${esc(show.cover)}" alt="">
      <div>
        <h3>${esc(show.title)}</h3>
        <p class="yt-meta">${esc(FORMATS[show.format] || show.format)} · ${esc(show.year || "")} · on ${esc(show.channel || "YouTube")} · <a href="${esc(show.source)}" target="_blank" rel="noopener">open on YouTube</a> · <a href="https://anilist.co/anime/${show.id}" target="_blank" rel="noopener">AniList</a></p>
        <p>${esc(show.about)}</p>
        ${show.partial ? '<p class="yt-meta">Showing the first 100 videos of the playlist.</p>' : ""}
        ${show.sharedPlaylist ? '<p class="yt-meta">This playlist is shared with other seasons of the show.</p>' : ""}
        ${show.flags?.length ? `<p class="yt-flags">${show.flags.map((flag) => `<span>${esc(flag)}</span>`).join("")}</p>` : ""}
      </div>
      <button class="btn sm ghost" data-close>Close</button>
    </div>
    <div class="yt-tiles">${show.items.map((item, index) => `
      <button class="yt-tile" data-play="${show.id}:${item.id}">
        <span class="yt-thumb"><img src="https://i.ytimg.com/vi/${esc(item.id)}/mqdefault.jpg" alt="" loading="lazy"><em>${formatTime(item.seconds)}</em></span>
        <b>${esc(label(show, index))}</b><span>${esc(show.items.length === 1 ? show.title : item.title)}</span>
      </button>`).join("")}</div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

shelf.addEventListener("click", (event) => {
  const card = event.target.closest("[data-show]");
  if (card) return openShow(card.dataset.show);
  if (event.target.closest("[data-close]")) { panel.hidden = true; return; }
  const tile = event.target.closest("[data-play]");
  if (!tile) return;
  const [showId, videoId] = tile.dataset.play.split(":");
  const show = shows.find((entry) => entry.id === Number(showId));
  episodes = toEpisodes(show);
  player.setEpisodes(episodes, { play: `yt:${videoId}` });
  document.querySelector("#player").scrollIntoView({ behavior: "smooth", block: "start" });
});
shelf.querySelector(".yt-filter").addEventListener("input", (event) => paintGrid(event.target.value));

fetch("youtube-shows.json", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((data) => {
  if (!data?.shows?.length) return;
  // Shows with a quality flag (extras, not English, limited time) stay out of the shelf.
  shows = data.shows.filter((show) => !show.flags?.length);
  shelf.hidden = false;
  shelf.querySelector(".yt-count").textContent = `${shows.length} shows · ${shows.reduce((sum, show) => sum + show.items.length, 0)} videos · checked ${new Date(data.checkedAt).toLocaleDateString()}`;
  paintGrid();
}).catch(() => {});
