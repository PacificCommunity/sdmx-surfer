"use client";

import type { SortProps } from "./useSortableTable";

interface Props extends SortProps {
  label: string;
  className?: string;
  align?: "left" | "right";
  size?: "md" | "sm";
}

export function SortableHeader({
  label,
  active,
  direction,
  sortable,
  onClick,
  className = "",
  align = "left",
  size = "md",
}: Props) {
  const alignClass = align === "right" ? "justify-end text-right " : "";
  const textClass = size === "sm" ? "text-[10px] font-semibold uppercase tracking-wide " : "type-label-md ";

  if (!sortable) {
    return (
      <div className={textClass + "text-on-surface " + alignClass + className}>
        {label}
      </div>
    );
  }

  const indicator = active ? (direction === "asc" ? "↑" : "↓") : "↕";
  const indicatorClass = active ? "opacity-100 text-primary" : "opacity-30";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={
        active
          ? "Sorted " + (direction === "asc" ? "ascending" : "descending") + " — click to reverse"
          : "Sort by " + label
      }
      className={
        textClass +
        "flex cursor-pointer items-center gap-1 text-on-surface transition-colors hover:text-primary " +
        alignClass +
        className
      }
    >
      <span>{label}</span>
      <span aria-hidden="true" className={"text-[10px] tabular-nums " + indicatorClass}>
        {indicator}
      </span>
    </button>
  );
}
