import { cn } from "@/lib/utils";

type ComplaintStatus = string;
type Severity = string;

const statusStyles: Record<string, string> = {
  Filed: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "Under Review": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Action Taken": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Closed: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  ACTION_BY_SE: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  ACTION_BY_COMPANY: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  RESOLVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  CLOSED: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400",
};

const statusDot: Record<string, string> = {
  Filed: "bg-amber-500",
  "Under Review": "bg-blue-500",
  "Action Taken": "bg-purple-500",
  Resolved: "bg-emerald-500",
  Closed: "bg-teal-500",
  PENDING: "bg-amber-500",
  OPEN: "bg-blue-500",
  ACTION_BY_SE: "bg-purple-500",
  ACTION_BY_COMPANY: "bg-orange-500",
  RESOLVED: "bg-emerald-500",
  CLOSED: "bg-teal-500",
};

const sevStyles: Record<string, string> = {
  Low: "bg-[#b0b8c8]/20 text-[#5a6478]",
  Medium: "bg-[#f0c040]/15 text-[#b08800]",
  High: "bg-[#e8735a]/15 text-[#b03a1e]",
  Critical: "bg-[#e8735a]/25 text-[#9a2010] font-semibold",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ComplaintStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap",
        statusStyles[status] ?? "bg-[#b0b8c8]/20 text-[#5a6478]",
        className,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusDot[status] ?? "bg-[#b0b8c8]")}
      />
      {status}
    </span>
  );
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap",
        sevStyles[severity],
        className,
      )}
    >
      {severity}
    </span>
  );
}

export function OverdueBadge({ days }: { days: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8735a]/15 px-2.5 py-1 text-[11px] font-medium text-[#b03a1e] whitespace-nowrap">
      <span className="h-1.5 w-1.5 rounded-full bg-[#e8735a] shrink-0" />
      Overdue · {days}d
    </span>
  );
}
