# Pre-GitHub test gaps

Discovery feed stays on hold. Track-while-watching does **not** live-update Continue watching (AniList catch-up only).

## High priority

1. [x] Root twins: `tests/backup-and-lists.test.js`, `tests/import-plan.test.js` (import-log already had root coverage)
2. [x] Importer pending: `tests/resolve-pending.test.js` (skip + missing key + preview gate)
3. [x] Import UI contracts: `tests/import-pane.test.js`
4. [x] Root characters / Kivi: `tests/characters.test.js`
5. [x] `whereFilterMode` remember vs host: `tests/where-filter.test.js`
6. [x] Package assets: `tests/package.test.js` asserts import-pane, kivi.png, feeds

## Medium priority

7. [ ] MAL / tracker-pull root coverage (still thin)
8. [ ] Id-map / title-search store version gates
9. [ ] Dead-links / catalog-reader activity tagging
10. [ ] Notification style / paintSettingControls helpers

## Manual smoke (needs your Chrome)

11. [ ] Netflix / HIDIVE / Tubi import + track-while-watching
12. [ ] AniList connect → Import preview → Needs your pick → Apply
13. [ ] Settings toggles remount/paint (Remember last, notification style)
14. [ ] Packaged extension load smoke

**Partner checklist for 11–14:** load unpacked extension → AniList signed in → site connected → tracking on → finish one anime ep → wait 2–3 min (no open preview) → check Import sync note + AniList progress. Continue watching will not move until AniList list pull / local Watching mark.

## Suggested order

- [x] Full `npm test` (passing after gap tests)
- [x] Fill high-priority root twins / importer / package
- [ ] Manual smoke with you in Chrome
- [ ] Commit / PR
