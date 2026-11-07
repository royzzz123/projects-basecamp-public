import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Search01Icon,
  Building03Icon,
  ComplaintIcon,
  Settings01Icon,
  Logout01Icon,
  Cancel01Icon,
  TickDouble01Icon,
  GibbousMoonIcon,
  Sun01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { entities, complaints, notifications as buildNotifications } from "@/data/mock";
import { useUser } from "@/context/UserContext";
import { useTheme } from "@/context/ThemeContext";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TYPE_COLORS: Record<string, string> = {
  alert: "bg-[#e8735a]/10 text-[#c0392b]",
  resolved: "bg-[#5ac87e]/10 text-[#1e7a40]",
  new: "bg-[#7badd4]/10 text-[#2563a8]",
  status: "bg-[#f0c040]/10 text-[#92660a]",
};
const TYPE_DOT: Record<string, string> = {
  alert: "bg-[#e8735a]",
  resolved: "bg-[#5ac87e]",
  new: "bg-[#7badd4]",
  status: "bg-[#f0c040]",
};

function initials(email: string) {
  const parts = email.split("@")[0].split(/[._-]/);
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || email[0].toUpperCase()
  );
}

export function AppHeader() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState(() => buildNotifications());
  const { user } = useUser();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && !cmdOpen) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        setCmdOpen(true);
      }
      if (e.key === "Escape") setNotifOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cmdOpen]);

  const unread = useMemo(() => notifItems.filter((n) => !n.read).length, [notifItems]);

  const markAll = () => {
    setNotifItems((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success("All marked as read");
  };

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-6 border-b border-border bg-background px-5 relative z-30">
        {/* Search */}
        <button
          type="button"
          onClick={() => setCmdOpen(true)}
          className="flex h-9 w-full max-w-sm items-center gap-2.5 rounded-xl border border-border bg-background px-3.5 text-[13px] text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground"
        >
          <HugeiconsIcon icon={Search01Icon} className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="hidden items-center gap-1 rounded-lg border border-border bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground sm:inline-flex">
            <span>⌘</span>
            <span>K</span>
          </kbd>
        </button>

        {/* Right cluster */}
        <div className="flex items-center gap-3">
          <Link
            to="/complaints"
            className="text-[13px] font-semibold text-foreground transition-colors hover:text-foreground/80"
          >
            Explorer
          </Link>
          <Link
            to="/insights"
            className="text-[13px] font-semibold text-foreground transition-colors hover:text-foreground/80"
          >
            Insights
          </Link>

          {/* Bell */}
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            aria-label="Notifications"
            className="relative flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Bell} className="h-4 w-4" strokeWidth={1.5} />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-background" />
            )}
          </button>

          {/* Avatar */}
          <DropdownMenu open={profileOpen} onOpenChange={setProfileOpen}>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-200 text-black",
                  profileOpen
                    ? "gradient-button"
                    : "bg-gradient-to-br from-orange-100 via-pink-100 to-blue-100 hover:from-orange-200 hover:via-pink-200 hover:to-blue-200",
                )}
                aria-label="User menu"
              >
                {user ? initials(user.email) : "…"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-52 rounded-xl p-1 border-border shadow-md"
            >
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-2 mb-1">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md gradient-button text-[10px] font-bold text-black">
                  {user ? initials(user.email) : "…"}
                </span>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {user?.email ?? "Loading…"}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground capitalize">
                    {user?.role.replace(/_/g, " ") ?? ""}
                  </span>
                </div>
              </div>
              <DropdownMenuSeparator />
              {(user?.role === "admin" || user?.role === "developer") && (
                <DropdownMenuItem asChild className="rounded-lg gap-2 text-[13px]">
                  <Link to="/settings">
                    <HugeiconsIcon
                      icon={Settings01Icon}
                      className="h-3.5 w-3.5 text-muted-foreground"
                      strokeWidth={1.5}
                    />{" "}
                    Settings
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="rounded-lg gap-2 text-[13px] cursor-pointer"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                <HugeiconsIcon
                  icon={theme === "dark" ? Sun01Icon : GibbousMoonIcon}
                  className="h-3.5 w-3.5 text-muted-foreground"
                  strokeWidth={1.5}
                />
                {theme === "dark" ? "Light" : "Dark"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="rounded-lg gap-2 text-[13px] text-muted-foreground cursor-pointer"
                onClick={() => {
                  import("@/lib/api").then(({ logout }) => logout());
                  navigate({ to: "/login" });
                }}
              >
                <HugeiconsIcon icon={Logout01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} /> Sign
                out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Notification drawer */}
      {notifOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)}>
          <div
            className="absolute right-0 top-0 h-full w-[380px] bg-background border-l border-border shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <div className="text-[14px] font-semibold text-foreground">Notifications</div>
                {unread > 0 && (
                  <div className="text-[11px] text-muted-foreground">{unread} unread</div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={markAll}
                  disabled={unread === 0}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors"
                >
                  <HugeiconsIcon
                    icon={TickDouble01Icon}
                    className="h-3.5 w-3.5"
                    strokeWidth={1.5}
                  />
                  Mark all read
                </button>
                <button
                  onClick={() => setNotifOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {notifItems.slice(0, 30).map((n) => {
                const dot = TYPE_DOT[n.type] ?? "bg-muted-foreground";
                const badge = TYPE_COLORS[n.type] ?? "";
                const linkProps =
                  n.link.kind === "entity"
                    ? { to: "/entities/$id" as const, params: { id: n.link.id } }
                    : { to: "/complaints/$id" as const, params: { id: n.link.id } };
                return (
                  <Link
                    key={n.id}
                    {...linkProps}
                    onClick={() => setNotifOpen(false)}
                    className={cn(
                      "flex gap-3 px-4 py-3 hover:bg-muted/50 transition-colors",
                      !n.read && "bg-primary/[0.03]",
                    )}
                  >
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <span className={`h-2 w-2 rounded-full ${dot}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge}`}
                        >
                          {n.type}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtRelative(n.date)}
                        </span>
                        {!n.read && (
                          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500" />
                        )}
                      </div>
                      <div
                        className={cn(
                          "text-[13px] leading-snug",
                          !n.read
                            ? "font-semibold text-foreground"
                            : "font-medium text-foreground/80",
                        )}
                      >
                        {n.title}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                        {n.detail}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-4 py-3">
              <Link
                to="/notifications"
                onClick={() => setNotifOpen(false)}
                className="block w-full rounded-lg bg-muted/60 py-2 text-center text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                View all notifications
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Command palette */}
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Search entities and complaints…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Entities">
            {entities.slice(0, 8).map((e) => (
              <CommandItem
                key={e.id}
                value={`${e.name} ${e.registrationId}`}
                onSelect={() => {
                  setCmdOpen(false);
                  navigate({ to: "/entities/$id", params: { id: e.id } });
                }}
              >
                <HugeiconsIcon
                  icon={Building03Icon}
                  className="mr-2 h-4 w-4 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span>{e.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{e.type}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Complaints">
            {complaints.slice(0, 8).map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.id} ${c.subCategory}`}
                onSelect={() => {
                  setCmdOpen(false);
                  navigate({ to: "/complaints/$id", params: { id: c.id } });
                }}
              >
                <HugeiconsIcon
                  icon={ComplaintIcon}
                  className="mr-2 h-4 w-4 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span>{c.id}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {c.subCategory}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
