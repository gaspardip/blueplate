import { describe, expect, test } from "bun:test";
import { localDateStr } from "../src/utils.js";

describe("localDateStr", () => {
  test("returns local date, not UTC (regression: 10pm ART digest saw no expenses)", () => {
    // 2026-03-28 22:00 ART = 2026-03-29 01:00 UTC
    // The old code used .toISOString().slice(0,10) which returned "2026-03-29"
    // The fix must return "2026-03-28" (the local date)
    const mar28at10pm = new Date(2026, 2, 28, 22, 0, 0); // month is 0-indexed
    expect(localDateStr(mar28at10pm)).toBe("2026-03-28");
  });

  test("returns local date at midnight", () => {
    const midnight = new Date(2026, 0, 15, 0, 0, 0);
    expect(localDateStr(midnight)).toBe("2026-01-15");
  });

  test("returns local date at 23:59", () => {
    const endOfDay = new Date(2026, 0, 15, 23, 59, 59);
    expect(localDateStr(endOfDay)).toBe("2026-01-15");
  });

  test("pads single-digit month and day", () => {
    const jan1 = new Date(2026, 0, 1, 12, 0, 0);
    expect(localDateStr(jan1)).toBe("2026-01-01");
  });
});
