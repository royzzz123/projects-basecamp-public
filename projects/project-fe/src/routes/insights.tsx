import { createFileRoute } from "@tanstack/react-router";
import {
  AiBrain01Icon,
  Lightbulb,
  Network,
  Sparkles,
  Target01Icon,
  TrendingUp,
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { NivoPie } from "@/components/NivoPie";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/insights")({
  head: () => ({ meta: [{ title: "AI Insights — OnFinance AI" }] }),
  component: InsightsPage,
});

const SIGNAL_CARDS = [
  { label: "Critical signals", value: 4, color: "#e8735a" },
  { label: "Need attention", value: 2, color: "#f0c040" },
  { label: "Cross-entity patterns", value: 1, color: "#7badd4" },
  { label: "Resolved this week", value: 7, color: "#5ac87e" },
];

const insightCards = [
  {
    icon: TrendingUp,
    color: "#7badd4",
    badge: "Trend",
    badgeColor: { bg: "bg-[#7badd4]/10", text: "text-[#7badd4]" },
    title: "Withdrawal complaints surging at brokerages",
    body: "A 1,329% spike in 'Delayed Withdrawal' complaints at ABC Securities over 7 days indicates a possible liquidity or settlement bottleneck.",
    confidence: 92,
  },
  {
    icon: Network,
    color: "#e8735a",
    badge: "Pattern",
    badgeColor: { bg: "bg-[#e8735a]/10", text: "text-[#e8735a]" },
    title: "Cross-entity recurrence detected",
    body: "Similar 'Unauthorized Trades' language across 3 brokerages in the last 14 days — suggests possible coordinated misconduct or shared sub-broker.",
    confidence: 81,
  },
  {
    icon: Lightbulb,
    color: "#5ac87e",
    badge: "Opportunity",
    badgeColor: { bg: "bg-[#5ac87e]/10", text: "text-[#5ac87e]" },
    title: "Resolution SLA improving",
    body: "Average resolution time dropped from 14d to 9d for Mutual Fund Services — workflow change worth replicating across other categories.",
    confidence: 76,
  },
  {
    icon: Target01Icon,
    color: "#f0c040",
    badge: "Anomaly",
    badgeColor: { bg: "bg-[#f0c040]/10", text: "text-[#f0c040]" },
    title: "Off-hours filings unusually high",
    body: "27% of new complaints last week were filed between 11pm–4am IST. Investigate whether automation or scripts are involved.",
    confidence: 68,
  },
];

const anomalyTrend = Array.from({ length: 14 }, (_, i) => {
  const base = 35 + Math.round(Math.sin(i / 2) * 8);
  const spike = i >= 9 ? (i - 8) * 22 : 0;
  return { day: `D${i + 1}`, actual: base + spike, expected: base };
});

const categoryPattern = [
  { name: "Brokerage", value: 92 },
  { name: "Mutual Fund", value: 76 },
  { name: "IPO", value: 71 },
  { name: "Depository", value: 64 },
  { name: "Advisory", value: 58 },
];

const severityPie = [
  { id: "Critical", label: "Critical", value: 92, color: "#e8735a" },
  { id: "High", label: "High", value: 78, color: "#f0c040" },
  { id: "Medium", label: "Medium", value: 61, color: "#7badd4" },
  { id: "Low", label: "Low", value: 44, color: "#5ac87e" },
];

const BAR_COLORS = ["#7badd4", "#5ac87e", "#f0c040", "#e8735a", "#a78bfa"];

const tooltipStyle = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--card)",
  fontSize: 12,
  color: "var(--foreground)",
} as const;

function InsightsPage() {
  return (
    <div className="space-y-4">
      {/* Top summary bar */}
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#7badd4]/10 text-[#7badd4]">
              <HugeiconsIcon icon={AiBrain01Icon} className="h-5 w-5" strokeWidth={1.5} />
            </span>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Weekly AI Summary
              </div>
              <div className="mt-0.5 text-sm font-medium text-foreground">
                4 critical signals · 2 require supervisor attention · 1 emerging cross-entity
                pattern
              </div>
            </div>
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
            <HugeiconsIcon icon={Sparkles} className="h-3.5 w-3.5" strokeWidth={1.5} /> View report
          </button>
        </div>
      </div>

      {/* Signal KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SIGNAL_CARDS.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {s.label}
              </span>
              <HugeiconsIcon
                icon={Zap}
                className="h-3.5 w-3.5"
                strokeWidth={1.5}
                style={{ color: s.color }}
              />
            </div>
            <div className="mt-2 text-2xl font-semibold" style={{ color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Anomaly chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <HugeiconsIcon
                icon={Sparkles}
                className="h-3.5 w-3.5 text-[#7badd4]"
                strokeWidth={1.5}
              />
              Anomaly Detection — Withdrawal complaints
            </CardTitle>
            <span className="inline-flex items-center rounded-full bg-[#e8735a]/10 px-2 py-0.5 text-[11px] font-medium text-[#e8735a] ring-1 ring-inset ring-[#e8735a]/20">
              Spike detected
            </span>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={anomalyTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gActual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e8735a" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#e8735a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gExpected" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7badd4" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#7badd4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="expected"
                    stroke="#7badd4"
                    strokeWidth={1.5}
                    fill="url(#gExpected)"
                    strokeDasharray="4 4"
                  />
                  <Area
                    type="monotone"
                    dataKey="actual"
                    stroke="#e8735a"
                    strokeWidth={2}
                    fill="url(#gActual)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-[#e8735a]" />
                Actual
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-[#7badd4]" />
                Expected (baseline)
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Confidence donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">AI Confidence by Severity</CardTitle>
          </CardHeader>
          <CardContent>
            <NivoPie data={severityPie} innerRadius={0.55} height={180} />
            <div className="mt-3 grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
              {severityPie.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: d.color }} />
                  <span className="flex-1 text-muted-foreground">{d.label}</span>
                  <span className="font-semibold">{d.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pattern strength bar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Pattern Strength by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryPattern} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                  domain={[0, 100]}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "var(--accent)", opacity: 0.5 }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={52}>
                  {categoryPattern.map((_, i) => (
                    <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Insight cards */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {insightCards.map((card) => (
          <div key={card.title} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: `${card.color}18`, color: card.color }}
              >
                <HugeiconsIcon icon={card.icon} className="h-4 w-4" strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ring-current/20 ${card.badgeColor.bg} ${card.badgeColor.text}`}
                  >
                    {card.badge}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Confidence {card.confidence}%
                  </span>
                </div>
                <h3 className="mt-1.5 text-[13px] font-semibold leading-snug">{card.title}</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {card.body}
                </p>
                <div className="mt-2.5 flex items-center gap-3">
                  <Progress value={card.confidence} className="h-1 flex-1" />
                  <span className="text-[11px] font-semibold" style={{ color: card.color }}>
                    {card.confidence}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
