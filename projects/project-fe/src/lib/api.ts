// ── Token storage ─────────────────────────────────────────────────────────────

const TOKEN_KEY = "sebi_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ── Base fetch ────────────────────────────────────────────────────────────────

// Windows-1252 code page map for the 0x80–0x9F range (the part latin-1 leaves undefined).
// JSON.parse gives us Unicode codepoints for these chars, not raw bytes.
const WIN1252: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

// Fix double-UTF8-encoded strings (Mojibake from data ingestion).
// The data was encoded as Windows-1252 bytes, then those bytes were mis-decoded
// as UTF-8, producing garbled Unicode. We reverse: map each char back to its
// Windows-1252 byte, then re-decode the byte sequence as UTF-8.
function fixEncoding(s: string): string {
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const cp = s.charCodeAt(i);
      bytes[i] = WIN1252[cp] ?? cp & 0xff;
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded.includes("�") ? s : decoded;
  } catch {
    return s;
  }
}

// Recursively walk any JSON value and fix encoding on all strings.
function fixEncodingDeep<T>(val: T): T {
  if (typeof val === "string") return fixEncoding(val) as unknown as T;
  if (Array.isArray(val)) return val.map(fixEncodingDeep) as unknown as T;
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) out[k] = fixEncodingDeep(v);
    return out as unknown as T;
  }
  return val;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/v1${path}`, { ...init, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    const err = new ApiError(res.status, body?.error?.code ?? "unknown", msg);

    if (res.status === 401 && path !== "/auth/login") {
      clearToken();
      window.dispatchEvent(new CustomEvent("sebi:session-expired"));
    }

    throw err;
  }

  const data = await res.json();
  return fixEncodingDeep<T>(data);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  role: "developer" | "admin" | "business_user";
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  token: string;
  expires_at: string;
  user: User;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

export async function getMe(): Promise<User> {
  return apiFetch<User>("/auth/me");
}

export interface SignupRequest {
  email: string;
  password: string;
  role: "developer" | "admin" | "business_user";
  org_id?: string;
}

export async function signup(req: SignupRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export function logout(): void {
  clearToken();
}

// ── Complaints ────────────────────────────────────────────────────────────────

export interface Complaint {
  complaint_id: number;
  entityscreenid: string;
  intermediary_name: string | null;
  category: string | null;
  sub_category: string;
  status: string;
  created_date: string;
  modified_date: string;
  // One-line AI summary joined from complaint_summary at list-time. Null
  // when the summary hasn't been generated yet for this complaint.
  concise_summary?: string | null;
}

export interface ComplaintListParams {
  limit?: number;
  after?: string;
  entityscreenid?: string[];
  status?: string[];
  category?: string[];
  sub_category?: string[];
  created_at_from?: string;
  created_at_to?: string;
  modified_at_from?: string;
  modified_at_to?: string;
}

export interface ComplaintListResponse {
  items: Complaint[] | null;
  next_cursor: string | null;
  limit: number;
  total: number;
}

export async function listComplaints(
  params: ComplaintListParams = {},
): Promise<ComplaintListResponse> {
  const q = new URLSearchParams();
  if (params.limit) q.set("limit", String(params.limit));
  if (params.after) q.set("after", params.after);
  params.entityscreenid?.forEach((v) => q.append("entityscreenid", v));
  params.status?.forEach((v) => q.append("status", v));
  params.category?.forEach((v) => q.append("category", v));
  params.sub_category?.forEach((v) => q.append("sub_category", v));
  if (params.created_at_from) q.set("created_at_from", params.created_at_from);
  if (params.created_at_to) q.set("created_at_to", params.created_at_to);
  if (params.modified_at_from) q.set("modified_at_from", params.modified_at_from);
  if (params.modified_at_to) q.set("modified_at_to", params.modified_at_to);
  const qs = q.toString();
  return apiFetch<ComplaintListResponse>(`/complaints${qs ? `?${qs}` : ""}`);
}

export interface FilterOptions {
  statuses: string[];
  categories: { code: string; name: string }[];
  sub_categories: { name: string }[];
}

export async function getComplaintFilters(): Promise<FilterOptions> {
  return apiFetch<FilterOptions>("/complaints/filters");
}

// ── Entities ──────────────────────────────────────────────────────────────────

// FilterItem — returned by GET /v1/entities/filter (typeahead)
export interface Entity {
  id: string;
  name: string;
}

export interface EntityFilterResponse {
  items: Entity[];
  next_cursor: string | null;
  limit: number;
}

// ListItem — returned by GET /v1/entities (full table with counts)
export interface EntityListItem {
  id: string;
  entity: string;
  entity_type: string;
  category: string | null;
  registration_number: string | null;
  total_complaints: number;
  open_complaints: number;
  closed_complaints: number;
  first_level_review_escalated: number;
  first_level_review_escalation_pct: number;
  second_level_review_escalated: number;
  second_level_review_escalation_pct: number;
}

export interface EntityListResponse {
  items: EntityListItem[];
  next_cursor: string | null;
  limit: number;
  total: number;
}

export interface EntityListParams {
  limit?: number;
  after?: string;
  category?: string[];
  entity_type?: string[];
}

export async function listEntities(params: EntityListParams = {}): Promise<EntityListResponse> {
  const q = new URLSearchParams();
  if (params.limit) q.set("limit", String(params.limit));
  if (params.after) q.set("after", params.after);
  params.category?.forEach((v) => q.append("category", v));
  params.entity_type?.forEach((v) => q.append("entity_type", v));
  const qs = q.toString();
  return apiFetch<EntityListResponse>(`/entities${qs ? `?${qs}` : ""}`);
}

// ── Complaint detail ──────────────────────────────────────────────────────────

export interface ComplaintDetailEntity {
  screen_id: string;
  name: string;
  type: string;
  category_code: string;
  category_name: string;
  registration_number: string;
}

export interface StatusProgression {
  state: string;
  reached_at: string;
  current: boolean;
}

export interface ActivityEntry {
  log_id: number;
  at: string;
  role: string;
  action: string;
  wfstate: string;
  remarks: string | null;
  doc_urls: string[];
  current_assignee_role: string | null;
}

export interface ComplaintDetail {
  complaint_id: number;
  complaint_code: string;
  complaint_details: string;
  sub_category: string;
  category: { code: string; name: string };
  filed_date: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  time_taken_seconds: number;
  time_taken_label: string;
  current_status: string;
  entity: ComplaintDetailEntity;
  status_progression: StatusProgression[];
  activity_timeline: ActivityEntry[];
  doc_urls: string[];
}

export async function getComplaintDetail(id: number | string): Promise<ComplaintDetail> {
  return apiFetch<ComplaintDetail>(`/complaints/${id}`);
}

// ── AI APIs ───────────────────────────────────────────────────────────────────

const AI_BASE =
  (import.meta.env.VITE_AI_API_BASE_URL as string | undefined) ?? "http://localhost:9000";

export interface ComplaintSummary {
  brief_summary: string;
  // One-line synopsis (~100-200 chars) suitable for tabular display. Added by
  // the AI service alongside brief_summary; nullable for backward compat with
  // summaries generated before the field existed.
  concise_summary?: string | null;
  key_issues: string[];
  demands: string[];
  sentiment: string;
  priority: "normal" | "urgent" | "most_urgent" | string;
}

export interface ComplaintSummaryResponse {
  complaint_id: number;
  complaint_code: string;
  category: string | null;
  sub_category: string | null;
  entity_name: string | null;
  filed_at: string | null;
  complaint_details: string;
  summary: ComplaintSummary;
}

export interface WorkflowAnalysis {
  timeline_quality: string | null;
  entity_conduct: string | null;
  investor_grievance_assessment: string | null;
  overall_summary: string | null;
}

export interface EnrichedTimelineEntry {
  at: string | null;
  role: string | null;
  action: string | null;
  wfstate: string | null;
  remarks: string | null;
  current_assignee_role: string | null;
  doc_summaries: {
    uuid: string;
    summary: string | null;
    error: string | null;
    // LLM-generated human-readable file name. Populated when LightOnOCR + the
    // naming step succeeded; null otherwise (caller falls back to UUID).
    ai_generated_name?: string | null;
  }[];
}

export interface WorkflowAnalysisResponse {
  complaint_id: number;
  complaint_code: string;
  category: string | null;
  sub_category: string | null;
  entity_name: string | null;
  filed_at: string | null;
  closed_at: string | null;
  time_taken_label: string | null;
  current_status: string | null;
  enriched_timeline: EnrichedTimelineEntry[];
  workflow_analysis: WorkflowAnalysis;
}

export async function getComplaintSummary(id: number | string): Promise<ComplaintSummaryResponse> {
  const res = await fetch(`${AI_BASE}/complaint-summary/${id}`);
  if (!res.ok) throw new Error(`AI summary failed: ${res.status}`);
  return res.json();
}

export async function getWorkflowAnalysis(id: number | string): Promise<WorkflowAnalysisResponse> {
  const res = await fetch(`${AI_BASE}/complaint-workflow-analysis/${id}`);
  if (!res.ok) throw new Error(`Workflow analysis failed: ${res.status}`);
  return res.json();
}

// Sub-category re-classifier — for complaints filed as "Others", the AI service
// inspects the complaint text + the canonical sub-category list and returns its
// best guess. `persist: true` (the default in the service) writes the result
// to CRUD's complaint_reclassifications collection. There's no approval
// lifecycle on the CRUD side anymore — the field is a pure AI-write,
// human-read store. Re-running classify on an already-classified complaint
// short-circuits and returns the stored value (the AI service checks CRUD
// before calling the LLM).
export interface ClassifyResponse {
  complaint_id: number;
  // Canonical name across the FE / CRUD surface. The AI service's response
  // still uses the legacy `suggested_sub_category` key — `classifySubCategory`
  // normalises it on read.
  ai_generated_sub_category: string | null;
  confidence: number;
  reasoning: string;
  persisted: boolean;
  candidates_considered: number;
}

// AI service response shape — narrower than ClassifyResponse because Devanshu
// dropped some fields from CRUD but kept them on the AI response. Internal-only.
interface AIClassifyResponse {
  complaint_id: number;
  suggested_sub_category: string | null;
  confidence: number;
  reasoning: string;
  model?: string;
  persisted?: boolean;
  candidates_considered?: number;
}

export async function classifySubCategory(
  id: number | string,
): Promise<ClassifyResponse> {
  const url = `${AI_BASE}/classify-sub-category/${encodeURIComponent(String(id))}`;
  const res = await fetch(url);
  if (!res.ok) {
    // Prefer the AI service's human-readable {"detail": "..."} message so the
    // UI can surface the real reason (e.g. "only 2 candidate sub-categories")
    // instead of a generic "endpoint failed". Falls back to status text on
    // bodies that don't parse as JSON or don't carry a detail field.
    let detail: string | undefined;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* not JSON, keep detail undefined */
    }
    throw new Error(detail ?? `Classify failed: ${res.status}`);
  }
  const raw = (await res.json()) as AIClassifyResponse;
  return {
    complaint_id: raw.complaint_id,
    ai_generated_sub_category: raw.suggested_sub_category,
    confidence: raw.confidence,
    reasoning: raw.reasoning,
    persisted: raw.persisted ?? false,
    candidates_considered: raw.candidates_considered ?? 0,
  };
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

export interface HeatmapStateItem {
  state_code: string;
  state_name: string;
  complaints: number;
}

export interface HeatmapStateResponse {
  items: HeatmapStateItem[];
  total: number;
  unresolved_complaints: number;
}

export interface HeatmapDistrictItem {
  district_code: string;
  district_name: string;
  complaints: number;
  ambiguous?: boolean;
}

export interface HeatmapDistrictResponse {
  state_code: string;
  state_name: string;
  total_complaints: number;
  districts: HeatmapDistrictItem[];
  unresolved: HeatmapDistrictItem[];
}

// HeatmapFilter mirrors the dashboard's date-range + category-codes filters.
// All fields optional — an empty object yields the lifetime aggregate (legacy
// behaviour the heatmap had before filters were wired in).
export interface HeatmapFilter {
  created_at_from?: string;
  created_at_to?: string;
  category?: string[];
}

function heatmapQS(p: HeatmapFilter): string {
  const q = new URLSearchParams();
  if (p.created_at_from) q.set("created_at_from", p.created_at_from);
  if (p.created_at_to) q.set("created_at_to", p.created_at_to);
  p.category?.forEach((c) => q.append("category", c));
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

export async function getHeatmapStates(p: HeatmapFilter = {}): Promise<HeatmapStateResponse> {
  return apiFetch<HeatmapStateResponse>(`/heatmap${heatmapQS(p)}`);
}

export async function getHeatmapDistricts(
  stateCode: string,
  p: HeatmapFilter = {},
): Promise<HeatmapDistrictResponse> {
  return apiFetch<HeatmapDistrictResponse>(`/heatmap/${stateCode}${heatmapQS(p)}`);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  total: number;
  open: number;
  closed: number;
  resolution_rate: number;
}

export interface DashboardVolumeByCategoryItem {
  category_code: string;
  category_name: string;
  complaints: number;
}

export interface DashboardVolumeByCategoryResponse {
  items: DashboardVolumeByCategoryItem[];
  total: number;
}

export interface DashboardFilter {
  created_at_from?: string;
  created_at_to?: string;
  category?: string[];
}

function dashboardQS(p: DashboardFilter): string {
  const q = new URLSearchParams();
  if (p.created_at_from) q.set("created_at_from", p.created_at_from);
  if (p.created_at_to) q.set("created_at_to", p.created_at_to);
  p.category?.forEach((c) => q.append("category", c));
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

export async function getDashboardSummary(p: DashboardFilter = {}): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>(`/dashboard/summary${dashboardQS(p)}`);
}

export async function getDashboardVolumeByCategory(
  p: Pick<DashboardFilter, "created_at_from" | "created_at_to"> = {},
): Promise<DashboardVolumeByCategoryResponse> {
  return apiFetch<DashboardVolumeByCategoryResponse>(
    `/dashboard/volume-by-category${dashboardQS(p)}`,
  );
}

export type DashboardGranularity = "day" | "week" | "month";

export interface DashboardTrendPoint {
  date: string;
  count: number;
}

export interface DashboardCategoryTrendSeries {
  category_code: string;
  category_name: string;
  total: number;
  points: DashboardTrendPoint[];
}

export interface DashboardCategoryTrendResponse {
  granularity: DashboardGranularity;
  series: DashboardCategoryTrendSeries[];
}

export interface DashboardCategoryTrendParams extends DashboardFilter {
  granularity?: DashboardGranularity;
}

export async function getDashboardVolumeByCategoryTrend(
  p: DashboardCategoryTrendParams = {},
): Promise<DashboardCategoryTrendResponse> {
  const q = new URLSearchParams();
  if (p.created_at_from) q.set("created_at_from", p.created_at_from);
  if (p.created_at_to) q.set("created_at_to", p.created_at_to);
  if (p.granularity) q.set("granularity", p.granularity);
  p.category?.forEach((c) => q.append("category", c));
  const qs = q.toString();
  return apiFetch<DashboardCategoryTrendResponse>(
    `/dashboard/volume-by-category-trend${qs ? `?${qs}` : ""}`,
  );
}

export interface DashboardSubcategoryTrendSeries {
  sub_category: string;
  total: number;
  points: DashboardTrendPoint[];
}

export interface DashboardSubcategoryTrendResponse {
  granularity: DashboardGranularity;
  series: DashboardSubcategoryTrendSeries[];
  limit: number;
}

export interface DashboardSubcategoryTrendParams extends DashboardFilter {
  granularity?: DashboardGranularity;
  limit?: number;
}

export async function getDashboardVolumeBySubcategoryTrend(
  p: DashboardSubcategoryTrendParams = {},
): Promise<DashboardSubcategoryTrendResponse> {
  const q = new URLSearchParams();
  if (p.created_at_from) q.set("created_at_from", p.created_at_from);
  if (p.created_at_to) q.set("created_at_to", p.created_at_to);
  if (p.granularity) q.set("granularity", p.granularity);
  if (p.limit) q.set("limit", String(p.limit));
  p.category?.forEach((c) => q.append("category", c));
  const qs = q.toString();
  return apiFetch<DashboardSubcategoryTrendResponse>(
    `/dashboard/volume-by-subcategory-trend${qs ? `?${qs}` : ""}`,
  );
}

// filterEntities powers typeahead (prefix search by name)
export async function filterEntities(
  params: { q?: string; limit?: number; after?: string } = {},
): Promise<EntityFilterResponse> {
  const q = new URLSearchParams();
  if (params.q) q.set("q", params.q);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.after) q.set("after", params.after);
  const qs = q.toString();
  return apiFetch<EntityFilterResponse>(`/entities/filter${qs ? `?${qs}` : ""}`);
}
