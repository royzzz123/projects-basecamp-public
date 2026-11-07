// Deterministic mock data for the Complaint Intelligence Dashboard.
// All entity/complaint/alert/activity data is generated client-side from a seeded RNG
// so charts and lists are stable across reloads.

export type EntityType =
  | "Brokerage"
  | "Mutual Fund"
  | "Investment Advisor"
  | "Portfolio Manager"
  | "Depository Participant"
  | "Merchant Banker";

export type ComplaintStatus = "Filed" | "Under Review" | "Action Taken" | "Resolved" | "Closed";

export type Severity = "Low" | "Medium" | "High" | "Critical";

export type Category =
  | "IPO / Prelisting"
  | "Listed Company"
  | "Brokerage Services"
  | "Mutual Fund Services"
  | "Depository Services"
  | "Investment Advisory"
  | "Portfolio Management";

export const CATEGORIES: Category[] = [
  "IPO / Prelisting",
  "Listed Company",
  "Brokerage Services",
  "Mutual Fund Services",
  "Depository Services",
  "Investment Advisory",
  "Portfolio Management",
];

export const SUB_CATEGORIES: Record<Category, string[]> = {
  "IPO / Prelisting": ["Allotment Issue", "Refund Delay", "Listing Delay"],
  "Listed Company": ["Dividend Not Received", "Corporate Action", "AGM Notice"],
  "Brokerage Services": [
    "Unauthorized Trades",
    "Delayed Withdrawal",
    "Margin Dispute",
    "Account Closure",
  ],
  "Mutual Fund Services": ["Redemption Delay", "NAV Discrepancy", "Statement Issue"],
  "Depository Services": ["DP Charges", "Demat Transfer Delay", "Pledge Issue"],
  "Investment Advisory": ["Misselling", "Unsuitable Advice", "Settlement Delays"],
  "Portfolio Management": ["Performance Reporting", "Fee Dispute", "Withdrawal Issue"],
};

export const STATUSES: ComplaintStatus[] = [
  "Filed",
  "Under Review",
  "Action Taken",
  "Resolved",
  "Closed",
];

export const SEVERITIES: Severity[] = ["Low", "Medium", "High", "Critical"];

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  registrationId: string;
  active: boolean;
  city: string;
  registeredOn: string; // ISO date
}

export interface ActivityEvent {
  id: string;
  complaintId: string;
  state: ComplaintStatus;
  action: string;
  remarks?: string;
  date: string; // ISO
  actor: string;
}

export interface Complaint {
  id: string; // complaint code, e.g. CMP-2026-001234
  entityId: string;
  category: Category;
  subCategory: string;
  status: ComplaintStatus;
  severity: Severity;
  description: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  closedAt?: string; // ISO
  daysOpen: number;
  overdue: boolean;
  timeline: ActivityEvent[];
}

export type AlertType =
  | "Complaint Spike"
  | "Recurring Pattern"
  | "Unresolved Breach"
  | "Volume Anomaly";

export interface Alert {
  id: string;
  type: AlertType;
  title: string;
  detail: string;
  entityId: string;
  category?: Category;
  subCategory?: string;
  severity: "high" | "medium";
  createdAt: string;
}

// ---------------- Seeded RNG ----------------
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260502);
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

// ---------------- Entities ----------------
const ENTITY_NAMES = [
  "ABC Securities",
  "Horizon Securities",
  "BlueRock Investments",
  "Sterling Capital",
  "Vanguard Brokers India",
  "Meridian Wealth",
  "Pinnacle Advisors",
  "Northstar Mutual",
  "Sapphire Capital",
  "Cobalt Trading",
  "Trident Securities",
  "Beacon Investments",
  "Crestline Brokerage",
  "Emerald Asset Management",
  "Falcon Capital Partners",
  "GoldenGate Securities",
  "Helios Wealth Advisors",
  "Indus Portfolio Managers",
  "Juniper Markets",
  "Kestrel Securities",
  "Lighthouse Capital",
  "Monsoon Investments",
  "Nimbus Brokers",
  "Orion Securities",
  "Phoenix Wealth",
  "Quartz Capital",
  "Ridgeline Advisors",
  "Saffron Securities",
  "Tundra Asset Co",
  "Umbra Investments",
];

const ENTITY_TYPES: EntityType[] = [
  "Brokerage",
  "Mutual Fund",
  "Investment Advisor",
  "Portfolio Manager",
  "Depository Participant",
  "Merchant Banker",
];

const CITIES = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Chennai",
  "Hyderabad",
  "Kolkata",
  "Pune",
  "Ahmedabad",
];

function makeEntities(): Entity[] {
  return ENTITY_NAMES.map((name, i) => ({
    id: `ent_${String(i + 1).padStart(3, "0")}`,
    name,
    type: ENTITY_TYPES[i % ENTITY_TYPES.length],
    registrationId: `INZ${String(100000 + i * 137).padStart(9, "0")}`,
    active: rand() > 0.08,
    city: pick(CITIES),
    registeredOn: new Date(2018 + Math.floor(rand() * 6), randInt(0, 11), randInt(1, 28))
      .toISOString()
      .slice(0, 10),
  }));
}

// ---------------- Complaints ----------------
const ACTORS = ["System", "S. Mehta", "R. Iyer", "P. Sharma", "Investor", "Compliance Team"];

function makeComplaints(entities: Entity[]): Complaint[] {
  const complaints: Complaint[] = [];
  const now = new Date("2026-04-30T12:00:00Z").getTime();
  const totalCount = 1488;

  // Weight some entities to have many complaints (creating "exposure")
  const weights = entities.map((_, i) => {
    if (i < 3) return 8;
    if (i < 8) return 4;
    if (i < 16) return 2;
    return 1;
  });
  const weightedPool: number[] = [];
  weights.forEach((w, i) => {
    for (let k = 0; k < w; k++) weightedPool.push(i);
  });

  for (let i = 0; i < totalCount; i++) {
    const entIdx = pick(weightedPool);
    const entity = entities[entIdx];
    const category = pick(CATEGORIES);
    const subCategory = pick(SUB_CATEGORIES[category]);
    // Recent bias: most complaints within last 30-60 days
    const ageDays =
      rand() < 0.6 ? randInt(0, 30) : rand() < 0.85 ? randInt(31, 90) : randInt(91, 180);
    const createdAt = new Date(now - ageDays * 86400000);

    const r = rand();
    let status: ComplaintStatus;
    if (r < 0.18) status = "Filed";
    else if (r < 0.4) status = "Under Review";
    else if (r < 0.55) status = "Action Taken";
    else if (r < 0.78) status = "Resolved";
    else status = "Closed";

    const severityRoll = rand();
    const severity: Severity =
      severityRoll < 0.05
        ? "Critical"
        : severityRoll < 0.25
          ? "High"
          : severityRoll < 0.65
            ? "Medium"
            : "Low";

    const isClosed = status === "Resolved" || status === "Closed";
    const closedAt = isClosed
      ? new Date(createdAt.getTime() + randInt(2, Math.max(3, ageDays)) * 86400000)
      : undefined;
    const updatedAt = closedAt ?? new Date(createdAt.getTime() + randInt(0, ageDays) * 86400000);
    const daysOpen = isClosed
      ? Math.max(1, Math.round((closedAt!.getTime() - createdAt.getTime()) / 86400000))
      : Math.round((now - createdAt.getTime()) / 86400000);
    const overdue = !isClosed && daysOpen > 30;

    const id = `CMP-2026-${String(i + 1).padStart(6, "0")}`;
    const timeline = makeTimeline(id, createdAt, status, closedAt);

    complaints.push({
      id,
      entityId: entity.id,
      category,
      subCategory,
      status,
      severity,
      description: makeDescription(entity.name, subCategory),
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      closedAt: closedAt?.toISOString(),
      daysOpen,
      overdue,
      timeline,
    });
  }
  return complaints.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function makeDescription(entityName: string, sub: string): string {
  const templates = [
    `Investor reports an issue regarding ${sub.toLowerCase()} with ${entityName}. Funds and documentation in question; investor requests prompt review and corrective action.`,
    `Complaint filed against ${entityName} for ${sub.toLowerCase()}. The investor has provided supporting statements and seeks resolution within the regulatory timeframe.`,
    `${entityName} flagged for ${sub.toLowerCase()}. Investor unable to reach a satisfactory response from the firm and has escalated the matter.`,
  ];
  return pick(templates);
}

function makeTimeline(
  complaintId: string,
  createdAt: Date,
  finalStatus: ComplaintStatus,
  closedAt?: Date,
): ActivityEvent[] {
  const events: ActivityEvent[] = [
    {
      id: `${complaintId}-1`,
      complaintId,
      state: "Filed",
      action: "Complaint received",
      date: createdAt.toISOString(),
      actor: "Investor",
      remarks: "Complaint logged via investor portal.",
    },
  ];
  const order: ComplaintStatus[] = ["Filed", "Under Review", "Action Taken", "Resolved", "Closed"];
  const finalIdx = order.indexOf(finalStatus);
  let cursor = createdAt.getTime();
  for (let i = 1; i <= finalIdx; i++) {
    cursor += randInt(1, 7) * 86400000;
    if (closedAt && i === finalIdx) cursor = closedAt.getTime();
    events.push({
      id: `${complaintId}-${i + 1}`,
      complaintId,
      state: order[i],
      action: actionFor(order[i]),
      date: new Date(cursor).toISOString(),
      actor: pick(ACTORS),
      remarks: i === finalIdx ? "Final disposition recorded." : undefined,
    });
  }
  return events;
}

function actionFor(state: ComplaintStatus): string {
  switch (state) {
    case "Under Review":
      return "Assigned to reviewer";
    case "Action Taken":
      return "Action taken report submitted";
    case "Resolved":
      return "Marked as resolved";
    case "Closed":
      return "Complaint closed";
    default:
      return "Filed";
  }
}

// ---------------- Alerts ----------------
function makeAlerts(entities: Entity[]): Alert[] {
  const now = "2026-04-28";
  return [
    {
      id: "alrt_1",
      type: "Complaint Spike",
      title: `Complaint Spike: ${entities[0].name}`,
      detail: "Delayed Withdrawal — 1329% increase",
      entityId: entities[0].id,
      category: "Brokerage Services",
      subCategory: "Delayed Withdrawal",
      severity: "high",
      createdAt: now,
    },
    {
      id: "alrt_2",
      type: "Recurring Pattern",
      title: `Recurring Violation: ${entities[1].name}`,
      detail: "Unauthorized Trades — 642% increase",
      entityId: entities[1].id,
      category: "Brokerage Services",
      subCategory: "Unauthorized Trades",
      severity: "high",
      createdAt: now,
    },
    {
      id: "alrt_3",
      type: "Unresolved Breach",
      title: `Unresolved Complaint: ${entities[2].name}`,
      detail: "Settlement Delays — 738% increase",
      entityId: entities[2].id,
      category: "Investment Advisory",
      subCategory: "Settlement Delays",
      severity: "medium",
      createdAt: now,
    },
    {
      id: "alrt_4",
      type: "Volume Anomaly",
      title: `Volume Anomaly: ${entities[3].name}`,
      detail: "Redemption Delay — 412% increase",
      entityId: entities[3].id,
      category: "Mutual Fund Services",
      subCategory: "Redemption Delay",
      severity: "medium",
      createdAt: now,
    },
  ];
}

// ---------------- Build dataset ----------------
export const entities: Entity[] = makeEntities();
export const complaints: Complaint[] = makeComplaints(entities);
export const alerts: Alert[] = makeAlerts(entities);

// ---------------- Derived helpers ----------------
export function getEntity(id: string): Entity | undefined {
  return entities.find((e) => e.id === id);
}
export function getComplaint(id: string): Complaint | undefined {
  return complaints.find((c) => c.id === id);
}
export function complaintsByEntity(entityId: string): Complaint[] {
  return complaints.filter((c) => c.entityId === entityId);
}

export interface EntityStats {
  total: number;
  open: number;
  resolved: number;
  avgResolutionDays: number;
}

export function statsForEntity(entityId: string): EntityStats {
  const list = complaintsByEntity(entityId);
  const open = list.filter((c) => c.status !== "Resolved" && c.status !== "Closed").length;
  const resolvedItems = list.filter((c) => c.status === "Resolved" || c.status === "Closed");
  const avg =
    resolvedItems.length === 0
      ? 0
      : Math.round(resolvedItems.reduce((sum, c) => sum + c.daysOpen, 0) / resolvedItems.length);
  return { total: list.length, open, resolved: resolvedItems.length, avgResolutionDays: avg };
}

export function globalStats() {
  const total = complaints.length;
  const open = complaints.filter((c) => c.status !== "Resolved" && c.status !== "Closed").length;
  const resolved = complaints.filter(
    (c) => c.status === "Resolved" || c.status === "Closed",
  ).length;
  const critical = complaints.filter((c) => c.severity === "Critical").length;
  const resolutionRate = total === 0 ? 0 : Math.round((resolved / total) * 100);
  return { total, open, resolved, critical, resolutionRate };
}

export function volumeByDay(days = 30): { date: string; count: number }[] {
  const now = new Date("2026-04-30T00:00:00Z").getTime();
  const buckets: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    buckets[d] = 0;
  }
  for (const c of complaints) {
    const d = c.createdAt.slice(0, 10);
    if (d in buckets) buckets[d]++;
  }
  return Object.entries(buckets).map(([date, count]) => ({ date, count }));
}

export function categoryBreakdown(): { name: Category; value: number }[] {
  const map = new Map<Category, number>();
  for (const c of complaints) map.set(c.category, (map.get(c.category) ?? 0) + 1);
  return CATEGORIES.map((c) => ({ name: c, value: map.get(c) ?? 0 }));
}

export interface EntityRanking extends Entity {
  stats: EntityStats;
}

export function entityRanking(): EntityRanking[] {
  return entities
    .map((e) => ({ ...e, stats: statsForEntity(e.id) }))
    .sort((a, b) => b.stats.total - a.stats.total);
}

export interface NotificationItem {
  id: string;
  type: "alert" | "status" | "new" | "resolved";
  title: string;
  detail: string;
  date: string;
  link: { kind: "entity" | "complaint"; id: string };
  read: boolean;
}

export function notifications(): NotificationItem[] {
  const items: NotificationItem[] = [];
  alerts.forEach((a) =>
    items.push({
      id: `n_${a.id}`,
      type: "alert",
      title: a.title,
      detail: a.detail,
      date: a.createdAt,
      link: { kind: "entity", id: a.entityId },
      read: false,
    }),
  );
  // recent status changes
  complaints.slice(0, 30).forEach((c, i) => {
    const last = c.timeline[c.timeline.length - 1];
    items.push({
      id: `n_${c.id}_${i}`,
      type:
        last.state === "Resolved" || last.state === "Closed"
          ? "resolved"
          : c.status === "Filed"
            ? "new"
            : "status",
      title: `${c.id} — ${last.state}`,
      detail: `${last.action} (${getEntity(c.entityId)?.name ?? ""})`,
      date: last.date,
      link: { kind: "entity", id: c.entityId },
      read: i > 6,
    });
  });
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
