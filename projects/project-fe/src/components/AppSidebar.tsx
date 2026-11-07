import { useState } from "react";
import { useUser } from "@/context/UserContext";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  DashboardSquare01Icon,
  ComplaintIcon,
  Building03Icon,
  Notification01Icon,
  AiBrain01Icon,
  MailSend01Icon,
  Settings01Icon,
  ChevronDown as ChevronDownIcon,
  PanelLeft as SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { HugeiconsProps } from "@hugeicons/react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  {
    title: "Monitoring",
    items: [
      { label: "Dashboard", url: "/", icon: DashboardSquare01Icon, exact: true },
      { label: "Complaint Explorer", url: "/complaints", icon: ComplaintIcon },
      { label: "Entities", url: "/entities", icon: Building03Icon },
      { label: "Alerts", url: "/notifications", icon: Notification01Icon },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { label: "AI Insights", url: "/insights", icon: AiBrain01Icon },
      { label: "Communications", url: "/communications", icon: MailSend01Icon },
    ],
  },
];

const EXPANDED_W = 224;
const COLLAPSED_W = 52;

function NavItem({
  label,
  url,
  icon,
  exact,
  expanded,
}: {
  label: string;
  url: string;
  icon: NonNullable<HugeiconsProps["icon"]>;
  exact?: boolean;
  expanded: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = exact ? pathname === url : pathname === url || pathname.startsWith(url + "/");

  return (
    <Link to={url} className="block w-full" title={!expanded ? label : undefined}>
      <div
        className={cn(
          "group relative flex items-center gap-2.5 rounded-lg py-2 text-[12px] font-medium transition-colors duration-100",
          expanded ? "px-2.5" : "justify-center px-0",
          active
            ? "bg-neutral-200/80 dark:bg-white/10 text-foreground"
            : "text-muted-foreground hover:bg-neutral-200/50 dark:hover:bg-white/7 hover:text-foreground",
        )}
      >
        <HugeiconsIcon
          icon={icon}
          className={cn(
            "h-[18px] w-[18px] shrink-0",
            active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
          )}
          strokeWidth={active ? 1.8 : 1.5}
        />
        {expanded && (
          <span className="truncate leading-none transition-opacity duration-200 opacity-100">
            {label}
          </span>
        )}

        {/* Tooltip in collapsed mode */}
        {!expanded && (
          <span className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            {label}
          </span>
        )}
      </div>
    </Link>
  );
}

function Section({
  title,
  items,
  expanded,
  open,
  onToggle,
}: {
  title: string;
  items: (typeof SECTIONS)[0]["items"];
  expanded: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {expanded && (
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center justify-between px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <span>{title}</span>
          <HugeiconsIcon
            icon={ChevronDownIcon}
            className={cn(
              "h-3 w-3 shrink-0 transition-transform duration-200",
              !open && "-rotate-90",
            )}
            strokeWidth={2}
          />
        </button>
      )}
      {(open || !expanded) && (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavItem key={item.url} {...item} expanded={expanded} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AppSidebar() {
  const [expanded, setExpanded] = useState(true);
  const { user } = useUser();
  const isAdminOrDev = user?.role === "admin" || user?.role === "developer";

  const allSections = [
    ...SECTIONS,
    ...(isAdminOrDev
      ? [
          {
            title: "System",
            items: [{ label: "Settings", url: "/settings", icon: Settings01Icon }],
          },
        ]
      : []),
  ];

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    Object.fromEntries([...SECTIONS, { title: "System" }].map((s) => [s.title, true])),
  );
  const toggle = (title: string) => setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));

  return (
    <aside
      className="h-full flex-shrink-0 flex flex-col bg-[var(--shell-bg)] overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
      style={{ width: expanded ? EXPANDED_W : COLLAPSED_W }}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center border-b border-border py-2.5",
          expanded ? "px-3 justify-between" : "px-0 justify-center",
        )}
      >
        {expanded ? (
          <>
            <Link to="/" className="flex items-center gap-2 min-w-0">
              <img
                src="/onfinance_logo.jpg"
                alt="OnFinance AI"
                className="h-7 w-7 shrink-0 rounded-md object-cover"
              />
              <span className="truncate text-[13px] font-semibold text-foreground leading-none">
                OnFinance AI
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-neutral-200/60 dark:hover:bg-white/10 hover:text-foreground"
              title="Collapse sidebar"
            >
              <HugeiconsIcon icon={SidebarLeftIcon} className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md overflow-hidden"
            title="Expand sidebar"
          >
            <img
              src="/onfinance_logo.jpg"
              alt="OnFinance AI"
              className="h-8 w-8 object-cover rounded-md"
            />
          </button>
        )}
      </div>

      {/* Nav */}
      <div
        className={cn(
          "flex-1 overflow-y-auto py-3 space-y-3 no-scrollbar",
          expanded ? "px-2" : "px-1.5",
        )}
      >
        {allSections.map((section, idx) => (
          <div key={section.title}>
            {idx > 0 && (
              <div
                className={cn(
                  "border-t border-border/50 mb-3",
                  expanded ? "mx-0.5" : "mx-auto w-5",
                )}
              />
            )}
            <Section
              title={section.title}
              items={section.items}
              expanded={expanded}
              open={openSections[section.title]}
              onToggle={() => toggle(section.title)}
            />
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        className={cn(
          "border-t border-border px-2 py-2.5 flex items-center gap-2",
          !expanded && "justify-center px-1.5",
        )}
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-neutral-200 dark:bg-white/10 text-[9px] font-bold text-foreground">
          v1
        </div>
        {expanded && (
          <div className="flex min-w-0 flex-col leading-tight transition-opacity duration-200 opacity-100">
            <span className="truncate text-[11px] font-medium text-foreground">
              Investor Complaint Intel
            </span>
            <span className="text-[10px] text-muted-foreground">v1.0 · Prototype</span>
          </div>
        )}
      </div>
    </aside>
  );
}
