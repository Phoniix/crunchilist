# Where-map feed updates

Remote files (branch `search`):

- https://raw.githubusercontent.com/Phoniix/crunchilist/search/search/feeds/where-map-meta.json
- https://raw.githubusercontent.com/Phoniix/crunchilist/search/search/feeds/where-map.json

How to verify a new publish: open the meta URL and check `updated` + `stats.total` changed.

| `updated` | Shows (`stats.total`) | Notes |
|-----------|------------------------|--------|
| `2026-10-16` | **708** | First publish (fixes remote 404). AniList popular harvest, no dead-link drops recorded. |
| `2026-10-16b` | **1080** | Second publish. `WHERE_MAP_PAGES=100`, dead-link probe dropped **204** URLs. See `where-map-build.log`. |

Build log excerpt (second run):

```
Harvesting AniList streaming links (up to 100 pages)…
where-map: 1080 shows, dropped 204 dead URLs -> search/feeds/where-map.json
```
