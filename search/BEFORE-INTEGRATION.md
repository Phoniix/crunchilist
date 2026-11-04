# Before main-page integration

Target: **stable title collection + matching**. Extras (tracker polish, store cosmetics) can wait.

## Done offline (this session)

- Public title contract: `src/lib/title-api.js` (`TITLE_CONTRACT`, `titleReadiness`, `catalogRates`)
- `status()` now returns `title` + `titleContract` for the main page
- Catalog summaries include `matchRate`; Settings shows % and CR caveat
- Gap map called out as **partial** in Data settings + diagnostics
- Clearer empty-catalog errors in the catalog reader
- Tracker layer (MAL/Kitsu/weekly pull) is present but **not** required for title integration

## Tomorrow — signed-in live baselines (you)

Do these in Chrome with the unpacked `search/build` extension. Copy results into a note or paste into chat.

1. **Master list** — Settings → Data → Check now. Confirm anime count (~20k) and no error.
2. **Crunchyroll** — Signed-in CR tab → Settings → Where to watch → Read now. Record `titles`, `matched`, `%`.
3. **HIDIVE** — Open HIDIVE tab (reload once) → Read now. Record same.
4. **Tubi** — Open Tubi tab → Read now. Record same.
5. **Netflix** — Signed-in Netflix tab → Read now (Anime Series + Movies). Record same.
6. **Spot-check** — Open 3–5 show pages; confirm Watch / where-to-watch chips look right vs the service.
7. **Copy diagnostics** — Settings → Data → Copy diagnostics (includes match % lines). Paste here.

### Go / no-go (rough)

| Signal | Healthy ballpark |
|--------|------------------|
| Tubi / Netflix match % | High (anime-scoped sources) |
| HIDIVE match % | Solid; yearless titles may trail |
| CR match % | Lower OK — browse isn’t anime-only; **links** still high-confidence only |
| Empty / timeout errors | Fix tab/sign-in before integrating |

## Main page should consume

1. Wait until `title.canMatch` (master list ready).
2. Build where-to-watch via SW paths that already use `availability` / `withCatalogLinks` — don’t re-match titles in the main UI.
3. Treat `whereMap` as partial gap fill for Netflix/Prime/Hulu until a tab Netflix catalog (or a bigger feed) exists.
4. Reuse `KEYS.matches` remembered picks (`matchWithMemory`) so imports and main stay consistent.

## Favorite character (text mockup)

Settings → Favorite character: pick a pack; Home/popup show **text** welcome / look-here / tip lines from local banks (`src/lib/characters.js`). Optional later: AI paraphrases the same banks — still text, no audio.

## Still deferred

- TMDB-enriched where-map (needs `TMDB_API_KEY`)
- Crunchyroll anime-only browse (no reliable API flag; high-confidence match already gates links)
- Prime catalog reader, Tubi history import
- MAL client id in shipped constant (set in Accounts when you have one)
- Live AI paraphrase for character lines
