import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bell,
  Notification01Icon,
  Calendar01Icon,
  TickDouble01Icon,
  Clock01Icon,
  Tag01Icon,
  File01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead, useSortState } from "@/components/SortableHead";
import { EmptyState } from "@/components/PageHeader";
import { AppFilterBar } from "@/components/AppFilterBar";
import { notifications as buildNotifications } from "@/data/mock";
import { fmtRelative } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — OnFinance AI" },
      { name: "description", content: "Alerts, status changes, and recent activity." },
    ],
  }),
  component: NotificationsPage,
});

const TYPE_STYLES: Record<string, { bg: string; text: string; dot: string; rowBg: string }> = {
  alert: {
    bg: "bg-[#e8735a]/10",
    text: "text-[#c0392b]",
    dot: "bg-[#e8735a]",
    rowBg: "bg-[#e8735a]/[0.04]",
  },
  resolved: {
    bg: "bg-[#5ac87e]/10",
    text: "text-[#1e7a40]",
    dot: "bg-[#5ac87e]",
    rowBg: "bg-[#5ac87e]/[0.04]",
  },
  new: {
    bg: "bg-[#7badd4]/10",
    text: "text-[#2563a8]",
    dot: "bg-[#7badd4]",
    rowBg: "bg-[#7badd4]/[0.04]",
  },
  status: {
    bg: "bg-[#f0c040]/10",
    text: "text-[#92660a]",
    dot: "bg-[#f0c040]",
    rowBg: "bg-[#f0c040]/[0.04]",
  },
};

const TYPE_LABELS: Record<string, string> = {
  alert: "Alert",
  resolved: "Resolved",
  new: "New",
  status: "Status",
};

function TypeBadge({ type }: { type: string }) {
  const s = TYPE_STYLES[type] ?? TYPE_STYLES.status;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-current/20 whitespace-nowrap ${s.bg} ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

function NotificationsPage() {
  const allItems = useMemo(() => buildNotifications(), []);
  const [items, setItems] = useState(allItems);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [readFilter, setReadFilter] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE = 20;

  const filtered = useMemo(() => {
    return items.filter((n) => {
      if (typeFilter !== "all" && n.type !== typeFilter) return false;
      if (readFilter === "unread" && n.read) return false;
      if (readFilter === "read" && !n.read) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!n.title.toLowerCase().includes(q) && !n.detail.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [items, typeFilter, readFilter, search]);

  const { sortBy, sortDir, onSort, applySort } = useSortState();
  const sorted = applySort(
    filtered as unknown as Record<string, unknown>[],
  ) as unknown as typeof filtered;
  const pageItems = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));

  const markAll = () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success("All notifications marked as read");
  };

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <div className="flex flex-col gap-4 h-full">
      <AppFilterBar
        title="Notifications"
        description={`${filtered.length} notification${filtered.length !== 1 ? "s" : ""}${unreadCount > 0 ? ` · ${unreadCount} unread` : ""}`}
        searchQuery={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        searchPlaceholder="Search notifications…"
        filters={[
          {
            id: "type",
            label: "Type",
            value: typeFilter,
            options: [
              { id: "alert", label: "Alert" },
              { id: "resolved", label: "Resolved" },
              { id: "new", label: "New" },
              { id: "status", label: "Status" },
            ],
            onChange: (v) => {
              setTypeFilter(v);
              setPage(0);
            },
          },
          {
            id: "read",
            label: "Read",
            value: readFilter,
            options: [
              { id: "unread", label: "Unread" },
              { id: "read", label: "Read" },
            ],
            onChange: (v) => {
              setReadFilter(v);
              setPage(0);
            },
          },
        ]}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={markAll}
            disabled={unreadCount === 0}
          >
            <HugeiconsIcon icon={TickDouble01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} /> Mark
            all read
          </Button>
        }
      />

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<HugeiconsIcon icon={Bell} className="h-5 w-5" strokeWidth={1.5} />}
            title="You're all caught up"
            description="No notifications match your filters."
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-auto rounded-xl border border-border bg-card">
            <Table className="[&_th:not(:last-child)]:border-r [&_th:not(:last-child)]:border-border [&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-border">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border">
                  <SortableHead
                    icon={<HugeiconsIcon icon={Tag01Icon} className="h-3 w-3" strokeWidth={1.5} />}
                    label="Type"
                    sortKey="type"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={<HugeiconsIcon icon={File01Icon} className="h-3 w-3" strokeWidth={1.5} />}
                    label="Title"
                    sortKey="title"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon
                        icon={Notification01Icon}
                        className="h-3 w-3"
                        strokeWidth={1.5}
                      />
                    }
                    label="Detail"
                    sortKey="detail"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon icon={Calendar01Icon} className="h-3 w-3" strokeWidth={1.5} />
                    }
                    label="Date"
                    sortKey="date"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead
                    icon={
                      <HugeiconsIcon icon={Clock01Icon} className="h-3 w-3" strokeWidth={1.5} />
                    }
                    label="Age"
                    sortKey="date"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((n) => {
                  const s = TYPE_STYLES[n.type] ?? TYPE_STYLES.status;
                  const linkProps =
                    n.link.kind === "entity"
                      ? ({ to: "/entities/$id", params: { id: n.link.id } } as const)
                      : ({ to: "/complaints/$id", params: { id: n.link.id } } as const);
                  return (
                    <TableRow key={n.id} className={`group ${!n.read ? s.rowBg : ""}`}>
                      <TableCell>
                        <TypeBadge type={n.type} />
                      </TableCell>
                      <TableCell>
                        <Link
                          {...linkProps}
                          className={`text-[13px] text-[#2563a8] hover:text-[#1a4a8a] transition-colors ${!n.read ? "font-semibold" : "font-medium"}`}
                        >
                          {n.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground max-w-[320px] truncate">
                        {n.detail}
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                        {new Date(n.date).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                        {fmtRelative(n.date)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 text-[12px] text-muted-foreground">
            <span>
              Showing {page * PAGE + 1}–{Math.min((page + 1) * PAGE, filtered.length)} of{" "}
              {filtered.length}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <span className="px-1 text-[11px]">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
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
