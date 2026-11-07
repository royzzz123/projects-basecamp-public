import { useState } from "react";
import { Sort, ArrowUp01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { HugeiconsProps } from "@hugeicons/react";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc" | null;

interface SortableHeadProps {
  icon: React.ReactNode;
  label: string;
  sortKey: string;
  sortBy: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
  align?: "left" | "center" | "right";
}

export function SortableHead({
  icon,
  label,
  sortKey,
  sortBy,
  sortDir,
  onSort,
  className,
  align = "left",
}: SortableHeadProps) {
  const active = sortBy === sortKey;
  const sortIcon: NonNullable<HugeiconsProps["icon"]> = active
    ? sortDir === "asc"
      ? ArrowUp01Icon
      : ArrowDown01Icon
    : Sort;

  return (
    <th
      className={cn(
        "h-10 px-3 align-middle text-[11px] font-medium text-muted-foreground",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-2 rounded-md transition-colors hover:text-foreground select-none",
          align === "right" && "flex-row-reverse",
          align === "center" && "mx-auto",
        )}
      >
        {/* Boxed icon */}
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-muted-foreground",
            active && "border-primary/30 bg-primary/[0.06] text-primary",
          )}
        >
          {icon}
        </span>
        <span className={cn("text-[11px] font-medium", active && "text-foreground")}>{label}</span>
        <HugeiconsIcon
          icon={sortIcon}
          className={cn("h-3 w-3 shrink-0", active ? "text-primary" : "text-muted-foreground/40")}
          strokeWidth={1.5}
        />
      </button>
    </th>
  );
}

export function useSortState() {
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  function onSort(key: string) {
    if (sortBy === key) {
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") {
        setSortBy(null);
        setSortDir(null);
      } else setSortDir("asc");
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  }

  function applySort<T extends Record<string, unknown>>(rows: T[]): T[] {
    if (!sortBy || !sortDir) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  return { sortBy, sortDir, onSort, applySort };
}
