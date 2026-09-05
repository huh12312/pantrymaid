/**
 * Pure default-`startDate` computation for meal plans (plan §3, §11 — "week_start_day
 * has zero consumers" bugfix).
 *
 * `household_llm_settings.week_start_day` (ISO, 1 = Monday) and `.timezone` are fully
 * migrated, returned by `GET /api/settings/llm`, and accepted by `PUT`, but nothing
 * ever read them: `POST /api/meal-plans` always defaulted `startDate` to whatever the
 * client sent (typically "today"), so a household configured "week starts Monday"
 * still got a Wednesday-to-Tuesday plan when they generated on a Wednesday.
 *
 * This module is the consumer: when the request omits `startDate`, the route
 * (`routes/meal-plans.ts`) defaults it to the household's next/current configured
 * week start, computed here. A plan must never start in the past — if today is
 * Wednesday and the week starts Monday, this returns the UPCOMING Monday, never last
 * Monday.
 *
 * Every function here is a pure function of its arguments — `now` is always injected,
 * never read via `new Date()` — and all date math is local-date-STRING arithmetic
 * (epoch-day UTC math on parsed calendar parts), never `Date.toISOString()`, which
 * reads UTC and can be a day off from the household's actual local date near a
 * timezone boundary (plan §11 A8, and the prior art at `generate.ts`'s
 * `addDaysToLocalDateString`).
 */

import { addDaysToLocalDateString } from "./generate";

/**
 * Renders `date` as a `YYYY-MM-DD` string in the IANA `timezone`'s local calendar day,
 * via `Intl.DateTimeFormat`'s `en-CA` locale (which formats as `YYYY-MM-DD` directly)
 * — never `date.toISOString()`, which is always UTC and can disagree with the
 * household's local date by a day near midnight in their timezone.
 */
export function localDateStringInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * ISO weekday (1 = Monday ... 7 = Sunday) of a `YYYY-MM-DD` local-date string.
 * Computed from the parsed calendar parts via `Date.UTC` epoch-day arithmetic — the
 * `Date` constructed here is only ever used as a UTC calendar calculator, never
 * interpreted in any timezone, so it stays pure local-date-string math.
 */
export function isoWeekdayOfLocalDateString(dateStr: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) throw new Error(`Invalid local date string: ${dateStr}`);
  const [, y, m, d] = match;
  const utcDay = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay(); // 0=Sun..6=Sat
  return utcDay === 0 ? 7 : utcDay;
}

/**
 * Defaults a meal plan's `startDate` to the household's configured week start
 * (`week_start_day`, ISO 1=Monday, `timezone`) when the request omits an explicit
 * date.
 *
 * Never back-dates: if today (in the household's timezone) already falls on the
 * configured week-start weekday, the plan starts TODAY; otherwise it starts on the
 * NEXT upcoming occurrence of that weekday (at most 6 days out), never a past one.
 */
export function computeDefaultMealPlanStartDate(
  weekStartDay: number,
  timezone: string,
  now: Date
): string {
  const today = localDateStringInTimezone(now, timezone);
  const todayIsoWeekday = isoWeekdayOfLocalDateString(today);
  const daysUntilWeekStart = (weekStartDay - todayIsoWeekday + 7) % 7;
  return addDaysToLocalDateString(today, daysUntilWeekStart);
}
