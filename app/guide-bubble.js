/**
 * Shared manga-bubble markup for Home, tour, notices, and empties.
 * @param {{ text: string, name?: string, portraitSrc?: string, layout?: "hero"|"tour"|"compact"|"drawer" }} opts
 * @param {(s: string) => string} esc
 */
export function guideBubbleHtml({
  text = "",
  name = "Kivi",
  portraitSrc = "../icons/kivi.png",
  layout = "hero",
} = {}, esc = (s) => String(s || "")) {
  const line = String(text || "").trim();
  if (!line) return "";
  const who = String(name || "Kivi").trim() || "Kivi";
  const src = String(portraitSrc || "../icons/kivi.png");
  const wrap = layout === "tour" ? "tour-guide"
    : layout === "compact" || layout === "drawer" ? "guide-say guide-say-compact"
    : "hero-welcome";
  const portrait = layout === "tour" ? "hero-kivi tour-kivi"
    : layout === "compact" || layout === "drawer" ? "hero-kivi guide-kivi-sm"
    : "hero-kivi";
  const bubble = layout === "tour" ? "hero-bubble tour-bubble"
    : layout === "compact" || layout === "drawer" ? "hero-bubble guide-bubble-sm"
    : "hero-bubble";
  return `<div class="${wrap}" aria-label="${esc(who)} says: ${esc(line)}">
    <div class="${portrait}" aria-hidden="true">
      <img src="${esc(src)}" alt="" width="160" height="160" decoding="async">
    </div>
    <figure class="${bubble}">
      <figcaption class="hero-bubble-name">${esc(who)}</figcaption>
      <blockquote class="hero-bubble-text">${esc(line)}</blockquote>
    </figure>
  </div>`;
}
