import { describe, it, expect } from "vitest";
import { dateValue, sortRowsByValue } from "@/app/admin/useSortableTable";

describe("dateValue", () => {
  it("converts ISO strings to timestamps and orders them correctly", () => {
    const a = dateValue("2025-01-01T00:00:00Z") as number;
    const b = dateValue("2026-01-01T00:00:00Z") as number;
    expect(typeof a).toBe("number");
    expect(a).toBeLessThan(b);
  });

  it("returns null for empty, nullish, or unparseable input", () => {
    expect(dateValue(null)).toBeNull();
    expect(dateValue(undefined)).toBeNull();
    expect(dateValue("")).toBeNull();
    expect(dateValue("not-a-date")).toBeNull();
  });
});

describe("sortRowsByValue", () => {
  it("sorts numbers ascending", () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const sorted = sortRowsByValue(rows, (r) => r.v, "asc");
    expect(sorted.map((r) => r.v)).toEqual([1, 2, 3]);
  });

  it("sorts numbers descending", () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const sorted = sortRowsByValue(rows, (r) => r.v, "desc");
    expect(sorted.map((r) => r.v)).toEqual([3, 2, 1]);
  });

  it("parks missing values at the end when sorting ascending", () => {
    const rows = [{ v: null }, { v: 2 }, { v: 1 }];
    const sorted = sortRowsByValue(rows, (r) => r.v, "asc");
    expect(sorted.map((r) => r.v)).toEqual([1, 2, null]);
  });

  it("parks missing values at the end when sorting descending too", () => {
    // The key invariant: flipping direction must not drag empty rows to the top.
    const rows = [{ v: null }, { v: 2 }, { v: 1 }];
    const sorted = sortRowsByValue(rows, (r) => r.v, "desc");
    expect(sorted.map((r) => r.v)).toEqual([2, 1, null]);
  });

  it("compares strings case-insensitively", () => {
    const rows = [{ v: "banana" }, { v: "Apple" }, { v: "cherry" }];
    const sorted = sortRowsByValue(rows, (r) => r.v, "asc");
    expect(sorted.map((r) => r.v)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("treats undefined as missing", () => {
    const rows = [{ v: undefined as string | undefined }, { v: "b" }, { v: "a" }];
    const sorted = sortRowsByValue(rows, (r) => r.v, "asc");
    expect(sorted.map((r) => r.v)).toEqual(["a", "b", undefined]);
  });

  it("does not mutate the input array", () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const snapshot = rows.map((r) => r.v);
    sortRowsByValue(rows, (r) => r.v, "asc");
    expect(rows.map((r) => r.v)).toEqual(snapshot);
  });
});
