import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type DateRange } from "react-day-picker";
import {
  Activity,
  AlertDiamondIcon,
  AiBrain01Icon,
  Calendar01Icon,
  ChevronLeft,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  File01Icon,
  FilterIcon,
  Fire,
  Sparkles,
  Zap,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { NivoPie } from "@/components/NivoPie";
import { IndiaHeatmap } from "@/components/IndiaHeatmap";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { alerts, complaints, getEntity } from "@/data/mock";
import { fmtNumber, fmtRelative } from "@/lib/format";
import {
  getDashboardSummary,
  getDashboardVolumeByCategory,
  getDashboardVolumeByCategoryTrend,
  getDashboardVolumeBySubcategoryTrend,
  listEntities,
  type DashboardGranularity,
  type DashboardSummary,
  type DashboardVolumeByCategoryItem,
  type EntityListItem,
} from "@/lib/api";

// Unified series shape so the chart doesn't care whether we're at the
// category or sub-category level. `id` is the stable key Recharts uses;
// `name` is the human-readable label shown in the tooltip/legend.
type TrendSeries = {
  id: string;
  name: string;
  total: number;
  points: { date: string; count: number }[];
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — OnFinance AI" },
      {
        name: "description",
        content: "Overview of complaint volume, alerts, and entity exposure.",
      },
    ],
  }),
  component: DashboardPage,
});

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
];

// Use the curated PALETTE for the first slots, then fall back to HSL hues
// stepped by the golden angle so each extra series gets a visually distinct
// color (no repeats up to ~30 series).
const GOLDEN_ANGLE = 137.508;
function seriesColor(i: number): string {
  if (i < PALETTE.length) return PALETTE[i];
  const overflow = i - PALETTE.length;
  // Start past the curated hues, rotate by the golden angle for spread.
  const hue = (overflow * GOLDEN_ANGLE + 30) % 360;
  return `hsl(${hue.toFixed(1)}, 65%, 56%)`;
}

type Preset = "7d" | "30d" | "90d" | "all";

function presetRange(p: Preset): { from?: string; to?: string } {
  if (p === "all") return {};
  const days = p === "7d" ? 7 : p === "30d" ? 30 : 90;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Sentinel id for the aggregated long-tail series. Won't collide with a real
// category/sub-category code because real codes never start with "::".
const OTHERS_ID = "::others";

// Collapse the long tail (everything past the first `topN` series) into a
// single "Others" series so totals still reconcile with the KPI. The input
// is assumed sorted by total descending — the order the backend returns it.
function withOthers(series: TrendSeries[], topN: number): TrendSeries[] {
  if (series.length <= topN) return series;
  const head = series.slice(0, topN);
  const tail = series.slice(topN);
  const totals: Record<string, number> = {};
  let othersTotal = 0;
  tail.forEach((s) => {
    othersTotal += s.total;
    s.points.forEach((p) => {
      totals[p.date] = (totals[p.date] ?? 0) + p.count;
    });
  });
  const points = Object.entries(totals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
  return [...head, { id: OTHERS_ID, name: `Others (${tail.length})`, total: othersTotal, points }];
}

function rangeFromCustom(r: DateRange | undefined): { from?: string; to?: string } {
  if (!r?.from) return {};
  const from = new Date(r.from);
  from.setHours(0, 0, 0, 0);
  const to = r.to ? new Date(r.to) : new Date(r.from);
  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

function DashboardPage() {
  const [preset, setPreset] = useState<Preset>("all");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [calOpen, setCalOpen] = useState(false);
  const [selectedCats, setSelectedCats] = useState<Set<string> | null>(null);
  const [catFilterOpen, setCatFilterOpen] = useState(false);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [volumeByCategory, setVolumeByCategory] = useState<DashboardVolumeByCategoryItem[]>([]);
  const [trend, setTrend] = useState<{ granularity: DashboardGranularity; series: TrendSeries[] }>({
    granularity: "day",
    series: [],
  });
  // null = top-level (categories). When set, the chart drills into this
  // category's sub-categories.
  const [drilldownCode, setDrilldownCode] = useState<string | null>(null);
  const [topN, setTopN] = useState<number>(7);
  const [topEntities, setTopEntities] = useState<EntityListItem[]>([]);

  // Resolved name for the breadcrumb, derived from the category list we
  // already fetched (no extra round-trip needed).
  const drilldownName = drilldownCode
    ? (volumeByCategory.find((c) => c.category_code === drilldownCode)?.category_name ??
      drilldownCode)
    : null;

  const range = useMemo(
    () => (customRange?.from ? rangeFromCustom(customRange) : presetRange(preset)),
    [preset, customRange],
  );

  // If the user changes the date range or the global category filter, exit
  // the drilldown — the previously-selected category may no longer be visible.
  useEffect(() => {
    setDrilldownCode(null);
  }, [range, selectedCats]);

  // Summary refetch — date + category aware
  useEffect(() => {
    const categoryCodes = selectedCats ? Array.from(selectedCats) : undefined;
    getDashboardSummary({
      created_at_from: range.from,
      created_at_to: range.to,
      category: categoryCodes,
    })
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [range, selectedCats]);

  // Volume-by-category refetch — date only (the API has no category filter; category is the group key)
  useEffect(() => {
    getDashboardVolumeByCategory({
      created_at_from: range.from,
      created_at_to: range.to,
    })
      .then((res) => setVolumeByCategory(res.items))
      .catch(() => setVolumeByCategory([]));
  }, [range]);

  // Trend chart — switches between category and sub-category modes:
  //  - drilldownCode == null → categories from /volume-by-category-trend
  //  - drilldownCode != null → that category's sub-categories from /volume-by-subcategory-trend
  // Granularity is auto-picked from the active window length.
  useEffect(() => {
    let granularity: DashboardGranularity = "day";
    if (range.from && range.to) {
      const spanDays = Math.round(
        (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000,
      );
      if (spanDays > 120) granularity = "month";
      else if (spanDays > 31) granularity = "week";
    } else {
      granularity = "month";
    }

    if (drilldownCode === null) {
      const codes = selectedCats ? Array.from(selectedCats) : undefined;
      getDashboardVolumeByCategoryTrend({
        created_at_from: range.from,
        created_at_to: range.to,
        category: codes,
        granularity,
      })
        .then((res) =>
          setTrend({
            granularity: res.granularity,
            series: withOthers(
              res.series.map((s) => ({
                id: s.category_code || s.category_name || "—",
                name: s.category_name || s.category_code || "—",
                total: s.total,
                points: s.points,
              })),
              topN,
            ),
          }),
        )
        .catch(() => setTrend({ granularity, series: [] }));
    } else {
      getDashboardVolumeBySubcategoryTrend({
        created_at_from: range.from,
        created_at_to: range.to,
        category: [drilldownCode],
        granularity,
        // Pull a long tail so we can compute "Others" client-side.
        limit: 200,
      })
        .then((res) =>
          setTrend({
            granularity: res.granularity,
            series: withOthers(
              res.series.map((s) => ({
                id: s.sub_category || "—",
                name: s.sub_category || "—",
                total: s.total,
                points: s.points,
              })),
              topN,
            ),
          }),
        )
        .catch(() => setTrend({ granularity, series: [] }));
    }
  }, [range, selectedCats, drilldownCode, topN]);

  // Top entities — listEntities is sorted by complaint_count DESC by default
  useEffect(() => {
    listEntities({ limit: 6 })
      .then((res) => setTopEntities(res.items ?? []))
      .catch(() => setTopEntities([]));
  }, []);

  const recent = complaints.slice(0, 6);

  // Status distribution for donut (mock — no API yet)
  const statusDist = [
    {
      id: "Filed",
      label: "Filed",
      value: complaints.filter((c) => c.status === "Filed").length,
      color: "#f0c040",
    },
    {
      id: "Under Review",
      label: "Under Review",
      value: complaints.filter((c) => c.status === "Under Review").length,
      color: "#7badd4",
    },
    {
      id: "Action Taken",
      label: "Action Taken",
      value: complaints.filter((c) => c.status === "Action Taken").length,
      color: "#7badd4",
    },
    {
      id: "Resolved",
      label: "Resolved",
      value: complaints.filter((c) => c.status === "Resolved").length,
      color: "#5ac87e",
    },
    {
      id: "Closed",
      label: "Closed",
      value: complaints.filter((c) => c.status === "Closed").length,
      color: "#b0b8c8",
    },
  ];

  const slaScore = summary ? Math.round(summary.resolution_rate) : 0;

  const tooltipStyle = {
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--card)",
    fontSize: 12,
    boxShadow: "0 8px 24px -12px rgba(0,0,0,0.18)",
  } as const;

  const total = summary?.total ?? 0;
  const open = summary?.open ?? 0;
  const closed = summary?.closed ?? 0;
  const openPct = total > 0 ? Math.round((open / total) * 100) : 0;
  const closedPct = total > 0 ? Math.round((closed / total) * 100) : 0;

  // Bottom widget: "Complaint Volume by Category" horizontal bar chart from
  // the aggregate volume-by-category endpoint. Long names truncated; full name
  // lives in the tooltip.
  const categoryBarData = volumeByCategory.slice(0, 7).map((c) => ({
    name: c.category_name || c.category_code || "—",
    value: c.complaints,
  }));

  const trendTopSeries = trend.series;

  // id → display name lookup so tooltips / legends can show full names even
  // after the legend formatter truncates them.
  const trendLabels = useMemo(
    () => Object.fromEntries(trendTopSeries.map((s) => [s.id, s.name])) as Record<string, string>,
    [trendTopSeries],
  );

  // Pivot the sparse trend response into [{ date, "<id>": count, ... }] rows
  // for Recharts, zero-filling across the union of bucket dates.
  const trendChartData = useMemo(() => {
    if (trendTopSeries.length === 0) return [] as Array<Record<string, number | string>>;
    const dates = new Set<string>();
    trendTopSeries.forEach((s) => s.points.forEach((p) => dates.add(p.date)));
    const sortedDates = Array.from(dates).sort();
    return sortedDates
      .map((date) => {
        const row: Record<string, number | string> = { date };
        trendTopSeries.forEach((s) => {
          row[s.id] = 0;
        });
        return row;
      })
      .map((row) => {
        trendTopSeries.forEach((s) => {
          const point = s.points.find((p) => p.date === row.date);
          if (point) row[s.id] = point.count;
        });
        return row;
      });
  }, [trendTopSeries]);

  const xAxisFormatter = (v: string) => {
    if (trend.granularity === "month") {
      const d = new Date(`${v}T00:00:00Z`);
      return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    }
    if (trend.granularity === "week") {
      const d = new Date(`${v}T00:00:00Z`);
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    }
    return v.slice(5); // MM-DD
  };

  return (
    <div className="space-y-4">
      {/* ── Compact header row ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground">
            <HugeiconsIcon icon={AiBrain01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              <HugeiconsIcon icon={Sparkles} className="h-2.5 w-2.5" strokeWidth={1.5} /> AI Pulse ·
              Today
            </div>
            <div className="text-[13px] font-medium leading-snug text-foreground">
              3 critical signals detected · withdrawal complaints up{" "}
              <span className="text-[var(--status-critical)]">+1,329%</span> at 2 brokerages
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            value={customRange?.from ? "custom-active" : preset}
            onValueChange={(v) => {
              if (v === "custom-active") return;
              setPreset(v as Preset);
              setCustomRange(undefined);
            }}
          >
            <SelectTrigger className="h-7 w-[140px] text-xs border-border bg-muted/30 shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All</SelectItem>
              {customRange?.from && <SelectItem value="custom-active">Custom range</SelectItem>}
            </SelectContent>
          </Select>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <button
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
                  customRange?.from
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                <HugeiconsIcon icon={Calendar01Icon} className="h-3 w-3" strokeWidth={1.5} />
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
                onSelect={(r) => {
                  setCustomRange(r);
                  if (r?.from && r?.to && r.from.toDateString() !== r.to.toDateString())
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
                  selectedCats
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                <HugeiconsIcon icon={FilterIcon} className="h-3 w-3" strokeWidth={1.5} />
                {(() => {
                  if (!selectedCats) return "All categories";
                  if (volumeByCategory.length > 0 && selectedCats.size === volumeByCategory.length)
                    return "All categories";
                  if (selectedCats.size === 0) return "No categories";
                  return `${selectedCats.size}/${volumeByCategory.length} categories`;
                })()}
                {selectedCats && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCats(null);
                    }}
                    className="ml-0.5 rounded-full hover:opacity-70"
                  >
                    ×
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-[12px] font-medium">Categories</span>
                <div className="flex gap-2 text-[11px]">
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setSelectedCats(new Set(volumeByCategory.map((c) => c.category_code)))
                    }
                  >
                    Select all
                  </button>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedCats(new Set())}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto py-1">
                {volumeByCategory.map((c) => {
                  const active = selectedCats ? selectedCats.has(c.category_code) : true;
                  return (
                    <label
                      key={c.category_code || c.category_name}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={active}
                        onCheckedChange={(v) => {
                          const base =
                            selectedCats ?? new Set(volumeByCategory.map((s) => s.category_code));
                          const next = new Set(base);
                          if (v) next.add(c.category_code);
                          else next.delete(c.category_code);
                          setSelectedCats(next);
                        }}
                      />
                      <span className="flex-1 truncate" title={c.category_name}>
                        {c.category_name || c.category_code || "(uncategorised)"}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{c.complaints}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-7 gap-1 border-border bg-muted/30 px-2.5 text-xs shadow-none hover:bg-muted"
          >
            <Link to="/insights">
              <HugeiconsIcon icon={Sparkles} className="h-3 w-3" strokeWidth={1.5} /> AI Insights
            </Link>
          </Button>
        </div>
      </div>

      {/* ── 50/50: KPI cards (left) + Active Alerts (right) — items-start so KPIs don't stretch ── */}
      {/* KPI strip (4 across) + AI insight carousel below */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiStat
            label="Total Complaints"
            value={summary ? fmtNumber(summary.total) : "—"}
            delta="filed in window"
            icon={<HugeiconsIcon icon={File01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />}
            iconColor="#7badd4"
          />
          <KpiStat
            label="Open / Escalated"
            value={summary ? fmtNumber(open) : "—"}
            delta={total > 0 ? `${openPct}% of total` : "—"}
            icon={
              <HugeiconsIcon icon={AlertDiamondIcon} className="h-3.5 w-3.5" strokeWidth={1.5} />
            }
            iconColor="#f0c040"
          />
          <KpiStat
            label="Resolution Rate"
            value={summary ? `${summary.resolution_rate}%` : "—"}
            delta="within-window closure rate"
            icon={
              <HugeiconsIcon
                icon={CheckmarkCircle01Icon}
                className="h-3.5 w-3.5"
                strokeWidth={1.5}
              />
            }
            iconColor="#5ac87e"
          />
          <KpiStat
            label="Closed Cases"
            value={summary ? fmtNumber(closed) : "—"}
            delta={total > 0 ? `${closedPct}% of total` : "—"}
            icon={
              <HugeiconsIcon
                icon={CheckmarkCircle01Icon}
                className="h-3.5 w-3.5"
                strokeWidth={1.5}
              />
            }
            iconColor="#5ac87e"
          />
        </div>
        <InsightCarousel />
      </div>

      {/* Top widget: Complaint Volume by Category (drilldown to subcategories) — stacked area over time */}
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <CardTitle className="text-base truncate">
                {drilldownCode === null
                  ? "Complaint Volume by Category"
                  : `${drilldownName} · Subcategories`}
              </CardTitle>
              {drilldownCode !== null && (
                <button
                  onClick={() => setDrilldownCode(null)}
                  className="flex h-6 items-center gap-1 rounded-md bg-muted px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                  title="Back to categories"
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} className="h-3 w-3" strokeWidth={1.5} />
                  All categories
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {drilldownCode === null ? (
                  <>
                    {summary ? fmtNumber(total) : "—"} total · {trend.granularity}ly ·{" "}
                    <em className="not-italic text-muted-foreground/80">
                      click a band to drill in
                    </em>
                  </>
                ) : (
                  <>{trend.granularity}ly</>
                )}
              </span>
              <Select value={String(topN)} onValueChange={(v) => setTopN(Number(v))}>
                <SelectTrigger className="h-7 w-[90px] text-xs border-border bg-muted/30 shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 7, 10, 15, 20].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Top {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {trendChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={trendChartData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <defs>
                      {trendTopSeries.map((s, i) => {
                        const color = s.id === OTHERS_ID ? "#9ca3af" : seriesColor(i);
                        return (
                          <linearGradient key={s.id} id={`gCat${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={xAxisFormatter}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={20}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip
                      cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const nonZero = payload.filter((p) => (p.value as number) > 0);
                        if (nonZero.length === 0) return null;
                        return (
                          <div className="rounded-md border border-border/60 bg-card/80 px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur-sm">
                            <div className="mb-1 font-medium text-foreground">
                              {xAxisFormatter(label as string)}
                            </div>
                            {nonZero.map((p) => (
                              <div
                                key={p.dataKey as string}
                                className="flex items-center gap-1.5 leading-tight"
                              >
                                <span
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{ background: p.color }}
                                />
                                <span
                                  className="max-w-[220px] truncate text-muted-foreground"
                                  title={trendLabels[p.dataKey as string]}
                                >
                                  {trendLabels[p.dataKey as string]}:
                                </span>
                                <span className="font-medium tabular-nums text-foreground">
                                  {p.value as number}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Legend
                      wrapperStyle={{
                        fontSize: 10,
                        paddingTop: 8,
                        lineHeight: "16px",
                        cursor: drilldownCode === null ? "pointer" : "default",
                      }}
                      iconType="circle"
                      iconSize={8}
                      onClick={(item) => {
                        if (drilldownCode !== null) return;
                        const id = item?.dataKey as string | undefined;
                        if (id && id !== OTHERS_ID) setDrilldownCode(id);
                      }}
                      formatter={(value: string) => {
                        const label = trendLabels[value] ?? value;
                        // Tighter truncation when there are lots of series.
                        const max = trendTopSeries.length > 12 ? 16 : 22;
                        return label.length > max ? `${label.slice(0, max - 1)}…` : label;
                      }}
                    />
                    {trendTopSeries.map((s, i) => {
                      const color = s.id === OTHERS_ID ? "#9ca3af" : seriesColor(i);
                      const isDrillable = drilldownCode === null && s.id !== OTHERS_ID;
                      return (
                        <Area
                          key={s.id}
                          type="monotone"
                          stackId="1"
                          dataKey={s.id}
                          stroke={color}
                          strokeWidth={1.5}
                          fill={`url(#gCat${i})`}
                          name={s.id}
                          style={{ cursor: isDrillable ? "pointer" : "default" }}
                          onClick={() => {
                            if (isDrillable) setDrilldownCode(s.id);
                          }}
                        />
                      );
                    })}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No data for the selected range.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* India Heatmap — mirrors the dashboard's date + category filters */}
      <IndiaHeatmap
        filter={{
          created_at_from: range.from,
          created_at_to: range.to,
          category: selectedCats ? Array.from(selectedCats) : undefined,
        }}
      />

      {/* Complaint Volume by Category — aggregate bar chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Complaint Volume by Category</CardTitle>
          <span className="text-xs text-muted-foreground">
            Top {categoryBarData.length} ·{" "}
            {volumeByCategory.length > 0
              ? fmtNumber(volumeByCategory.reduce((s, c) => s + c.complaints, 0))
              : "—"}{" "}
            total
          </span>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            {categoryBarData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryBarData}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={170}
                    tick={{ fontSize: 11, fill: "var(--foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 24)}…` : v)}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "var(--accent)", opacity: 0.4 }}
                    formatter={(
                      value: number,
                      _: unknown,
                      item: { payload?: { name?: string } },
                    ) => [value, item?.payload?.name ?? ""]}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {categoryBarData.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No data for the selected range.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Top Entities (2/3) + Resolution SLA (1/3) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Top Entities by Complaints</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/entities">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">Closed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topEntities.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-6 text-center text-xs text-muted-foreground"
                    >
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {topEntities.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer">
                    <TableCell>
                      <Link
                        to="/entities/$id"
                        params={{ id: e.id }}
                        className="font-medium hover:text-primary"
                      >
                        {e.entity}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {e.category ?? e.entity_type}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {fmtNumber(e.total_complaints)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className="bg-[color:color-mix(in_oklab,var(--status-warn)_15%,transparent)] text-[var(--status-warn)] border-transparent"
                      >
                        {fmtNumber(e.open_complaints)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{fmtNumber(e.closed_complaints)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <HugeiconsIcon
                icon={Zap}
                className="h-4 w-4 text-[var(--chart-emerald)]"
                strokeWidth={1.5}
              />
              Resolution SLA
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center pt-2">
            {(() => {
              const R = 80,
                stroke = 14,
                cx = 110,
                cy = 100;
              const circumference = Math.PI * R;
              const progress = (slaScore / 100) * circumference;
              return (
                <svg width="220" height="120" viewBox="0 0 220 120">
                  {/* background arc */}
                  <path
                    d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                  />
                  {/* progress arc */}
                  <path
                    d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
                    fill="none"
                    stroke="var(--chart-emerald)"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${progress} ${circumference}`}
                  />
                  {/* percent text */}
                  <text
                    x={cx}
                    y={cy - 14}
                    textAnchor="middle"
                    fontSize="28"
                    fontWeight="700"
                    fill="currentColor"
                  >
                    {slaScore}%
                  </text>
                </svg>
              );
            })()}
            <div className="-mt-1 text-xs text-muted-foreground">resolved on-time</div>
            <div className="mt-2 space-y-2 text-xs">
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="text-muted-foreground">Avg resolution</span>
                  <span className="font-semibold">9.2 days</span>
                </div>
                <Progress value={70} className="h-1.5" />
              </div>
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="text-muted-foreground">Within SLA</span>
                  <span className="font-semibold">{slaScore}%</span>
                </div>
                <Progress value={slaScore} className="h-1.5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiStat({
  label,
  value,
  delta,
  icon,
  iconColor,
}: {
  label: string;
  value: string;
  delta: string;
  icon: React.ReactNode;
  iconColor: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{
            background: `color-mix(in oklch, ${iconColor} 12%, transparent)`,
            color: iconColor,
          }}
        >
          {icon}
        </span>
      </div>
      <div className="mt-2 text-[22px] font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{delta}</div>
    </div>
  );
}

const INSIGHTS = [
  {
    accent: "var(--chart-violet)",
    badge: "Trend",
    title: "Withdrawal spike at brokerages",
    body: "+1,329% in 'Delayed Withdrawal' at ABC Securities (7d).",
    confidence: 92,
  },
  {
    accent: "var(--status-critical)",
    badge: "Pattern",
    title: "Cross-entity recurrence",
    body: "Similar 'Unauthorized Trades' language across 3 firms (14d).",
    confidence: 81,
  },
  {
    accent: "var(--status-resolved)",
    badge: "Improvement",
    title: "MF resolution time down",
    body: "14d → 9d for Mutual Fund Services. Replicate workflow.",
    confidence: 76,
  },
];

function InsightCarousel() {
  const [idx, setIdx] = useState(0);
  const total = INSIGHTS.length;
  const ins = INSIGHTS[idx];

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-1 flex-col px-4 py-3">
        <div className="flex items-center justify-between">
          <Badge variant="secondary" className="text-[10px] uppercase tracking-widest">
            {ins.badge}
          </Badge>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{ins.confidence}% confidence</span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setIdx((i) => (i - 1 + total) % total)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <HugeiconsIcon icon={ChevronLeft} className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              <span className="text-[10px] text-muted-foreground">
                {idx + 1}/{total}
              </span>
              <button
                onClick={() => setIdx((i) => (i + 1) % total)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
        <div className="mt-2 text-[13px] font-semibold leading-snug text-foreground">
          {ins.title}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{ins.body}</p>
        <div className="mt-auto pt-4">
          <Progress value={ins.confidence} className="h-1" />
          <div className="mt-2 flex justify-center gap-1">
            {INSIGHTS.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-foreground" : "w-1.5 bg-border"}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
