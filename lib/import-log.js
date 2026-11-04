// Past imports are kept per source (each site, list and Import all), so a busy site never pushes another's out.
export const LOG_PER_SOURCE = 10;
export const LOG_ALL = 20;

// logs: newest first. Keeps the latest few of each source, in order.
export function keepLogs(logs) {
  const seen = {};
  return (Array.isArray(logs) ? logs : []).filter((item) => {
    if (!item || typeof item !== "object") return false;
    const source = String(item.service || "");
    seen[source] = (seen[source] || 0) + 1;
    return seen[source] <= (source === "all" ? LOG_ALL : LOG_PER_SOURCE);
  });
}
