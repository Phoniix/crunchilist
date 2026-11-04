# Crunchilist Search — retired as a shippable extension

Title search, where-to-watch feeds, multi-service catalogs, and matching now live in the main extension (**Kivori SekAI**).

Do **not** load `search/` (or `search/build/`) as a separate Chrome extension. Keep this folder only for:

- Feed build scripts (`scripts/id-map.mjs`, `scripts/where-map.mjs`) until they move to the repo root
- Historical tests and reference implementations being absorbed into `lib/` / `background/`

Ship and load only the repo root `manifest.json`.
