import { createFileRoute } from "@tanstack/react-router";
import { Mail01Icon, SentIcon, MessageMultiple01Icon, Inbox } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/communications")({
  head: () => ({ meta: [{ title: "Communications — OnFinance AI" }] }),
  component: CommsPage,
});

const threads = [
  {
    from: "ABC Securities",
    subject: "Response on Delayed Withdrawal cluster",
    time: "2h ago",
    unread: true,
    channel: "Email",
  },
  {
    from: "Horizon Securities",
    subject: "Compliance officer follow-up",
    time: "5h ago",
    unread: true,
    channel: "Email",
  },
  {
    from: "BlueRock Investments",
    subject: "Re: Settlement Delay enquiry",
    time: "Yesterday",
    unread: false,
    channel: "Portal",
  },
  {
    from: "GreenLeaf MF",
    subject: "Quarterly grievance summary submitted",
    time: "2d ago",
    unread: false,
    channel: "Email",
  },
  {
    from: "Sigma Capital",
    subject: "Action Taken Report — Unauthorized Trades",
    time: "3d ago",
    unread: false,
    channel: "ATR",
  },
];

function CommsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Communications"
        description="Correspondence with intermediaries and complainants."
        actions={
          <Button className="gap-2">
            <HugeiconsIcon icon={SentIcon} className="h-4 w-4" strokeWidth={1.5} /> Compose
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          tone="from-indigo-500 to-violet-500"
          icon={<HugeiconsIcon icon={Inbox} className="h-5 w-5" strokeWidth={1.5} />}
          label="Inbox"
          value="42"
          hint="12 unread"
        />
        <StatCard
          tone="from-amber-500 to-orange-500"
          icon={
            <HugeiconsIcon icon={MessageMultiple01Icon} className="h-5 w-5" strokeWidth={1.5} />
          }
          label="Awaiting Response"
          value="9"
          hint="SLA: 48h"
        />
        <StatCard
          tone="from-emerald-500 to-teal-500"
          icon={<HugeiconsIcon icon={Mail01Icon} className="h-5 w-5" strokeWidth={1.5} />}
          label="Sent (this week)"
          value="56"
          hint="14 ATRs filed"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Threads</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {threads.map((t) => (
            <div key={t.subject} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${t.unread ? "bg-primary" : "bg-muted"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`truncate text-sm ${t.unread ? "font-semibold" : "font-medium"}`}
                  >
                    {t.from}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {t.channel}
                  </Badge>
                </div>
                <div className="truncate text-xs text-muted-foreground">{t.subject}</div>
              </div>
              <span className="whitespace-nowrap text-xs text-muted-foreground">{t.time}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  tone,
  icon,
  label,
  value,
  hint,
}: {
  tone: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className={`h-1 bg-gradient-to-r ${tone}`} />
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${tone} text-white shadow-sm`}
          >
            {icon}
          </span>
        </div>
        <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
