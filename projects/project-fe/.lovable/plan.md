
# Complaint Intelligence Dashboard

A clean, modern SaaS-style web app where users monitor their registered entities (firms/intermediaries) and the investor complaints filed against them. Designed for non-technical users — every system concept is translated into plain language. No backend exposed; all data is mocked in the frontend so the experience is fully interactive end-to-end.

## Information Architecture

Persistent left sidebar + top header on every page.

**Sidebar**
- Dashboard
- My Entities
- Complaints
- Notifications
- Profile / Settings

**Top header**
- Global search (entities + complaints, with grouped results)
- Notifications bell with unread badge
- User avatar with dropdown (Profile, Settings, Sign out)

**Brand**: GrievanceAI / "Investor Complaint Intelligence" — light, modern SaaS palette (slate + indigo primary, semantic colors for status). Mobile-responsive: sidebar collapses to a sheet drawer under `md`.

## Pages & Flows

### 1. Dashboard (Overview)
- Filter bar: time range, category, entity, severity, status
- Four summary cards: **Total Complaints**, **Open / Escalated**, **Resolution Rate**, **Critical Complaints**
- **Active Alerts** panel — color-coded (red/amber) with the four alert types from the spec:
  - Complaint spike for a firm
  - Recurring sub-category pattern
  - Unresolved beyond SLA
  - Volume spike vs baseline
  - Each row clickable → drills to filtered Complaints list or Entity detail
- **Complaint Volume Trend** (line/area chart, weekly)
- **Complaint Categories** (donut chart with legend)
- **Top Entities by Exposure** (mini-table: name, total, open, avg resolution days) → click row → entity detail
- **Recent Activity** feed (status changes, new complaints, resolutions)

### 2. My Entities
- Toggle: table view ⇄ card view
- Columns/fields: Name, Type/Category, Registration ID, Status (Active/Inactive), Total Complaints, Open, Avg Resolution
- Search + filter by type, status, complaint volume
- Sortable columns; pagination
- **Entity Detail page** (`/entities/:id`)
  - Header: name, registration #, type, active badge
  - KPI strip: total / open / resolved / avg resolution days
  - Tabs: **Overview** (mini trend + category breakdown for this entity) · **Complaints** (filtered list) · **Activity** (timeline of recent events) · **Details** (metadata)

### 3. Complaints
- List view: ID (complaint code), Entity (linked), Category, Sub-category, Status pill, Severity, Created, Last updated
- Filters: status, entity, category, severity, time range, search by ID/keywords
- Bulk: export CSV, mark as reviewed (UI-only)
- **Complaint Detail page** (`/complaints/:id`)
  - Header: complaint code, status pill, severity, linked entity
  - Summary: full description, category/sub-category, dates
  - **Status progression stepper**: Filed → Under Review → Action Taken (ATR) → Resolved → Closed
  - **Activity timeline** (chronological log of every action with remarks)
  - Actions: add note, mark reviewed, escalate, export (frontend-only)
  - "Related complaints" panel (same entity + same sub-category)

### 4. Notifications
- Unified inbox: alerts, status changes, new complaints, resolutions
- Group by Today / This Week / Earlier
- Mark all as read; click → deep-link into the relevant entity or complaint
- Empty state when nothing new

### 5. Profile / Settings
- Profile: name, email, role, avatar
- Preferences: theme (light/dark), default time range, density
- Notification preferences: which alert types to receive, email digest toggle
- Saved views (UI-only)

## Cross-cutting UX
- **Status colors**: Open (amber), In Progress (blue), Resolved (green), Closed (slate), Critical (red)
- **Empty / Loading / Error states** for every list and detail page (skeletons + friendly copy + recovery action)
- **404** and a route-level error boundary with retry
- Subtle hover/press states, micro-animations on cards and chart enter, smooth page transitions
- Keyboard-friendly: `/` focuses global search, `Esc` closes modals
- Fully responsive: sidebar → drawer on mobile, tables → stacked cards under `sm`

## Plain-language translation (spec → UI)
- `entity_master` → "Entities" / "Firms"
- `tt_complaints` → "Complaints"
- `tr_complaints` → "Activity timeline"
- `wfstate` → friendly status labels (Filed, Under Review, Action Taken, Resolved, Closed)
- `category_master` → "Category" filter and donut chart
- SLA breaches → "Overdue" badge with days-open count

## Technical Notes (internal)
- TanStack Start file-based routes: `/`, `/entities`, `/entities/$id`, `/complaints`, `/complaints/$id`, `/notifications`, `/settings`
- Each route has `head()` metadata, `errorComponent`, and `notFoundComponent` where it has a loader; root has global 404
- Mock data module (`src/data/mock.ts`) generates ~30 entities, ~1500 complaints, alerts, activity logs — deterministic seed for stable charts
- Loaders return mock data so SWR + filter-driven `loaderDeps` patterns work cleanly
- Charts via `recharts` (already common in shadcn stack); UI from existing shadcn components (Card, Table, Tabs, Sheet, Dialog, Badge, Select, Popover, Command for search)
- Global search uses `cmdk` (Command component) with grouped results
- Theme tokens already defined in `styles.css`; extend with status color tokens
- Strictly frontend — no API/DB references in UI copy

## Out of scope (this iteration)
- Real authentication / real user accounts
- Real backend integration
- Server-side export generation (CSV export uses client-side generation)

