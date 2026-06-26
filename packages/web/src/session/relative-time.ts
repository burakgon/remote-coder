/**
 * Compact, scannable relative-time formatter for the session rail's meta line (e.g. `now`, `2m`,
 * `1h`, `3d`). Deliberately PURE — both timestamps are passed in (no `Date.now()` here) so it's
 * trivially testable; the caller (store/handlers) owns the clock. Clamps negative deltas (a clock
 * skew where `then` is slightly in the future) to `now` rather than printing a nonsense `-1s`.
 */
export function relativeTime(then: number, now: number): string {
  const deltaMs = now - then;
  if (deltaMs < 0) return "now";
  const sec = Math.floor(deltaMs / 1000);
  // < 60s is "now" (not 45): at 45–59s, Math.floor(sec/60) is 0, which printed a nonsense "0m".
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  // Past ~a month, weeks stop being meaningful at a glance; fall back to a rough month/year count.
  // Cap at 11mo below a full year so days 360–364 (where floor(day/30)===12 but floor(day/365)===0)
  // don't render a nonsense "0y" — they read "11mo", then "1y" at day 365.
  const mo = Math.floor(day / 30);
  if (day < 365) return `${Math.min(mo, 11)}mo`;
  return `${Math.floor(day / 365)}y`;
}
