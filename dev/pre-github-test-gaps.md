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

7. [x] MAL / trackers root: `tests/trackers.test.js`
8. [x] Id-map store gates: `tests/id-map-store.test.js`
9. [x] Dead-links + catalog-reader activity: `tests/link-check.test.js`, `tests/notification-style.test.js`
10. [x] Notification style helpers: `tests/notification-style.test.js`

## Manual smoke (needs your Chrome)

Do these on **your** signed-in Chrome (Monitor 1 is fine). Agent browser cannot use your profile or unpacked extension.

### 11. Netflix / HIDIVE / Tubi import + track-while-watching

- [ ] Load unpacked extension from this repo
- [ ] Site connected + tracking on for at least one of Netflix / HIDIVE / Tubi
- [ ] Finish (or near-finish) one anime episode; leave Import preview **closed**
- [ ] Wait 2–3 minutes
- [ ] Confirm Import sync note / backlog updated for that title
- [ ] Confirm AniList progress moved (or pending catch-up queued) — **not** that Continue watching auto-bumped

### 12. AniList connect → Import preview → Needs your pick → Apply

- [ ] AniList connected in Settings
- [ ] Open Import → run preview
- [ ] Hit at least one **Needs your pick** row; choose a match
- [ ] Apply; spot-check list/history reflects the choice

### 13. Settings toggles remount/paint

- [ ] Toggle **Remember last** (where-filter); leave Settings and reopen — value sticks
- [ ] Change **notification style**; trigger a toast/activity and confirm look matches

### 14. Packaged extension load smoke

- [ ] `npm run` / package zip (or Chrome “Pack extension”) produces a loadable build
- [ ] Load packaged build once; popup/options open without console errors on blank start

**Partner one-liner:** unpacked → AniList in → site connected → tracking on → finish one ep → wait 2–3 min (no open preview) → check Import sync + AniList. Continue watching stays put until list pull / local Watching mark.

## Suggested order

- [x] Full `npm test` — 700 pass
- [x] Fill high-priority root twins / importer / package
- [x] Medium root tests + push (`02b55a4` on `origin/search`)
- [ ] Manual smoke with you in Chrome (11–14 above)
- [ ] PR: https://github.com/Phoniix/crunchilist/compare/master...search (`gh` not installed / no token here — open from that compare link)
