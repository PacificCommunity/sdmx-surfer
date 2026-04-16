"use client";

import { useCallback, useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

export type SortValue = number | string;

export interface SortableColumn<T, K extends string> {
  key: K;
  // Project a row to a comparable scalar. Return null/undefined for "missing",
  // and the hook will park the row at the end regardless of sort direction.
  getValue?: (row: T) => SortValue | null | undefined;
  defaultDir?: SortDir;
}

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

export interface SortProps {
  active: boolean;
  direction: SortDir;
  sortable: boolean;
  onClick: () => void;
}

// Convert an ISO timestamp to a numeric sort value. Invalid or empty strings
// become null so the hook treats them as missing.
export function dateValue(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}

// Exported for direct testing. Missing values always land last, regardless of
// direction — flipping "asc"→"desc" never drags empty rows to the top.
export function sortRowsByValue<T>(
  rows: T[],
  getValue: (row: T) => SortValue | null | undefined,
  dir: SortDir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getValue(a);
    const vb = getValue(b);
    const aMissing = va == null;
    const bMissing = vb == null;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return sign * compareValues(va, vb);
  });
}

interface UseSortableTableArgs<T, K extends string> {
  rows: T[];
  columns: SortableColumn<T, K>[];
  initialSort?: SortState<K>;
  searchText?: (row: T) => string;
}

export interface UseSortableTableResult<T, K extends string> {
  displayRows: T[];
  sort: SortState<K> | null;
  toggleSort: (key: K) => void;
  getSortProps: (key: K) => SortProps;
  query: string;
  setQuery: (q: string) => void;
  totalCount: number;
  matchedCount: number;
}

export function useSortableTable<T, K extends string>(
  args: UseSortableTableArgs<T, K>,
): UseSortableTableResult<T, K> {
  const { rows, columns, initialSort, searchText } = args;
  const [sort, setSort] = useState<SortState<K> | null>(initialSort ?? null);
  const [query, setQuery] = useState("");

  const colByKey = useMemo(() => {
    const m = new Map<K, SortableColumn<T, K>>();
    for (const c of columns) m.set(c.key, c);
    return m;
  }, [columns]);

  const toggleSort = useCallback(
    (key: K) => {
      setSort((prev) => {
        const col = colByKey.get(key);
        if (!col?.getValue) return prev;
        const defaultDir: SortDir = col.defaultDir ?? "asc";
        if (!prev || prev.key !== key) return { key, dir: defaultDir };
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      });
    },
    [colByKey],
  );

  const getSortProps = useCallback(
    (key: K): SortProps => {
      const col = colByKey.get(key);
      const sortable = !!col?.getValue;
      const isActive = sort !== null && sort.key === key;
      const direction: SortDir = isActive
        ? sort.dir
        : col?.defaultDir ?? "asc";
      return {
        active: isActive,
        direction,
        sortable,
        onClick: () => toggleSort(key),
      };
    },
    [colByKey, sort, toggleSort],
  );

  const displayRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let filtered: T[] = rows;
    if (q && searchText) {
      filtered = rows.filter((row) => searchText(row).toLowerCase().includes(q));
    }
    if (!sort) return filtered;
    const col = colByKey.get(sort.key);
    if (!col?.getValue) return filtered;
    return sortRowsByValue(filtered, col.getValue, sort.dir);
  }, [rows, query, sort, colByKey, searchText]);

  return {
    displayRows,
    sort,
    toggleSort,
    getSortProps,
    query,
    setQuery,
    totalCount: rows.length,
    matchedCount: displayRows.length,
  };
}
