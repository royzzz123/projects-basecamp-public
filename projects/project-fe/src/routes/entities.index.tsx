import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Building03Icon,
  Grid,
  ListViewIcon,
  Hashtag,
  Tag01Icon,
  AlertDiamondIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead, useSortState } from "@/components/SortableHead";
import { EmptyState } from "@/components/PageHeader";
import { AppFilterBar } from "@/components/AppFilterBar";
import { listEntities, filterEntities, type EntityListItem } from "@/lib/api";
import { TableSkeleton } from "@/components/TableSkeleton";
import { toast } from "sonner";

export const Route = createFileRoute("/entities/")({
  head: () => ({
    meta: [
      { title: "Entities — OnFinance AI" },
      { name: "description", content: "All registered entities and intermediaries." },
    ],
  }),
  component: EntitiesPage,
});

const ENTITY_CATEGORIES = [
  "Bankers to the issue",
  "Category 1 Alternative Investment Fund",
  "Category 2 Alternative Investment Fund",
  "Category 3 Alternative Investment Fund",
  "Depository Participant",
  "Investment Advisors",
  "KYC Registration Agency",
  "Merchant Bankers",
  "Mutual Fund",
  "Portfolio Manager",
  "Research Analyst",
  "Stock Broker",
  "Venture Capital Fund",
];

function EntitiesPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<"table" | "card">("table");
  const [rawItems, setRawItems] = useState<EntityListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [entityType, setEntityType] = useState("all");

  const PAGE = 50;

  useEffect(() => {
    setLoading(true);
    listEntities({
      limit: PAGE,
      after: cursors[pageIdx] ?? undefined,
      ...(category !== "all" && { category: [category] }),
      ...(entityType !== "all" && { entity_type: [entityType] }),
    })
      .then((res) => {
        setRawItems(res.items ?? []);
        setNextCursor(res.next_cursor);
        setTotal(res.total);
      })
      .catch(() => toast.error("Failed to load intermediaries"))
      .finally(() => setLoading(false));
  }, [pageIdx, cursors, category, entityType]);

  const resetPage = () => {
    setPageIdx(0);
    setCursors([null]);
  };

  const items = useMemo(() => {
    if (!search.trim()) return rawItems;
    const q = search.toLowerCase();
    return rawItems.filter(
      (e) =>
        e.entity.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        (e.category ?? "").toLowerCase().includes(q) ||
        (e.registration_number ?? "").toLowerCase().includes(q) ||
        e.entity_type.toLowerCase().includes(q),
    );
  }, [rawItems, search]);

  const goNext = () => {
    if (!nextCursor) return;
    setCursors([...cursors.slice(0, pageIdx + 1), nextCursor]);
    setPageIdx(pageIdx + 1);
  };
  const goPrev = () => {
    if (pageIdx > 0) setPageIdx(pageIdx - 1);
  };

  const { sortBy, sortDir, onSort, applySort } = useSortState();
  const sorted = applySort(
    items as unknown as Record<string, unknown>[],
  ) as unknown as EntityListItem[];

  const fetchEntitySuggestions = async (q: string) => {
    const res = await filterEntities({ q, limit: 8 });
    return (res.items ?? []).map((e) => ({ id: e.id, label: e.name }));
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <AppFilterBar
        title="Entities"
        description={loading ? "Loading…" : `${total.toLocaleString("en-IN")} entities`}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, ID, category…"
        fetchSearchSuggestions={fetchEntitySuggestions}
        onSearchSuggestionSelect={(id) => navigate({ to: "/entities/$id", params: { id } })}
        filters={[
          {
            id: "entityType",
            label: "Entity Type",
            value: entityType,
            options: [
              { id: "intermediary", label: "Intermediary" },
              { id: "listed", label: "Listed" },
            ],
            onChange: (v) => {
              setEntityType(v);
              resetPage();
            },
          },
          {
            id: "category",
            label: "Category",
            value: category,
            options: ENTITY_CATEGORIES.map((c) => ({ id: c, label: c })),
            onChange: (v) => {
              setCategory(v);
              resetPage();
            },
          },
        ]}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("table")}
              className="h-7 w-7 p-0"
            >
              <HugeiconsIcon icon={ListViewIcon} className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
            <Button
              variant={view === "card" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("card")}
              className="h-7 w-7 p-0"
            >
              <HugeiconsIcon icon={Grid} className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          </div>
        }
      />

      {loading ? (
        <TableSkeleton
          columns={9}
          rows={12}
          colWidths={["w-64", "w-40", "w-32", "w-20", "w-16", "w-16", "w-16", "w-24", "w-24"]}
        />
      ) : items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<HugeiconsIcon icon={Building03Icon} className="h-5 w-5" strokeWidth={1.5} />}
            title="No entities found"
            description="Try adjusting your search."
          />
        </div>
      ) : view === "table" ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-auto rounded-xl border border-border bg-card">
            <Table className="[&_th:not(:last-child)]:border-r [&_th:not(:last-child)]:border-border [&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-border">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border">
                  <SortableHead
                    icon={
                      <HugeiconsIcon icon={Building03Icon} className="h-3 w-3" strokeWidth={1.5} />
                    }
                    label="Entity"
                    sortKey="entity"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                    className="w-[360px] min-w-[360px]"
                  />
                  <SortableHead
                    icon={<HugeiconsIcon icon={Tag01Icon} className="h-3 w-3" strokeWidth={1.5} />}
                    label="Category"
                    sortKey="category"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={<HugeiconsIcon icon={Hashtag} className="h-3 w-3" strokeWidth={1.5} />}
                    label="Registration No."
                    sortKey="registration_number"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon
                        icon={AlertDiamondIcon}
                        className="h-3 w-3"
                        strokeWidth={1.5}
                      />
                    }
                    label="Total Complaints"
                    sortKey="total_complaints"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon
                        icon={AlertDiamondIcon}
                        className="h-3 w-3"
                        strokeWidth={1.5}
                      />
                    }
                    label="Open"
                    sortKey="open_complaints"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon
                        icon={AlertDiamondIcon}
                        className="h-3 w-3"
                        strokeWidth={1.5}
                      />
                    }
                    label="Closed"
                    sortKey="closed_complaints"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon
                        icon={AlertDiamondIcon}
                        className="h-3 w-3"
                        strokeWidth={1.5}
                      />
                    }
                    label="L1 Escalated"
                    sortKey="first_level_review_escalated"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon
                        icon={AlertDiamondIcon}
                        className="h-3 w-3"
                        strokeWidth={1.5}
                      />
                    }
                    label="L2 Escalated"
                    sortKey="second_level_review_escalated"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="w-[360px] min-w-[360px]">
                      <div className="flex flex-col gap-1">
                        <Link
                          to="/entities/$id"
                          params={{ id: e.id }}
                          className="text-[13px] font-medium text-foreground hover:text-primary hover:underline leading-snug"
                        >
                          {e.entity}
                        </Link>
                        {e.entity_type && <EntityTypeDot type={e.entity_type} />}
                      </div>
                    </TableCell>
                    <TableCell>
                      {e.category ? (
                        <CategoryBadge name={e.category} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {e.registration_number ? (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {e.registration_number}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-[13px] font-medium text-foreground text-right">
                      {e.total_complaints >= 0 ? (
                        e.total_complaints.toLocaleString("en-IN")
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-[13px] text-right">
                      <span
                        className={
                          e.open_complaints > 0
                            ? "font-medium text-[var(--status-warn)]"
                            : "text-muted-foreground"
                        }
                      >
                        {e.open_complaints >= 0 ? e.open_complaints.toLocaleString("en-IN") : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-[13px] text-right">
                      <span
                        className={
                          e.closed_complaints > 0
                            ? "font-medium text-[var(--status-resolved)]"
                            : "text-muted-foreground"
                        }
                      >
                        {e.closed_complaints >= 0
                          ? e.closed_complaints.toLocaleString("en-IN")
                          : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="w-36">
                      {e.first_level_review_escalated >= 0 ? (
                        <EscalationBar
                          count={e.first_level_review_escalated}
                          pct={e.first_level_review_escalation_pct}
                          color="amber"
                        />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="w-36">
                      {e.second_level_review_escalated >= 0 ? (
                        <EscalationBar
                          count={e.second_level_review_escalated}
                          pct={e.second_level_review_escalation_pct}
                          color="rose"
                        />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 text-[12px] text-muted-foreground">
            <span>
              Page {pageIdx + 1} of {Math.ceil(total / PAGE)}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={goPrev}
                disabled={pageIdx === 0}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={goNext}
                disabled={!nextCursor}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 min-h-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 overflow-auto">
            {items.map((e) => (
              <Link
                key={e.id}
                to="/entities/$id"
                params={{ id: e.id }}
                className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <HugeiconsIcon icon={Building03Icon} className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <h3 className="mt-3 text-[13px] font-semibold">{e.entity}</h3>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">{e.id}</p>
                {e.category && (
                  <p className="mt-1 text-[11px] text-muted-foreground truncate">{e.category}</p>
                )}
                {e.total_complaints > 0 && (
                  <div className="mt-2 flex items-center gap-3 text-[11px]">
                    <span className="text-muted-foreground">{e.total_complaints} complaints</span>
                    {e.open_complaints > 0 && (
                      <span className="text-[var(--status-warn)]">{e.open_complaints} open</span>
                    )}
                  </div>
                )}
              </Link>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 text-[12px] text-muted-foreground">
            <span>
              Page {pageIdx + 1} of {Math.ceil(total / PAGE)}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={goPrev}
                disabled={pageIdx === 0}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={goNext}
                disabled={!nextCursor}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EntityTypeDot({ type }: { type: string }) {
  const isIntermediary = type.toLowerCase() === "intermediary";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide ${isIntermediary ? "text-blue-500 dark:text-blue-400" : "text-purple-500 dark:text-purple-400"}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${isIntermediary ? "bg-blue-500 dark:bg-blue-400" : "bg-purple-500 dark:bg-purple-400"}`}
      />
      {type}
    </span>
  );
}

function EscalationBar({
  count,
  pct,
  color,
}: {
  count: number;
  pct: number;
  color: "amber" | "rose";
}) {
  const barColor =
    color === "amber" ? "bg-amber-400 dark:bg-amber-500" : "bg-rose-400 dark:bg-rose-500";
  const textColor =
    color === "amber" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  const clamped = Math.min(pct, 100);
  return (
    <div className="flex flex-col gap-1 min-w-[100px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-foreground">
          {count.toLocaleString("en-IN")}
        </span>
        <span className={`text-[11px] font-medium tabular-nums ${textColor}`}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

const BASE_PILL =
  "inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] rounded-full border font-medium whitespace-nowrap";

const ENTITY_TYPE_STYLES: Record<string, string> = {
  intermediary:
    "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-400",
  listed:
    "bg-purple-100 border-purple-300 text-purple-700 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-400",
  default:
    "bg-neutral-100 border-neutral-300 text-neutral-600 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-400",
};

function EntityTypeBadge({ type }: { type: string }) {
  const style = ENTITY_TYPE_STYLES[type.toLowerCase()] ?? ENTITY_TYPE_STYLES.default;
  return <span className={`${BASE_PILL} ${style} capitalize`}>{type}</span>;
}

const CATEGORY_COLORS = [
  "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-400",
  "bg-emerald-100 border-emerald-300 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-400",
  "bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-400",
  "bg-purple-100 border-purple-300 text-purple-700 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-400",
  "bg-orange-100 border-orange-300 text-orange-700 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-400",
  "bg-rose-100 border-rose-300 text-rose-700 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-400",
  "bg-teal-100 border-teal-300 text-teal-700 dark:bg-teal-900/30 dark:border-teal-700 dark:text-teal-400",
];

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function CategoryBadge({ name }: { name: string }) {
  const color = CATEGORY_COLORS[hashStr(name) % CATEGORY_COLORS.length];
  return <span className={`${BASE_PILL} ${color}`}>{name}</span>;
}
