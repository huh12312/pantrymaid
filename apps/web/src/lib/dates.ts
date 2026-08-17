/**
 * Pure, local-time date helpers.
 *
 * The recurring bug this file exists to prevent: `new Date("2026-08-16")` and
 * `.toISOString()` both operate in UTC. On a machine west of UTC (e.g.
 * America/New_York) that silently displays the *previous* day, and on a
 * machine east of UTC it silently rolls a computed date *forward* a day.
 * Every function below builds dates from `getFullYear`/`getMonth`/`getDate`
 * (local) and never touches `.toISOString()` or `new Date(isoString)`.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function monthAbbreviation(monthIndex: number): string {
  return MONTH_ABBR[monthIndex] ?? "";
}

/**
 * Parses a bare `"YYYY-MM-DD"` or a `T`-suffixed `"YYYY-MM-DDTHH:mm:ssZ"` (or
 * similar) string into a `Date` constructed at LOCAL midnight. The `T`
 * suffix, if present, is only used to confirm the string still starts with a
 * date; everything after the date portion is discarded rather than parsed,
 * so this never depends on the machine's UTC offset. Returns null for
 * anything that isn't a well-formed, valid calendar date.
 */
export function parseLocalDate(iso: string): Date | null {
  // Defensive guard at an untyped boundary: the client never routes
  // `expirationDate` through Zod coercion today, so `iso` is always a
  // string in practice — but if that ever changes, a `Date` object here
  // would silently fail the regex below, return null, and render an empty
  // field. That's dangerous specifically because of DateInput's blur/submit
  // resolution path: the first touch of an "empty-looking" field can emit ""
  // and clear a date that was actually still present in the database.
  if (typeof iso !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;

  const yStr = match[1];
  const mStr = match[2];
  const dStr = match[3];
  if (yStr === undefined || mStr === undefined || dStr === undefined) return null;

  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);

  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return null;
  }
  return dt;
}

/** Builds `"YYYY-MM-DD"` from a Date's LOCAL components. Never `.toISOString()`. */
export function toIsoDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns the local `"YYYY-MM-DD"` that is `days` days from `from` (defaults
 * to now). Replaces the buggy
 * `new Date(Date.now() + n*86400000).toISOString().split("T")[0]` pattern,
 * which rolls a date over a day early in UTC-negative timezones once local
 * time has already crossed midnight in UTC.
 */
export function addDays(days: number, from: Date = new Date()): string {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  base.setDate(base.getDate() + days);
  return toIsoDateString(base);
}

/**
 * Progressive MM/DD/YYYY mask over a digit string (already stripped of
 * non-digits, at most 8 characters). Inserts a `/` after the 2nd and 4th
 * digit, but only once a following digit exists — so a lone "08" stays "08"
 * rather than becoming "08/".
 */
export function formatDigits(digits: string): string {
  const d = digits.slice(0, 8);
  let out = "";
  for (let i = 0; i < d.length; i++) {
    if (i === 2 || i === 4) out += "/";
    out += d.charAt(i);
  }
  return out;
}

function buildValidatedDate(month: number, day: number, year: number): string {
  if (month < 1 || month > 12) return "";
  if (day < 1 || day > 31) return "";
  const dt = new Date(year, month - 1, day);
  // Round-trip check: JS silently rolls an out-of-range day/month forward
  // (e.g. Feb 30 -> Mar 2) instead of throwing. If what we read back doesn't
  // match what we put in, the input was invalid.
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return "";
  }
  return toIsoDateString(dt);
}

/**
 * Resolves a digit string (already stripped of separators) to a canonical
 * "YYYY-MM-DD", or "" if it can't be resolved yet/at all.
 *
 * Accepted lengths:
 * - 8 digits: MMDDYYYY, validated as-is.
 * - 6 digits: MMDDYY, YY expanded to 20YY.
 * - 4 digits: MMYY — month + 2-digit year, WITH NO DAY. This is extremely
 *   common on food packaging ("BEST BY 08/26"). It expands YY to 20YY and
 *   auto-completes to the LAST day of that month, not the first: "best by
 *   AUG 2026" means good through the whole month, and defaulting to the 1st
 *   would falsely trip a 7-day "expiring soon" warning nearly a month early.
 *
 * Ambiguity rule (deliberate, not inferred): a 4-digit entry is ALWAYS
 * interpreted as MM/YY, never as MM/DD. MM/DD with no year is useless for
 * expiry tracking, so there is no real ambiguity to resolve here — but this
 * comment exists because it looks arbitrary out of context.
 *
 * Any other digit count (1, 2, 3, 5, 7) returns "" — the entry is still
 * incomplete, not invalid.
 */
export function digitsToCanonical(digits: string): string {
  if (digits.length === 8) {
    const mm = Number(digits.slice(0, 2));
    const dd = Number(digits.slice(2, 4));
    const yyyy = Number(digits.slice(4, 8));
    return buildValidatedDate(mm, dd, yyyy);
  }

  if (digits.length === 6) {
    const mm = Number(digits.slice(0, 2));
    const dd = Number(digits.slice(2, 4));
    const yyyy = 2000 + Number(digits.slice(4, 6));
    return buildValidatedDate(mm, dd, yyyy);
  }

  if (digits.length === 4) {
    const mm = Number(digits.slice(0, 2));
    const yyyy = 2000 + Number(digits.slice(2, 4));
    if (mm < 1 || mm > 12) return "";
    // new Date(year, M, 0) with M as the 1-indexed target month yields the
    // last day of that month (day 0 of the following month, 0-indexed).
    const lastDay = new Date(yyyy, mm, 0).getDate();
    return buildValidatedDate(mm, lastDay, yyyy);
  }

  return "";
}

/** `"2026-08-16"` -> `"08/16/2026"`. `""` (or unparseable) -> `""`. */
export function isoToDisplay(iso: string): string {
  const dt = parseLocalDate(iso);
  if (!dt) return "";
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const yyyy = String(dt.getFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Human-readable relative description of an expiry date, compared at
 * local-midnight granularity (both sides truncated to Y/M/D) so the result
 * never depends on the time of day `now` happens to be.
 */
export function describeExpiry(iso: string, now: Date = new Date()): string {
  const dt = parseLocalDate(iso);
  if (!dt) return "";

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);

  if (diffDays === 0) return "Expires today";
  if (diffDays === 1) return "Expires tomorrow";

  if (diffDays < 0) {
    const daysAgo = Math.abs(diffDays);
    return `Expired ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
  }

  if (diffDays < 7) {
    return `Expires in ${diffDays} days`;
  }

  if (diffDays < 30) {
    const weeks = Math.round(diffDays / 7);
    return `Expires in ${weeks} week${weeks === 1 ? "" : "s"}`;
  }

  if (diffDays < 365) {
    const months = Math.round(diffDays / 30);
    return `Expires in ${months} month${months === 1 ? "" : "s"}`;
  }

  const years = Math.round(diffDays / 365);
  return `Expires in ${years} year${years === 1 ? "" : "s"}`;
}
