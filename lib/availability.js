export function pageSeriesIds(observation) {
  const ids = new Set();
  for (const season of observation?.seasons || []) {
    if (season?.seriesId) ids.add(season.seriesId);
  }
  for (const sighting of observation?.sightings || []) {
    if (sighting?.seriesId) ids.add(sighting.seriesId);
  }
  return ids;
}

export function storedSeriesIds(state) {
  const ids = new Set();
  for (const season of Object.values(state?.seasons || {})) {
    if (season?.seriesId) ids.add(season.seriesId);
  }
  for (const seriesId of Object.keys(state?.sightings || {})) ids.add(seriesId);
  return ids;
}

export function classifyAvailability(state, observation) {
  const onPage = pageSeriesIds(observation);
  const stored = storedSeriesIds(state);
  return {
    eligible: [...stored].filter((id) => onPage.has(id)),
    retained: [...stored].filter((id) => !onPage.has(id)),
  };
}
