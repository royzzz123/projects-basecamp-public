import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

// Cache of id → resolved name, populated by entity/complaint detail pages
const nameCache: Record<string, string> = {};

interface Segment {
  label: string;
  href: string;
  isCurrent: boolean;
}

function resolveLabel(seg: string, params: Record<string, string>): string {
  const id = params[seg === "$id" ? "id" : seg.replace("$", "")];
  if (!id) return toTitle(seg);
  if (seg === "$id") return nameCache[id] ?? id;
  return id;
}

function toTitle(str: string): string {
  return str
    .replace(/^\$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const ROUTE_LABELS: Record<string, string> = {
  "": "Home",
  entities: "Intermediaries",
  complaints: "Complaints",
  insights: "Insights",
  notifications: "Notifications",
  communications: "Communications",
  settings: "Settings",
};

export function AppBreadcrumb() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const { id, name } = (e as CustomEvent).detail;
      nameCache[id] = name;
      forceUpdate((n) => n + 1);
    };
    window.addEventListener("entity:name", handler);
    return () => window.removeEventListener("entity:name", handler);
  }, []);

  const state = useRouterState();
  const pathname = state.location.pathname;
  const params = (state.matches[state.matches.length - 1]?.params ?? {}) as Record<string, string>;

  const parts = pathname.split("/").filter(Boolean);

  if (parts.length === 0) return null;

  const segments: Segment[] = [{ label: "Home", href: "/", isCurrent: false }];

  let built = "";
  parts.forEach((part, i) => {
    built += `/${part}`;
    const isLast = i === parts.length - 1;
    const label = ROUTE_LABELS[part] ?? resolveLabel(part, params);
    segments.push({ label, href: built, isCurrent: isLast });
  });

  if (segments.length <= 1) return null;

  return (
    <nav aria-label="breadcrumb" className="flex items-center bg-background px-6 py-2">
      <ol className="flex items-center gap-0 flex-wrap">
        {segments.map((seg, i) => (
          <li key={seg.href} className="flex items-center">
            {i > 0 && (
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className="mx-1.5 h-3 w-3 shrink-0 text-muted-foreground/50"
                strokeWidth={1.5}
              />
            )}
            {seg.isCurrent ? (
              <span className="text-xs font-normal text-foreground max-w-[280px] truncate">
                {seg.label}
              </span>
            ) : (
              <Link
                to={seg.href}
                className="text-xs font-normal text-muted-foreground transition-colors hover:text-foreground max-w-[200px] truncate"
              >
                {seg.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
