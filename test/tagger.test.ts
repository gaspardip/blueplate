import { describe, expect, it } from "bun:test";
import { inferTagNames, resolveTagIds } from "../src/tagger.js";

describe("inferTagNames", () => {
  it("returns recurring for streaming services", () => {
    expect(inferTagNames("📺 Streaming Services")).toEqual(["recurring"]);
  });

  it("returns eating-out for restaurants", () => {
    expect(inferTagNames("🍽️ Restaurants")).toEqual(["eating-out"]);
  });

  it("returns eating-out for coffee shops", () => {
    expect(inferTagNames("☕ Coffee Shops")).toEqual(["eating-out"]);
  });

  it("returns transit for rideshare", () => {
    expect(inferTagNames("🚕 Rideshare, Taxi")).toEqual(["transit"]);
  });

  it("returns delivery for food delivery", () => {
    expect(inferTagNames("📦 Food Delivery")).toEqual(["delivery"]);
  });

  it("returns recurring for rent", () => {
    expect(inferTagNames("💵 Rent, Mortgage")).toEqual(["recurring"]);
  });

  it("returns recurring for tools", () => {
    expect(inferTagNames("🔧 Tools")).toEqual(["recurring"]);
  });

  it("returns empty for unknown category", () => {
    expect(inferTagNames("🎸 Hobbies")).toEqual([]);
  });

  it("returns empty for undefined", () => {
    expect(inferTagNames(undefined)).toEqual([]);
  });

  it("strips emoji before matching", () => {
    expect(inferTagNames("Streaming Services")).toEqual(["recurring"]);
  });
});

describe("resolveTagIds", () => {
  const tags = [
    { id: 1, name: "recurring" },
    { id: 2, name: "delivery" },
    { id: 3, name: "eating-out" },
    { id: 4, name: "transit" },
  ];

  it("resolves known tag names to IDs", () => {
    expect(resolveTagIds(["recurring", "eating-out"], tags)).toEqual([1, 3]);
  });

  it("skips unknown tag names", () => {
    expect(resolveTagIds(["recurring", "unknown"], tags)).toEqual([1]);
  });

  it("returns empty for no matches", () => {
    expect(resolveTagIds(["nonexistent"], tags)).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(resolveTagIds(["Recurring"], tags)).toEqual([1]);
  });

  it("returns empty for empty input", () => {
    expect(resolveTagIds([], tags)).toEqual([]);
  });
});
