import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  Building03Icon,
  Calendar01Icon,
  Clock01Icon,
  Hashtag,
  Tag01Icon,
  AlertDiamondIcon,
  FilterIcon,
} from "@hugeicons/core-free-icons";
import { Checkbox } from "@/components/ui/checkbox";
import { HugeiconsIcon } from "@hugeicons/react";
import { type DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResponsiveContainer, Tooltip as RTooltip, Line, LineChart, XAxis, YAxis } from "recharts";
import { NivoPie } from "@/components/NivoPie";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { SortableHead, useSortState } from "@/components/SortableHead";
import {
  listComplaints,
  listEntities,
  filterEntities,
  type Complaint,
  type EntityListItem,
} from "@/lib/api";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/entities/$id")({
  component: EntityDetail,
  errorComponent: function EntityRouteError({ error, reset }) {
    const router = useRouter();
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <h2 className="font-semibold text-destructive">Could not load entity</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        <Button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-4"
        >
          Retry
        </Button>
      </div>
    );
  },
});

const CHART_COLORS = ["#7badd4", "#5ac87e", "#f0c040", "#e8735a", "#a78bfa", "#34d399", "#fb923c"];

const ENTITY_PAGE_SIZE = 25;

function EntityDetail() {
  const { id } = Route.useParams();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [complaintsPage, setComplaintsPage] = useState(0);
  const [entityInfo, setEntityInfo] = useState<EntityListItem | null>(null);
  const [nameResolved, setNameResolved] = useState(false);

  // Fetch all complaints for this entity (paginate through all)
  useEffect(() => {
    setLoading(true);
    setError(null);
    const all: Complaint[] = [];

    const fetchPage = (after?: string) => {
      listComplaints({ entityscreenid: [id], limit: 200, after })
        .then((res) => {
          if (res.items) all.push(...res.items);
          if (res.next_cursor) {
            fetchPage(res.next_cursor);
          } else {
            setComplaints(all);
            setLoading(false);
          }
        })
        .catch(() => {
          setError("Failed to load complaints for this entity.");
          setLoading(false);
        });
    };

    fetchPage();
    setComplaintsPage(0);
  }, [id]);

  const entityName = useMemo(() => {
    const fromComplaints = complaints.find((c) => c.intermediary_name)?.intermediary_name;
    return fromComplaints ?? entityInfo?.entity ?? (nameResolved ? id : null);
  }, [complaints, entityInfo, id, nameResolved]);

  // Emit entity name for breadcrumb
  useEffect(() => {
    if (entityName && entityName !== id) {
      window.dispatchEvent(new CustomEvent("entity:name", { detail: { id, name: entityName } }));
    }
  }, [entityName, id]);

  // Fetch entity name — exact ID match via filter endpoint, then fallback to list
  useEffect(() => {
    setNameResolved(false);
    filterEntities({ q: id, limit: 50 })
      .then((res) => {
        const exact = (res.items ?? []).find((e) => e.id === id);
        if (exact) {
          window.dispatchEvent(
            new CustomEvent("entity:name", { detail: { id, name: exact.name } }),
          );
          setEntityInfo(
            (prev) =>
              prev ?? {
                id: exact.id,
                entity: exact.name,
                entity_type: "",
                category: null,
                registration_number: null,
                total_complaints: 0,
                open_complaints: 0,
                closed_complaints: 0,
                first_level_review_escalated: 0,
                first_level_review_escalation_pct: 0,
                second_level_review_escalated: 0,
                second_level_review_escalation_pct: 0,
              },
          );
        }
      })
      .catch(() => {})
      .finally(() => setNameResolved(true));
    listEntities({ limit: 200 })
      .then((res) => {
        const found = (res.items ?? []).find((e) => e.id === id);
        if (found) setEntityInfo(found);
      })
      .catch(() => {});
  }, [id]);

  type Preset = "7d" | "30d" | "90d" | "all";
  const [preset, setPreset] = useState<Preset>("30d");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [calOpen, setCalOpen] = useState(false);
  const [selectedSubCats, setSelectedSubCats] = useState<Set<string> | null>(null);
  const [catFilterOpen, setCatFilterOpen] = useState(false);

  const { sortBy, sortDir, onSort, applySort } = useSortState();
  const sortedComplaints = (
    applySort(complaints as unknown as Record<string, unknown>[]) as unknown as Complaint[]
  ).slice(complaintsPage * ENTITY_PAGE_SIZE, (complaintsPage + 1) * ENTITY_PAGE_SIZE);

  const stats = useMemo(() => {
    const total = complaints.length;
    const resolved = complaints.filter(
      (c) => c.status === "CLOSED" || c.status === "ACTION_BY_SE",
    ).length;
    const open = total - resolved;
    return { total, open, resolved };
  }, [complaints]);

  const complaintTypeData = useMemo(() => {
    const m = new Map<string, number>();
    complaints.forEach((c) => {
      if (c.sub_category) m.set(c.sub_category, (m.get(c.sub_category) ?? 0) + 1);
    });
    const sorted = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    const top5 = sorted.slice(0, 5);
    const othersTotal = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    const items = top5.map(([name, value], i) => ({
      id: name,
      label: name,
      value,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
    if (othersTotal > 0)
      items.push({ id: "Others", label: "Others", value: othersTotal, color: "#6b7280" });
    return items;
  }, [complaints]);

  const allSubCats = useMemo(() => {
    const m = new Map<string, number>();
    complaints.forEach((c) => {
      if (c.sub_category) m.set(c.sub_category, (m.get(c.sub_category) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], i) => ({
        id: name,
        count,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [complaints]);

  const trend = useMemo(() => {
    if (complaints.length === 0) return { data: [], series: [] as { id: string; color: string }[] };

    const activeCats = selectedSubCats ?? new Set(allSubCats.map((c) => c.id));
    const series = allSubCats
      .filter((c) => activeCats.has(c.id))
      .map((c) => ({ id: c.id, color: c.color }));
    const seriesIds = new Set(series.map((s) => s.id));

    const scoped = complaints.filter((c) => c.sub_category && seriesIds.has(c.sub_category));
    if (scoped.length === 0) return { data: [], series };

    const sortedDates = scoped.map((c) => c.modified_date.slice(0, 10)).sort();
    const lastDate = new Date(sortedDates.at(-1)!);

    let fromDate: Date;
    let toDate: Date = lastDate;

    if (preset === "all") {
      fromDate = new Date(sortedDates[0]);
    } else if (preset === "7d") {
      fromDate = new Date(lastDate.getTime() - 6 * 86400000);
    } else if (preset === "90d") {
      fromDate = new Date(lastDate.getTime() - 89 * 86400000);
    } else {
      fromDate = new Date(lastDate.getTime() - 29 * 86400000);
    }

    if (customRange?.from) {
      fromDate = customRange.from;
      toDate = customRange.to ?? customRange.from;
    }

    const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
    const granularity: "day" | "week" | "month" =
      spanDays <= 31 ? "day" : spanDays <= 120 ? "week" : "month";

    const toBucketKey = (d: Date): string => {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      if (granularity === "month") return `${yyyy}-${mm}`;
      if (granularity === "week") {
        const wkStart = new Date(d);
        wkStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
        return wkStart.toISOString().slice(0, 10);
      }
      return `${yyyy}-${mm}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };
    const advanceCursor = (d: Date) => {
      if (granularity === "month") d.setUTCMonth(d.getUTCMonth() + 1);
      else if (granularity === "week") d.setUTCDate(d.getUTCDate() + 7);
      else d.setUTCDate(d.getUTCDate() + 1);
    };

    const buckets: Record<string, Record<string, number>> = {};
    const startCursor = new Date(fromDate);
    if (granularity === "month") startCursor.setUTCDate(1);
    if (granularity === "week")
      startCursor.setUTCDate(startCursor.getUTCDate() - startCursor.getUTCDay());
    const cur = new Date(startCursor);
    while (cur <= toDate) {
      const key = toBucketKey(cur);
      if (!(key in buckets)) buckets[key] = Object.fromEntries(series.map((s) => [s.id, 0]));
      advanceCursor(cur);
    }
    complaints.forEach((c) => {
      if (!c.sub_category || !seriesIds.has(c.sub_category)) return;
      const d = new Date(c.modified_date.slice(0, 10));
      const key = toBucketKey(d);
      if (key in buckets) buckets[key][c.sub_category]++;
    });
    const data = Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));
    return { data, series, granularity };
  }, [complaints, preset, customRange, selectedSubCats, allSubCats]);

  if (loading) {
    return (
      <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <h2 className="font-semibold text-destructive">Error</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button asChild className="mt-4" variant="outline">
          <Link to="/entities">Back to Intermediaries</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-start">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <HugeiconsIcon icon={Building03Icon} className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          {entityName ? (
            <h1 className="text-2xl font-semibold tracking-tight">{entityName}</h1>
          ) : (
            <div className="h-7 w-64 animate-pulse rounded-lg bg-muted" />
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <HugeiconsIcon icon={Hashtag} className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span className="font-mono text-xs">{id}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <HugeiconsIcon icon={Calendar01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />
              {stats.total} total complaints
            </span>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Kpi label="Total Complaints" value={stats.total} />
        <Kpi label="Open" value={stats.open} accent="warn" />
        <Kpi label="Closed / Actioned" value={stats.resolved} accent="resolved" />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="complaints">Complaints ({complaints.length})</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">Complaint trend</CardTitle>
                  <div className="flex items-center gap-1.5">
                    {(["7d", "30d", "90d", "all"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setPreset(p);
                          setCustomRange(undefined);
                        }}
                        className={`h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
                          preset === p && !customRange
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                        }`}
                      >
                        {p === "all" ? "All" : p.toUpperCase()}
                      </button>
                    ))}
                    <Popover open={calOpen} onOpenChange={setCalOpen}>
                      <PopoverTrigger asChild>
                        <button
                          className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
                            customRange?.from
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                          }`}
                        >
                          <HugeiconsIcon
                            icon={Calendar01Icon}
                            className="h-3 w-3"
                            strokeWidth={1.5}
                          />
                          {customRange?.from
                            ? `${customRange.from.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}${customRange.to ? ` – ${customRange.to.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : ""}`
                            : "Custom"}
                          {customRange?.from && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                setCustomRange(undefined);
                              }}
                              className="ml-0.5 rounded-full hover:opacity-70"
                            >
                              ×
                            </span>
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <Calendar
                          mode="range"
                          captionLayout="dropdown"
                          selected={customRange}
                          onSelect={(range) => {
                            setCustomRange(range);
                            if (
                              range?.from &&
                              range?.to &&
                              range.from.toDateString() !== range.to.toDateString()
                            )
                              setCalOpen(false);
                          }}
                          defaultMonth={new Date()}
                          disabled={{ after: new Date() }}
                        />
                      </PopoverContent>
                    </Popover>
                    <Popover open={catFilterOpen} onOpenChange={setCatFilterOpen}>
                      <PopoverTrigger asChild>
                        <button
                          className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
                            selectedSubCats
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                          }`}
                        >
                          <HugeiconsIcon icon={FilterIcon} className="h-3 w-3" strokeWidth={1.5} />
                          {selectedSubCats
                            ? `${selectedSubCats.size}/${allSubCats.length} types`
                            : "All types"}
                          {selectedSubCats && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedSubCats(null);
                              }}
                              className="ml-0.5 rounded-full hover:opacity-70"
                            >
                              ×
                            </span>
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-0" align="end">
                        <div className="flex items-center justify-between border-b border-border px-3 py-2">
                          <span className="text-[12px] font-medium">Complaint types</span>
                          <div className="flex gap-2 text-[11px]">
                            <button
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() =>
                                setSelectedSubCats(new Set(allSubCats.map((c) => c.id)))
                              }
                            >
                              Select all
                            </button>
                            <button
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => setSelectedSubCats(new Set())}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <div className="max-h-72 overflow-y-auto py-1">
                          {allSubCats.map((c) => {
                            const active = selectedSubCats ? selectedSubCats.has(c.id) : true;
                            return (
                              <label
                                key={c.id}
                                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-muted/60"
                              >
                                <Checkbox
                                  checked={active}
                                  onCheckedChange={(v) => {
                                    const base =
                                      selectedSubCats ?? new Set(allSubCats.map((s) => s.id));
                                    const next = new Set(base);
                                    if (v) next.add(c.id);
                                    else next.delete(c.id);
                                    setSelectedSubCats(next);
                                  }}
                                />
                                <span
                                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                                  style={{ background: c.color }}
                                />
                                <span className="flex-1 truncate" title={c.id}>
                                  {c.id}
                                </span>
                                <span className="text-muted-foreground tabular-nums">
                                  {c.count}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer>
                    <LineChart
                      data={trend.data}
                      margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                    >
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v: string) => {
                          if (trend.granularity === "month") {
                            const d = new Date(`${v}-01`);
                            return d.toLocaleDateString("en-GB", {
                              month: "short",
                              year: "2-digit",
                            });
                          }
                          if (trend.granularity === "week") {
                            const d = new Date(v);
                            return d.toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                            });
                          }
                          return v.slice(5);
                        }}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={20}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                        allowDecimals={false}
                      />
                      <RTooltip
                        cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const nonZero = payload.filter((p) => (p.value as number) > 0);
                          if (nonZero.length === 0) return null;
                          return (
                            <div className="rounded-md border border-border/60 bg-card/80 px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur-sm">
                              <div className="mb-1 font-medium text-foreground">{label}</div>
                              {nonZero.map((p) => (
                                <div
                                  key={p.dataKey as string}
                                  className="flex items-center gap-1.5 leading-tight"
                                >
                                  <span
                                    className="inline-block h-2 w-2 rounded-full"
                                    style={{ background: p.color }}
                                  />
                                  <span className="text-muted-foreground">{p.name}:</span>
                                  <span className="font-medium tabular-nums text-foreground">
                                    {p.value as number}
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        }}
                      />
                      {trend.series.map((s) => (
                        <Line
                          key={s.id}
                          type="monotone"
                          dataKey={s.id}
                          stroke={s.color}
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 3 }}
                          name={s.id}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">By complaint type</CardTitle>
                  <div className="text-right">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Total
                    </div>
                    <div className="text-lg font-semibold tabular-nums">{complaints.length}</div>
                    <div className="text-[10px] text-muted-foreground">top 5 types shown</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {complaintTypeData.length > 0 ? (
                  <>
                    <NivoPie data={complaintTypeData} innerRadius={0.55} height={180} />
                    <div className="mt-2 space-y-1.5 text-xs">
                      {complaintTypeData.map((c) => (
                        <div key={c.id} className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-sm"
                            style={{ background: c.color }}
                          />
                          <span className="flex-1 truncate text-muted-foreground">{c.label}</span>
                          <span className="font-medium tabular-nums">{c.value}</span>
                          <span className="w-8 text-right text-[10px] text-muted-foreground/60">
                            {complaints.length
                              ? `${Math.round((c.value / complaints.length) * 100)}%`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No data.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Complaints tab */}
        <TabsContent value="complaints" className="mt-4 space-y-2">
          <Card>
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
                    icon={<HugeiconsIcon icon={Tag01Icon} className="h-3 w-3" strokeWidth={1.5} />}
                    label="Intermediary Category"
                    sortKey="category"
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
                      <HugeiconsIcon icon={Calendar01Icon} className="h-3 w-3" strokeWidth={1.5} />
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
                {sortedComplaints.map((c) => (
                  <TableRow key={c.complaint_id}>
                    <TableCell>
                      <Link
                        to="/complaints/$id"
                        params={{ id: String(c.complaint_id) }}
                        className="inline-flex items-center font-mono text-[11px] font-semibold text-[#2563a8] bg-[#2563a8]/8 rounded-md px-2 py-0.5 hover:bg-[#2563a8]/15"
                      >
                        {c.complaint_id}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      {c.category ? (
                        <span className="text-[12px] text-foreground leading-snug">
                          {c.category}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <span className="text-[12px] text-foreground leading-snug">
                        {c.sub_category}
                      </span>
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
          </Card>
          {complaints.length > ENTITY_PAGE_SIZE && (
            <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 text-[12px] text-muted-foreground">
              <span>
                Page {complaintsPage + 1} of {Math.ceil(complaints.length / ENTITY_PAGE_SIZE)}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setComplaintsPage((p) => p - 1)}
                  disabled={complaintsPage === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setComplaintsPage((p) => p + 1)}
                  disabled={(complaintsPage + 1) * ENTITY_PAGE_SIZE >= complaints.length}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Details tab */}
        <TabsContent value="details" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-x-12 gap-y-6 sm:grid-cols-2">
                <DetailField label="Name" value={entityInfo?.entity ?? entityName} />
                <DetailField
                  label="Entity Type"
                  value={
                    entityInfo?.entity_type
                      ? entityInfo.entity_type.charAt(0).toUpperCase() +
                        entityInfo.entity_type.slice(1)
                      : "—"
                  }
                />
                <DetailField
                  label="Category"
                  value={entityInfo?.category ?? complaints[0]?.category ?? "—"}
                />
                <DetailField label="Screen ID" value={id} mono />
                <DetailField
                  label="Registration No."
                  value={entityInfo?.registration_number ?? "—"}
                  mono
                />
                <DetailField label="Total Complaints" value={String(complaints.length)} />
                <DetailField label="Open Complaints" value={String(stats.open)} accent="warn" />
                <DetailField
                  label="Closed / Actioned"
                  value={String(stats.resolved)}
                  accent="resolved"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: "warn" | "resolved";
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      <div
        className={`text-[14px] font-medium ${mono ? "font-mono" : ""} ${accent === "warn" ? "text-[var(--status-warn)]" : accent === "resolved" ? "text-[var(--status-resolved)]" : "text-foreground"}`}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "warn" | "resolved";
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={`mt-2 text-2xl font-semibold ${accent === "warn" ? "text-[var(--status-warn)]" : accent === "resolved" ? "text-[var(--status-resolved)]" : ""}`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
