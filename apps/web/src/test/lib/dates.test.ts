import { describe, it, expect } from "vitest";
import {
  addDays,
  describeExpiry,
  digitsToCanonical,
  formatDigits,
  isoToDisplay,
  parseLocalDate,
  toIsoDateString,
} from "@/lib/dates";

describe("parseLocalDate", () => {
  it("parses a bare YYYY-MM-DD string at local midnight", () => {
    const d = parseLocalDate("2026-08-16");
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(7); // 0-indexed August
    expect(d?.getDate()).toBe(16);
    expect(d?.getHours()).toBe(0);
    expect(d?.getMinutes()).toBe(0);
  });

  it("parses a T-suffixed timestamp using only its date portion, never UTC-parsing", () => {
    const d = parseLocalDate("2026-08-16T00:00:00Z");
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(7);
    expect(d?.getDate()).toBe(16);
  });

  it("parses a T-suffixed timestamp with an offset the same way", () => {
    const d = parseLocalDate("2026-08-16T23:59:59-04:00");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(7);
    expect(d?.getDate()).toBe(16);
  });

  it("returns null for garbage input", () => {
    expect(parseLocalDate("")).toBeNull();
    expect(parseLocalDate("not-a-date")).toBeNull();
    expect(parseLocalDate("2026/08/16")).toBeNull();
  });

  it("returns null for an invalid calendar date", () => {
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("2026-13-01")).toBeNull();
  });

  it("accepts a valid leap day and rejects an invalid one", () => {
    expect(parseLocalDate("2024-02-29")).not.toBeNull();
    expect(parseLocalDate("2026-02-29")).toBeNull();
  });
});

describe("toIsoDateString", () => {
  it("builds YYYY-MM-DD from local Date components, zero-padded", () => {
    expect(toIsoDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toIsoDateString(new Date(2026, 7, 16))).toBe("2026-08-16");
    expect(toIsoDateString(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("addDays", () => {
  it("adds days in local time from an explicit `from` date", () => {
    expect(addDays(7, new Date(2026, 7, 16))).toBe("2026-08-23");
  });

  it("does not roll over via UTC when from is late in the local day", () => {
    // 23:30 local — the buggy `.toISOString()` pattern this replaces would
    // treat this instant as already "tomorrow" in a UTC-negative zone and
    // add the offset on top of that, landing on the 24th instead of 23rd.
    const from = new Date(2026, 7, 16, 23, 30, 0);
    expect(addDays(7, from)).toBe("2026-08-23");
  });

  it("crosses a month boundary correctly", () => {
    expect(addDays(20, new Date(2026, 7, 25))).toBe("2026-09-14");
  });

  it("defaults `from` to now when omitted", () => {
    const result = addDays(1);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatDigits", () => {
  it.each([
    ["", ""],
    ["0", "0"],
    ["08", "08"],
    ["081", "08/1"],
    ["0816", "08/16"],
    ["08162", "08/16/2"],
    ["08162026", "08/16/2026"],
  ])("formatDigits(%j) === %j", (input, expected) => {
    expect(formatDigits(input)).toBe(expected);
  });
});

describe("digitsToCanonical", () => {
  it("resolves 8-digit MMDDYYYY", () => {
    expect(digitsToCanonical("08162026")).toBe("2026-08-16");
  });

  it("resolves 6-digit MMDDYY, expanding to 20YY", () => {
    expect(digitsToCanonical("081626")).toBe("2026-08-16");
  });

  it("resolves 4-digit MMYY to the LAST day of that month", () => {
    expect(digitsToCanonical("0826")).toBe("2026-08-31");
    expect(digitsToCanonical("0226")).toBe("2026-02-28"); // non-leap Feb
    expect(digitsToCanonical("0224")).toBe("2024-02-29"); // leap Feb
    expect(digitsToCanonical("0426")).toBe("2026-04-30"); // 30-day month
  });

  it("treats a 4-digit entry as MM/YY, never MM/DD", () => {
    // "0230" as MM/DD would be invalid (Feb 30); as MM/YY (Feb 2030) it must
    // resolve to end-of-month, proving the ambiguity rule is MM/YY-always.
    expect(digitsToCanonical("0230")).toBe("2030-02-28");
  });

  it("returns '' for incomplete lengths (still typing)", () => {
    expect(digitsToCanonical("")).toBe("");
    expect(digitsToCanonical("0")).toBe("");
    expect(digitsToCanonical("08")).toBe("");
    expect(digitsToCanonical("081")).toBe("");
    expect(digitsToCanonical("08162")).toBe("");
    expect(digitsToCanonical("0816202")).toBe("");
  });

  it("rejects an invalid month", () => {
    expect(digitsToCanonical("13162026")).toBe("");
    expect(digitsToCanonical("00162026")).toBe("");
  });

  it("rejects an invalid month in the 4-digit MM/YY path", () => {
    // "13" is not a valid month regardless of year — the 4-digit branch's
    // own `mm < 1 || mm > 12` guard (distinct from the 6/8-digit
    // round-trip check) must catch this.
    expect(digitsToCanonical("1326")).toBe("");
  });

  it("rejects an invalid day via round-trip check (Feb 30 rolls to March)", () => {
    expect(digitsToCanonical("02302026")).toBe("");
  });

  it("accepts a valid leap day and rejects an invalid one", () => {
    expect(digitsToCanonical("02292024")).toBe("2024-02-29");
    expect(digitsToCanonical("02292026")).toBe("");
  });
});

describe("isoToDisplay", () => {
  it("converts canonical to display format", () => {
    expect(isoToDisplay("2026-08-16")).toBe("08/16/2026");
  });

  it("returns '' for empty or unparseable input", () => {
    expect(isoToDisplay("")).toBe("");
    expect(isoToDisplay("garbage")).toBe("");
  });
});

describe("describeExpiry", () => {
  const today = new Date(2026, 7, 16); // fixed "now" — never a string literal

  it("describes today and tomorrow", () => {
    expect(describeExpiry("2026-08-16", today)).toBe("Expires today");
    expect(describeExpiry("2026-08-17", today)).toBe("Expires tomorrow");
  });

  it("describes a handful of days out", () => {
    expect(describeExpiry("2026-08-21", today)).toBe("Expires in 5 days");
  });

  it("describes weeks out (well inside the bucket, not at a boundary)", () => {
    expect(describeExpiry("2026-09-06", today)).toBe("Expires in 3 weeks");
  });

  it("describes months out (well inside the bucket)", () => {
    expect(describeExpiry("2026-11-14", today)).toBe("Expires in 3 months");
  });

  it("describes years out", () => {
    expect(describeExpiry("2028-08-16", today)).toBe("Expires in 2 years");
  });

  it("describes past dates as expired N days ago", () => {
    expect(describeExpiry("2026-08-12", today)).toBe("Expired 4 days ago");
  });

  it("compares at local-midnight granularity regardless of time of day", () => {
    const lateInDay = new Date(2026, 7, 16, 23, 45, 0);
    expect(describeExpiry("2026-08-17", lateInDay)).toBe("Expires tomorrow");
  });

  it("returns '' for empty/unparseable input", () => {
    expect(describeExpiry("", today)).toBe("");
  });
});
