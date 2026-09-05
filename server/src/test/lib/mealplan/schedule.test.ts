/**
 * lib/mealplan/schedule.ts — the consumer for `household_llm_settings.week_start_day`
 * / `.timezone`, which were fully migrated and exposed via Settings but had zero
 * consumers before this bug fix (every plan silently defaulted `startDate` to
 * "today" regardless of the configured week start).
 *
 * Pinned to a TZ far from any real household timezone under test (UTC+14) to prove
 * the local "today" is computed from the household's OWN configured timezone (passed
 * explicitly), never the process's local TZ — same technique as prompt.test.ts.
 */
process.env.TZ = "Pacific/Kiritimati";

import { describe, test, expect } from "bun:test";
import {
  computeDefaultMealPlanStartDate,
  isoWeekdayOfLocalDateString,
  localDateStringInTimezone,
} from "../../../lib/mealplan/schedule";

describe("localDateStringInTimezone", () => {
  test("renders the calendar date in the given IANA timezone, not the process TZ", () => {
    // 2026-03-01T04:30:00Z is still 2026-02-28 in America/New_York (UTC-5 in Feb).
    const now = new Date("2026-03-01T04:30:00.000Z");
    expect(localDateStringInTimezone(now, "America/New_York")).toBe("2026-02-28");
    // The same instant, in the process's pinned Pacific/Kiritimati (UTC+14), is
    // already 2026-03-01 — proving the function used the PASSED timezone, not TZ.
    expect(localDateStringInTimezone(now, "Pacific/Kiritimati")).toBe("2026-03-01");
  });
});

describe("isoWeekdayOfLocalDateString", () => {
  test("Monday is 1 and Sunday is 7", () => {
    expect(isoWeekdayOfLocalDateString("2026-03-02")).toBe(1); // Monday
    expect(isoWeekdayOfLocalDateString("2026-03-03")).toBe(2); // Tuesday
    expect(isoWeekdayOfLocalDateString("2026-03-07")).toBe(6); // Saturday
    expect(isoWeekdayOfLocalDateString("2026-03-08")).toBe(7); // Sunday
  });
});

describe("computeDefaultMealPlanStartDate", () => {
  test("today already matches the configured week start -> starts TODAY, not next week", () => {
    // 2026-03-02 is a Monday; week_start_day = 1 (Monday).
    const now = new Date("2026-03-02T15:00:00.000Z");
    expect(computeDefaultMealPlanStartDate(1, "America/New_York", now)).toBe("2026-03-02");
  });

  test("week starts Monday, today is Wednesday -> the UPCOMING Monday, never last Monday", () => {
    // 2026-03-04 is a Wednesday.
    const now = new Date("2026-03-04T15:00:00.000Z");
    expect(computeDefaultMealPlanStartDate(1, "America/New_York", now)).toBe("2026-03-09");
  });

  test("week starts Monday, today is Sunday (the day before) -> tomorrow, not 6 days back", () => {
    // 2026-03-08 is a Sunday.
    const now = new Date("2026-03-08T15:00:00.000Z");
    expect(computeDefaultMealPlanStartDate(1, "America/New_York", now)).toBe("2026-03-09");
  });

  test("never back-dates: the result is always today or a future date, for every weekday offset", () => {
    for (let weekStartDay = 1; weekStartDay <= 7; weekStartDay++) {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const now = new Date(Date.UTC(2026, 2, 2 + dayOffset, 15, 0, 0)); // 2026-03-02 is Monday
        const today = localDateStringInTimezone(now, "America/New_York");
        const result = computeDefaultMealPlanStartDate(weekStartDay, "America/New_York", now);
        expect(result >= today).toBe(true);
        expect(isoWeekdayOfLocalDateString(result)).toBe(weekStartDay);
      }
    }
  });

  test("DST-boundary week: America/New_York springs forward on 2026-03-08 (a 23-hour day), and the following week-start date is still exactly the next calendar day, not skipped or duplicated", () => {
    // 2026-03-08 is a Sunday, and the day US clocks spring forward (2am -> 3am
    // America/New_York). 11:30pm local on that day is already EDT (UTC-4).
    const now = new Date("2026-03-09T03:30:00.000Z"); // 2026-03-08T23:30 EDT
    expect(localDateStringInTimezone(now, "America/New_York")).toBe("2026-03-08");
    // week_start_day = 1 (Monday): the very next calendar day, crossing the DST
    // transition, must be 2026-03-09 — pure calendar-day arithmetic, unaffected by
    // the local 23-hour day.
    expect(computeDefaultMealPlanStartDate(1, "America/New_York", now)).toBe("2026-03-09");
  });

  test("DST-boundary week: America/New_York falls back on 2026-11-01 (a 25-hour day) without shifting the computed date", () => {
    // 2026-11-01 is a Sunday, and the day US clocks fall back (2am -> 1am
    // America/New_York). 11:30pm local is EST (UTC-5, post-transition).
    const now = new Date("2026-11-02T04:30:00.000Z"); // 2026-11-01T23:30 EST
    expect(localDateStringInTimezone(now, "America/New_York")).toBe("2026-11-01");
    expect(computeDefaultMealPlanStartDate(1, "America/New_York", now)).toBe("2026-11-02");
  });
});
