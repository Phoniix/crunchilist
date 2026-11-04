// Countdown labels for Home sections that refresh on a schedule.

export function updatesInParts(expiresAt, now = Date.now()) {
  const ms = Math.max(0, Number(expiresAt) - now);
  const hoursTotal = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(hoursTotal / 24);
  const hours = hoursTotal % 24;
  return { days, hours, overdue: !(Number(expiresAt) > now) };
}

/** e.g. "Updates in: 0D 3H" — floors to days and hours. */
export function updatesInLabel(expiresAt, now = Date.now()) {
  const { days, hours, overdue } = updatesInParts(expiresAt, now);
  if (overdue || !Number.isFinite(Number(expiresAt))) return "";
  return `Updates in: ${days}D ${hours}H`;
}
