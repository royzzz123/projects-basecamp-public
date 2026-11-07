import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertDiamondIcon,
  Building03Icon,
  Calendar01Icon,
  Clock01Icon,
  DownloadIcon,
  Hashtag,
  ComplaintIcon,
  Sparkles,
  Tag01Icon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead, useSortState } from "@/components/SortableHead";
import { EmptyState } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { AppFilterBar } from "@/components/AppFilterBar";
import {
  listComplaints,
  filterEntities,
  getComplaintFilters,
  type Complaint,
  type FilterOptions,
} from "@/lib/api";
import { type TypeaheadFilterField } from "@/components/AppFilterBar";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { TableSkeleton } from "@/components/TableSkeleton";

export const Route = createFileRoute("/complaints/")({
  head: () => ({
    meta: [
      { title: "Complaints — OnFinance AI" },
      { name: "description", content: "All investor complaints across your entities." },
    ],
  }),
  component: ComplaintsPage,
});

function ComplaintsPage() {
  const [rawItems, setRawItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIdx, setPageIdx] = useState(0);

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    statuses: [],
    categories: [],
    sub_categories: [],
  });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entityLabel, setEntityLabel] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [subCategory, setSubCategory] = useState("all");

  const PAGE = 50;

  useEffect(() => {
    getComplaintFilters()
      .then(setFilterOptions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = {
      limit: PAGE,
      after: cursors[pageIdx] ?? undefined,
      ...(status !== "all" && { status: [status] }),
      ...(entityId && { entityscreenid: [entityId] }),
      ...(category !== "all" && { category: [category] }),
      ...(subCategory !== "all" && { sub_category: [subCategory] }),
    };
    listComplaints(params)
      .then((res) => {
        setRawItems(res.items ?? []);
        setNextCursor(res.next_cursor);
        setTotal(res.total);
      })
      .catch(() => toast.error("Failed to load complaints"))
      .finally(() => setLoading(false));
  }, [status, entityId, category, subCategory, pageIdx, cursors]);

  const items = useMemo(() => {
    if (!search) return rawItems;
    const q = search.toLowerCase();
    return rawItems.filter(
      (c) =>
        String(c.complaint_id).includes(q) ||
        c.sub_category.toLowerCase().includes(q) ||
        (c.intermediary_name ?? "").toLowerCase().includes(q),
    );
  }, [rawItems, search]);

  const resetPage = () => {
    setPageIdx(0);
    setCursors([null]);
  };

  const goNext = () => {
    if (!nextCursor) return;
    const newCursors = [...cursors.slice(0, pageIdx + 1), nextCursor];
    setCursors(newCursors);
    setPageIdx(pageIdx + 1);
  };

  const goPrev = () => {
    if (pageIdx === 0) return;
    setPageIdx(pageIdx - 1);
  };

  const { sortBy, sortDir, onSort, applySort } = useSortState();
  const sorted = applySort(items as unknown as Record<string, unknown>[]) as unknown as Complaint[];

  const exportCsv = () => {
    const rows = [
      [
        "ID",
        "Intermediary",
        "Intermediary Category",
        "Complaint Type",
        "Status",
        "Created",
        "Updated",
      ],
      ...items.map((c) => [
        c.complaint_id,
        c.intermediary_name ?? c.entityscreenid,
        c.category ?? "",
        c.sub_category,
        c.status,
        c.created_date,
        c.modified_date,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "complaints.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${items.length} complaints`);
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <AppFilterBar
        title="Complaint Explorer"
        description={loading ? "Loading…" : `${total.toLocaleString("en-IN")} complaints`}
        searchQuery={search}
        onSearchChange={(v) => {
          setSearch(v);
        }}
        searchPlaceholder="Search ID, entity, complaint type…"
        typeaheadFilters={[
          {
            id: "entity",
            label: "Entity",
            placeholder: "Search entities…",
            selectedId: entityId,
            selectedLabel: entityLabel,
            onSelect: (id, label) => {
              setEntityId(id);
              setEntityLabel(label);
              resetPage();
            },
            fetchOptions: async (q) => {
              const res = await filterEntities({ q, limit: 20 });
              return (res.items ?? []).map((e) => ({ id: e.id, label: e.name }));
            },
          } satisfies TypeaheadFilterField,
        ]}
        filters={[
          {
            id: "status",
            label: "Status",
            value: status,
            options: filterOptions.statuses.map((s) => ({ id: s, label: s })),
            onChange: (v) => {
              setStatus(v);
              resetPage();
            },
          },
          {
            id: "category",
            label: "Intermediary Category",
            value: category,
            options: filterOptions.categories.map((c) => ({ id: c.code, label: c.name })),
            onChange: (v) => {
              setCategory(v);
              resetPage();
            },
          },
          {
            id: "subCategory",
            label: "Complaint Type",
            value: subCategory,
            options: filterOptions.sub_categories.map((s) => ({ id: s.name, label: s.name })),
            onChange: (v) => {
              setSubCategory(v);
              resetPage();
            },
          },
        ]}
        actions={
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportCsv}>
            <HugeiconsIcon icon={DownloadIcon} className="h-3.5 w-3.5" strokeWidth={1.5} /> Export
            CSV
          </Button>
        }
      />

      {loading ? (
        <TableSkeleton
          columns={7}
          rows={12}
          colWidths={["w-20", "w-48", "w-40", "w-36", "w-20", "w-24", "w-24"]}
        />
      ) : items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<HugeiconsIcon icon={ComplaintIcon} className="h-5 w-5" strokeWidth={1.5} />}
            title={
              entityId
                ? `No complaints found for "${entityLabel ?? entityId}"`
                : "No complaints match your filters"
            }
            description={
              entityId
                ? "This entity has no complaints recorded in the system."
                : "Try widening your search or clearing filters."
            }
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-auto rounded-xl border border-border bg-card">
            <Table className="[&_th:not(:last-child)]:border-r [&_th:not(:last-child)]:border-border [&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-border">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border">
                  <SortableHead
                    icon={<HugeiconsIcon icon={Hashtag} className="h-3 w-3" strokeWidth={1.5} />}
                    label="ID"
                    sortKey="complaint_id"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon icon={Building03Icon} className="h-3 w-3" strokeWidth={1.5} />
                    }
                    label="Entity"
                    sortKey="intermediary_name"
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
                    label="Complaint Type"
                    sortKey="sub_category"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  {/* AI-generated one-line summary (`concise_summary`) joined
                      on the complaint_summary collection at list-time. Not
                      sortable — content is free text. */}
                  <th className="px-3 py-2 text-left">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <HugeiconsIcon icon={Sparkles} className="h-3 w-3" strokeWidth={1.5} />
                      One-liner
                    </span>
                  </th>
                  <SortableHead
                    icon={<HugeiconsIcon icon={Tag01Icon} className="h-3 w-3" strokeWidth={1.5} />}
                    label="Intermediary Category"
                    sortKey="category"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon icon={Clock01Icon} className="h-3 w-3" strokeWidth={1.5} />
                    }
                    label="Status"
                    sortKey="status"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon icon={Calendar01Icon} className="h-3 w-3" strokeWidth={1.5} />
                    }
                    label="Created"
                    sortKey="created_date"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon icon={Timer01Icon} className="h-3 w-3" strokeWidth={1.5} />
                    }
                    label="Updated"
                    sortKey="modified_date"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => (
                  <TableRow key={c.complaint_id} className="group">
                    <TableCell>
                      <Link
                        to="/complaints/$id"
                        params={{ id: String(c.complaint_id) }}
                        className="inline-flex items-center font-mono text-[11px] font-semibold text-[#2563a8] bg-[#2563a8]/8 rounded-md px-2 py-0.5 hover:bg-[#2563a8]/15"
                      >
                        {c.complaint_id}
                      </Link>
                    </TableCell>
                    <TableCell className="w-[240px] max-w-[240px] overflow-hidden">
                      <ClampedLink
                        to="/entities/$id"
                        params={{ id: c.entityscreenid }}
                        text={c.intermediary_name ?? c.entityscreenid}
                      />
                    </TableCell>
                    <TableCell className="w-[240px] max-w-[240px] overflow-hidden">
                      <ClampedPill name={c.sub_category} />
                    </TableCell>
                    <TableCell className="w-[280px] max-w-[280px] overflow-hidden">
                      {c.concise_summary ? (
                        <span
                          className="line-clamp-2 text-[12px] leading-snug text-foreground/85"
                          title={c.concise_summary}
                        >
                          {c.concise_summary}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="w-[200px] max-w-[200px] overflow-hidden">
                      {c.category ? (
                        <ClampedText text={c.category} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                      {fmtDate(c.created_date)}
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                      {fmtDate(c.modified_date)}
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
      )}
    </div>
  );
}

function ClampedLink({
  to,
  params,
  text,
}: {
  to: "/entities/$id";
  params: { id: string };
  text: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div>
      <span
        ref={ref}
        className={`block text-[13px] font-medium leading-snug ${!expanded ? "line-clamp-2" : ""}`}
      >
        <Link
          to={to}
          params={params}
          className="text-foreground hover:text-primary hover:underline"
        >
          {text}
        </Link>
      </span>
      {clamped && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-[11px] text-primary/70 hover:text-primary"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

function ClampedText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div>
      <span
        ref={ref}
        className={`block text-[12px] text-foreground leading-snug ${!expanded ? "line-clamp-2" : ""}`}
      >
        {text}
      </span>
      {clamped && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-[11px] text-primary/70 hover:text-primary"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

function ClampedPill({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [name]);

  const color = PILL_COLORS[hashStr(name) % PILL_COLORS.length];

  return (
    <div>
      <div
        className={`block w-full px-2.5 py-0.5 text-[11px] rounded-lg border font-medium ${color}`}
      >
        <div ref={ref} className={!expanded ? "line-clamp-2" : ""}>
          {name}
        </div>
      </div>
      {clamped && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 block text-[11px] text-primary/70 hover:text-primary"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

const PILL_COLORS = [
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
