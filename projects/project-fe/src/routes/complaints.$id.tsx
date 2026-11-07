import { useEffect, useState, useMemo } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  Building03Icon,
  Calendar01Icon,
  CheckmarkCircle01Icon,
  File01Icon,
  MessageSquare,
  Cancel01Icon,
  Download04Icon,
  FileNotFoundIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  classifySubCategory,
  getComplaintDetail,
  getComplaintSummary,
  getWorkflowAnalysis,
  type ClassifyResponse,
  type ComplaintDetail,
  type ActivityEntry,
  type ComplaintSummaryResponse,
  type WorkflowAnalysisResponse,
} from "@/lib/api";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { toast } from "sonner";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";

const SENTIMENT_STYLES: Record<string, { pill: string; dot: string }> = {
  frustrated: {
    pill: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  angry: {
    pill: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  neutral: {
    pill: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  satisfied: {
    pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  hopeful: {
    pill: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    dot: "bg-sky-500",
  },
};

const PRIORITY_STYLES: Record<string, { pill: string; dot: string; label: string }> = {
  normal: {
    pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
    label: "Normal",
  },
  urgent: {
    pill: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    dot: "bg-amber-500",
    label: "Urgent",
  },
  most_urgent: {
    pill: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    dot: "bg-rose-500",
    label: "Most Urgent",
  },
};

const DOC_CHIP_COLORS = [
  { chip: "border-border bg-muted/40 text-foreground/70", dot: "bg-violet-400/70" },
  { chip: "border-border bg-muted/40 text-foreground/70", dot: "bg-emerald-400/70" },
  { chip: "border-border bg-muted/40 text-foreground/70", dot: "bg-amber-400/70" },
  { chip: "border-border bg-muted/40 text-foreground/70", dot: "bg-sky-400/70" },
  { chip: "border-border bg-muted/40 text-foreground/70", dot: "bg-rose-400/70" },
  { chip: "border-border bg-muted/40 text-foreground/70", dot: "bg-teal-400/70" },
];

function DocSummaryModal({
  doc,
  complaintId,
  onClose,
}: {
  doc: { uuid: string; summary: string | null };
  complaintId: number | string;
  onClose: () => void;
}) {
  const [fileStatus, setFileStatus] = useState<"loading" | "ok" | "error">("loading");
  const minioBase = (import.meta.env.VITE_MINIO_BASE_URL as string | undefined) ?? "/docs";
  const fileUrl = `${minioBase}/${complaintId}/${doc.uuid}`;
  const summaryText = doc.summary?.trim() || null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setFileStatus("loading");
    fetch(fileUrl)
      .then((r) => setFileStatus(r.ok ? "ok" : "error"))
      .catch(() => setFileStatus("error"));
  }, [doc.uuid]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative flex w-[88vw] max-w-6xl rounded-2xl border border-border bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
        style={{ height: "84vh" }}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg border border-border bg-background/90 p-1.5 text-muted-foreground hover:text-foreground transition-colors shadow-sm"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </button>

        {/* Left: PDF viewer */}
        <div className="flex-1 min-w-0 overflow-hidden border-r border-border bg-muted/10">
          {fileStatus === "loading" && (
            <div className="flex h-full items-center justify-center">
              <div className="space-y-3 w-2/3">
                {[90, 75, 85, 60, 80, 55].map((w, i) => (
                  <div
                    key={i}
                    className="h-3 animate-pulse rounded-full bg-muted"
                    style={{ width: `${w}%`, animationDelay: `${i * 60}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
          {fileStatus === "error" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <HugeiconsIcon icon={FileNotFoundIcon} size={36} className="opacity-40" />
              <p className="text-[13px]">Document not available</p>
            </div>
          )}
          {fileStatus === "ok" && (
            <Worker workerUrl="/pdf.worker.min.js">
              <div className="h-full w-full">
                <Viewer fileUrl={fileUrl} plugins={[defaultLayoutPlugin()]} />
              </div>
            </Worker>
          )}
        </div>

        {/* Right: AI summary */}
        <div className="flex w-[320px] shrink-0 flex-col">
          <div className="border-b border-border px-5 py-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400">
              AI Document Summary
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground truncate">
              {doc.uuid}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {summaryText ? (
              <p className="text-[12.5px] leading-relaxed text-foreground/80 animate-in fade-in duration-500">
                {summaryText}
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                No summary available for this document.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineSummaryPanel({
  data,
  loaded,
}: {
  data: WorkflowAnalysisResponse | null;
  loaded: boolean;
}) {
  const [visibleSections, setVisibleSections] = useState(0);
  const [showDocs, setShowDocs] = useState(false);
  const [modalDoc, setModalDoc] = useState<{
    uuid: string;
    summary: string | null;
    name?: string | null;
  } | null>(null);

  const sections = useMemo(() => {
    if (!data) return [];
    const wa = data.workflow_analysis;
    return [
      { label: "Overall Summary", text: wa.overall_summary },
      { label: "Entity Conduct", text: wa.entity_conduct },
      { label: "Investor Grievance", text: wa.investor_grievance_assessment },
      { label: "Timeline Quality", text: wa.timeline_quality },
    ].filter((s) => s.text);
  }, [data]);

  const docs = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const result: { uuid: string; summary: string | null; name: string | null }[] = [];
    for (const entry of data.enriched_timeline) {
      for (const d of entry.doc_summaries) {
        if (!seen.has(d.uuid)) {
          seen.add(d.uuid);
          result.push({
            uuid: d.uuid,
            summary: d.summary,
            name: d.ai_generated_name ?? null,
          });
        }
      }
    }
    return result;
  }, [data]);

  useEffect(() => {
    if (!loaded || !data) return;
    setVisibleSections(0);
    setShowDocs(false);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setVisibleSections(i);
      if (i >= sections.length) {
        clearInterval(iv);
        setTimeout(() => setShowDocs(true), 400);
      }
    }, 400);
    return () => clearInterval(iv);
  }, [loaded]);

  if (!loaded) {
    return (
      <div className="space-y-4 py-2">
        {[92, 78, 95, 68, 85, 60, 74, 55].map((w, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded-full bg-gradient-to-r from-violet-300/70 via-indigo-300/60 to-purple-300/70 dark:from-violet-700/50 dark:via-indigo-700/45 dark:to-purple-700/50"
            style={{ width: `${w}%`, animationDelay: `${i * 70}ms` }}
          />
        ))}
        <div className="my-3 border-t border-border" />
        {[85, 62, 76, 50].map((w, i) => (
          <div
            key={i}
            className="h-2.5 animate-pulse rounded-full bg-gradient-to-r from-violet-300/40 to-indigo-300/40 dark:from-violet-700/30 dark:to-indigo-700/30"
            style={{ width: `${w}%`, animationDelay: `${i * 70}ms` }}
          />
        ))}
      </div>
    );
  }

  // `loaded === true && data === null` means the fetch resolved but failed
  // (e.g. AI service unreachable or 5xx). Surface that explicitly instead of
  // rendering nothing — the user shouldn't be left staring at an empty card
  // wondering whether the analysis is loading or broken.
  if (!data) {
    return (
      <div className="py-2 text-[12px] text-amber-700 dark:text-amber-400">
        Workflow analysis unavailable — the AI service did not return a
        result. Check the AI service logs for details.
      </div>
    );
  }

  return (
    <div className="space-y-5 py-1">
      {sections.slice(0, visibleSections).map((s, i) => (
        <div key={i} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400">
            {s.label}
          </div>
          <p className="text-[13px] leading-relaxed text-foreground/85">{s.text}</p>
        </div>
      ))}

      {showDocs && docs.length > 0 && (
        <div className="animate-in fade-in duration-500">
          <div className="mb-4 mt-1 border-t border-border" />
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Documents · {docs.length} files
          </div>
          <div className="flex flex-wrap gap-2">
            {docs.map((doc, idx) => {
              const color = DOC_CHIP_COLORS[idx % DOC_CHIP_COLORS.length];
              // Prefer the AI-generated human name; fall back to a short
              // UUID prefix when the analysis pipeline hasn't named the doc
              // (e.g. OCR failed, or a complaint not yet analysed in prod).
              const label = doc.name ?? `${doc.uuid.slice(0, 8)}…`;
              return (
                <button
                  key={doc.uuid}
                  onClick={() => setModalDoc(doc)}
                  title={doc.name ? `${doc.name}\n${doc.uuid}` : doc.uuid}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] transition-all duration-150 hover:scale-[1.03] hover:shadow-sm ${
                    doc.name ? "" : "font-mono"
                  } ${color.chip}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
                  <span className="max-w-[16rem] truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {modalDoc && (
        <DocSummaryModal
          doc={modalDoc}
          complaintId={data.complaint_id}
          onClose={() => setModalDoc(null)}
        />
      )}
    </div>
  );
}

function AiAnalysisPanel({ complaint }: { complaint: ComplaintDetail }) {
  const [phase, setPhase] = useState<"thinking" | "done" | "error">("thinking");
  const [apiData, setApiData] = useState<ComplaintSummaryResponse | null>(null);
  const [visibleIssues, setVisibleIssues] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [showDemands, setShowDemands] = useState(false);

  useEffect(() => {
    getComplaintSummary(complaint.complaint_id)
      .then((d) => {
        setApiData(d);
        setPhase("done");
      })
      .catch((err) => {
        console.error("[ai-analysis-panel] summary fetch failed", err);
        setPhase("error");
      });
  }, [complaint.complaint_id]);

  useEffect(() => {
    if (phase !== "done" || !apiData) return;
    setVisibleIssues(0);
    setShowSummary(false);
    setShowDemands(false);
    const t1 = setTimeout(() => setShowSummary(true), 100);
    let i = 0;
    const t2 = setTimeout(() => {
      const iv = setInterval(() => {
        i++;
        setVisibleIssues(i);
        if (i >= apiData.summary.key_issues.length) {
          clearInterval(iv);
          setTimeout(() => setShowDemands(true), 200);
        }
      }, 160);
      return () => clearInterval(iv);
    }, 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase]);

  const sentiment = apiData?.summary.sentiment?.toLowerCase() ?? "";
  const sentimentStyle = SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES.neutral;
  const priority = apiData?.summary.priority?.toLowerCase().replace(/\s+/g, "_") ?? "";
  const priorityStyle = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.normal;

  return (
    <div className="h-full overflow-hidden rounded-xl border border-violet-200/60 bg-gradient-to-br from-violet-50/80 via-indigo-50/60 to-purple-50/80 dark:border-violet-800/40 dark:from-violet-950/40 dark:via-indigo-950/30 dark:to-purple-950/40 transition-all duration-500 flex flex-col">
      <div className="flex items-center gap-2.5 border-b border-violet-200/50 dark:border-violet-800/30 px-5 py-3">
        <span className="relative flex h-2 w-2">
          {phase === "thinking" && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${phase === "thinking" ? "bg-violet-500" : phase === "error" ? "bg-rose-500" : "bg-emerald-500"}`}
          />
        </span>
        <span className="text-[13px] font-semibold text-violet-700 dark:text-violet-300">
          {phase === "thinking"
            ? "AI is analysing…"
            : phase === "error"
              ? "Analysis unavailable"
              : "AI Analysis"}
        </span>
        <span className="ml-auto text-[11px] text-violet-500/60 dark:text-violet-400/50">
          {complaint.sub_category} · {complaint.entity.name.split(" ")[0]}
        </span>
      </div>

      <div className="relative flex-1 min-h-0">
        <div className="h-full overflow-y-auto px-5 pt-4 pb-10">
          {phase === "thinking" && (
            <div className="space-y-3">
              {[100, 85, 92, 70, 88, 60].map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className="h-3 animate-pulse rounded-full bg-gradient-to-r from-violet-300/70 via-indigo-300/70 to-purple-300/70 dark:from-violet-700/50 dark:via-indigo-700/50 dark:to-purple-700/50"
                    style={{ width: `${w}%`, animationDelay: `${i * 150}ms` }}
                  />
                </div>
              ))}
            </div>
          )}
          {phase === "error" && (
            <p className="text-[13px] text-muted-foreground">
              Could not load analysis. The AI service may be unavailable.
            </p>
          )}
          {phase === "done" && apiData && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap animate-in fade-in duration-300">
                {sentiment && (
                  <div
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${sentimentStyle.pill}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${sentimentStyle.dot}`} />
                    {sentiment}
                  </div>
                )}
                {priority && (
                  <div
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${priorityStyle.pill}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${priorityStyle.dot}`} />
                    {priorityStyle.label}
                  </div>
                )}
              </div>
              {showSummary && apiData.summary.concise_summary && (
                <p className="text-[14px] font-semibold leading-snug text-foreground animate-in fade-in slide-in-from-bottom-1 duration-300">
                  {apiData.summary.concise_summary}
                </p>
              )}
              {showSummary && apiData.summary.brief_summary && (
                <p className="text-[13px] leading-relaxed text-foreground/80 animate-in fade-in slide-in-from-bottom-1 duration-300">
                  {apiData.summary.brief_summary}
                </p>
              )}
              {visibleIssues > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Key Issues
                  </div>
                  <ul className="space-y-2">
                    {apiData.summary.key_issues.slice(0, visibleIssues).map((issue, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2.5 animate-in fade-in slide-in-from-left-1 duration-200"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500" />
                        <span className="text-[13px] leading-snug text-foreground/85">{issue}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {showDemands && apiData.summary.demands.length > 0 && (
                <div className="animate-in fade-in duration-300">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Demands
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {apiData.summary.demands.map((d, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 rounded-b-xl bg-gradient-to-t from-purple-50/95 via-purple-50/60 to-transparent dark:from-purple-950/80 dark:via-purple-950/40 dark:to-transparent" />
      </div>
    </div>
  );
}

const MINIO_BASE = (import.meta.env.VITE_MINIO_BASE_URL as string | undefined) ?? "/docs";

function docUrl(complaintId: string | number, docId: string) {
  return `${MINIO_BASE}/${complaintId}/${docId}`;
}

type FileKind = "pdf" | "image" | "csv" | "text" | "other";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function detectKind(docId: string, contentType?: string): FileKind {
  const ct = contentType?.toLowerCase() ?? "";
  const id = docId.toLowerCase();
  if (ct.includes("pdf") || id.endsWith(".pdf")) return "pdf";
  if (ct.includes("image") || /\.(png|jpe?g|gif|webp|svg)$/.test(id)) return "image";
  if (ct.includes("csv") || id.endsWith(".csv")) return "csv";
  if (ct.includes("text/plain") || /\.(txt|log)$/.test(id)) return "text";
  if (ct.includes("json") || ct.includes("xml") || /\.(json|xml)$/.test(id)) return "text";
  // Extensionless UUID docs from SEBI backend are always PDFs
  if (UUID_RE.test(id)) return "pdf";
  return "other";
}

export const Route = createFileRoute("/complaints/$id")({
  head: () => ({
    meta: [{ title: "Complaint — OnFinance AI" }],
  }),
  component: ComplaintDetailPage,
});

function PdfViewer({ url }: { url: string }) {
  const layoutPlugin = defaultLayoutPlugin();
  return (
    <Worker workerUrl="/pdf.worker.min.js">
      <div className="h-full w-full">
        <Viewer fileUrl={url} plugins={[layoutPlugin]} />
      </div>
    </Worker>
  );
}

function DocModal({ url, docId, onClose }: { url: string; docId: string; onClose: () => void }) {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [kind, setKind] = useState<FileKind>("other");
  const [textContent, setTextContent] = useState<string | null>(null);

  useEffect(() => {
    setStatus("loading");
    setTextContent(null);
    (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error("not found");
        const ct = r.headers.get("content-type") ?? "";
        const k = detectKind(docId, ct);
        setKind(k);
        if (k === "csv" || k === "text") {
          setTextContent(await r.text());
        }
        setStatus("ok");
      } catch {
        setStatus("error");
      }
    })();
  }, [url, docId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex h-[90vh] w-[90vw] max-w-5xl flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <HugeiconsIcon
              icon={File01Icon}
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
            />
            <span className="font-mono text-[12px] text-muted-foreground truncate">{docId}</span>
            {status === "ok" && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                {kind === "other" ? "file" : kind}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 ml-4">
            <a
              href={url}
              download={docId}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <HugeiconsIcon icon={Download04Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />
              Download
            </a>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden relative bg-muted/20">
          {/* Loading */}
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
                <span className="text-sm">Loading document…</span>
              </div>
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <HugeiconsIcon
                icon={FileNotFoundIcon}
                className="h-12 w-12 opacity-30"
                strokeWidth={1.5}
              />
              <p className="text-sm font-medium">File not available</p>
              <p className="text-xs opacity-60">The document could not be loaded from storage.</p>
            </div>
          )}

          {/* PDF — react-pdf-viewer */}
          {status === "ok" && kind === "pdf" && (
            <div className="h-full w-full overflow-hidden">
              <PdfViewer url={url} />
            </div>
          )}

          {/* Image */}
          {status === "ok" && kind === "image" && (
            <div className="h-full w-full overflow-auto flex items-center justify-center p-4">
              <img
                src={url}
                alt={docId}
                className="max-h-full max-w-full object-contain rounded-lg shadow-md"
              />
            </div>
          )}

          {/* CSV / Text — preformatted */}
          {status === "ok" && (kind === "csv" || kind === "text") && (
            <div className="h-full w-full overflow-auto p-4">
              <pre className="text-[12px] leading-relaxed text-foreground/90 whitespace-pre-wrap font-mono">
                {textContent}
              </pre>
            </div>
          )}

          {/* Other binary — open in new tab fallback */}
          {status === "ok" && kind === "other" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <HugeiconsIcon icon={File01Icon} className="h-12 w-12 opacity-30" strokeWidth={1.5} />
              <p className="text-sm font-medium">Preview not available for this file type</p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <HugeiconsIcon icon={Download04Icon} className="h-4 w-4" strokeWidth={1.5} />
                Open / Download file
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ComplaintDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const [data, setData] = useState<ComplaintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [showAi, setShowAi] = useState(false);
  const [timelineView, setTimelineView] = useState<"timeline" | "summary">("timeline");
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [summaryApiData, setSummaryApiData] = useState<WorkflowAnalysisResponse | null>(null);
  // Just the AI one-liner — used to mirror under the main heading when the
  // user opens the AI Analysis pane. AiAnalysisPanel does its own full fetch
  // of the same endpoint for the Description card; both hit the AI service's
  // cache so the second call is a no-op LLM-wise.
  const [conciseSummary, setConciseSummary] = useState<string | null>(null);
  // Set when the summary fetch fails outright (network / 5xx) — distinct
  // from "succeeded but concise_summary is null", which means the cached
  // entry pre-dates the schema change and needs `summarize_all.py` to
  // refresh it. Surfacing the failure prevents users from thinking the FE
  // is broken when the AI service is the actual blocker.
  const [summaryError, setSummaryError] = useState(false);
  // Tracks whether the workflow-analysis fetch is in flight after the first
  // "AI Analysis" click. Drives the "Generating names…" hint on the Documents
  // card so users don't think the names are missing — they're just cooking.
  const [analyzing, setAnalyzing] = useState(false);
  // AI-suggested sub-category for complaints filed as "Others". Triggered
  // alongside the workflow-analysis fetch when the user opens the AI pane.
  const [suggestedCategory, setSuggestedCategory] = useState<ClassifyResponse | null>(null);
  const [classifying, setClassifying] = useState(false);
  // Holds the human-readable reason classify failed (from the AI service's
  // {"detail": "..."} body when available, otherwise a generic message).
  // null = no error / not attempted yet.
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [docPage, setDocPage] = useState(0);
  const DOCS_PER_PAGE = 4;

  // Pre-fetch the one-liner once the complaint id is known so it's ready the
  // moment the user clicks "AI Analysis" — avoids a "AI Analysis" click
  // appearing to do nothing in the header while the summary endpoint runs.
  useEffect(() => {
    let cancelled = false;
    getComplaintSummary(id)
      .then((d) => {
        if (!cancelled) setConciseSummary(d.summary.concise_summary ?? null);
      })
      .catch((err) => {
        console.error("[complaint-detail] summary fetch failed", err);
        if (!cancelled) setSummaryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // UUID → AI-generated-name lookup derived from the workflow-analysis
  // response. Declared up here (with the other top-level hooks) so the hook
  // call order is stable across the early-return loading / error branches.
  // The Documents card consumes this to render human-readable names with the
  // UUID as a secondary label, falling back to UUID-only when no name exists.
  const docNameByUuid = useMemo(() => {
    const m = new Map<string, string>();
    if (!summaryApiData) return m;
    for (const entry of summaryApiData.enriched_timeline ?? []) {
      for (const ds of entry.doc_summaries ?? []) {
        if (ds.uuid && ds.ai_generated_name) m.set(ds.uuid, ds.ai_generated_name);
      }
    }
    return m;
  }, [summaryApiData]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getComplaintDetail(id)
      .then((d) => {
        setData(d);
        window.dispatchEvent(
          new CustomEvent("entity:name", { detail: { id, name: String(d.complaint_id) } }),
        );
      })
      .catch((e) => setError(e.message ?? "Failed to load complaint"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <h2 className="font-semibold text-destructive">Could not load complaint</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error ?? "Complaint not found"}</p>
        <Button onClick={() => router.history.back()} className="mt-4">
          Go back
        </Button>
      </div>
    );
  }

  const isNullDate = (iso: string) => iso.startsWith("0001-");

  const currentStepIdx = (() => {
    const markedIdx = data.status_progression.findIndex((s) => s.current);
    if (markedIdx !== -1) return markedIdx;
    let last = 0;
    data.status_progression.forEach((s, i) => {
      if (!isNullDate(s.reached_at)) last = i;
    });
    return last;
  })();

  const docs = data.doc_urls ?? [];

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-mono text-xl font-semibold tracking-tight">
                  {data.complaint_id}
                </h1>
                <StatusBadge status={data.current_status} />
                {data.complaint_code && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {data.complaint_code}
                  </span>
                )}
              </div>
              <p className="mt-2 text-base font-medium">{data.sub_category}</p>
              {/* AI one-liner — surfaced under the main heading only when
                  the user has opened the AI Analysis pane. The same string
                  is also rendered inside the Description card; mirroring it
                  here is the "at-a-glance" supervisor read. */}
              {showAi && conciseSummary && (
                <p className="mt-1.5 max-w-3xl text-[13px] leading-snug text-violet-700 dark:text-violet-300 animate-in fade-in slide-in-from-top-1 duration-300">
                  <span aria-hidden className="mr-1.5">✦</span>
                  {conciseSummary}
                </p>
              )}
              {showAi && !conciseSummary && summaryError && (
                <p className="mt-1.5 text-[12px] text-amber-700 dark:text-amber-400">
                  AI one-liner unavailable (summary endpoint failed — check the
                  AI service logs).
                </p>
              )}
              {/* AI-suggested sub-category — shown only for complaints
                  filed as "Others". Loading state stays visible while the
                  classifier runs (~3-8s) so the chip doesn't pop in late
                  without explanation. */}
              {showAi && data.sub_category?.toLowerCase() === "others" && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-300">
                  {classifying ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500"
                      />
                      Suggesting category…
                    </span>
                  ) : suggestedCategory?.ai_generated_sub_category ? (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                      title={suggestedCategory.reasoning}
                    >
                      <span aria-hidden>✦</span>
                      Suggested: {suggestedCategory.ai_generated_sub_category}
                      {typeof suggestedCategory.confidence === "number" && (
                        <span className="text-violet-500/80 dark:text-violet-400/80">
                          · {suggestedCategory.confidence}%
                        </span>
                      )}
                    </span>
                  ) : suggestedCategory &&
                    suggestedCategory.ai_generated_sub_category === null ? (
                    // 200 with explicit null — the classifier ran end-to-end
                    // and actively endorsed keeping "Others". Rendering a
                    // muted confirmation matters because the alternative is
                    // silence, which looks identical to a classifier that
                    // never ran or failed silently.
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      title={suggestedCategory.reasoning}
                    >
                      <span aria-hidden>✓</span>
                      &ldquo;Others&rdquo; appears correct — AI considered{" "}
                      {suggestedCategory.candidates_considered} candidate
                      {suggestedCategory.candidates_considered === 1 ? "" : "s"}
                      , none fit better
                      {typeof suggestedCategory.confidence === "number" && (
                        <span className="text-emerald-500/80 dark:text-emerald-400/80">
                          · {suggestedCategory.confidence}%
                        </span>
                      )}
                    </span>
                  ) : classifyError ? (
                    <span
                      className="text-[11px] text-amber-700 dark:text-amber-400"
                      title={classifyError}
                    >
                      Couldn't suggest a category — {classifyError}
                    </span>
                  ) : null}
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <Link
                  to="/entities/$id"
                  params={{ id: data.entity.screen_id }}
                  className="flex items-center gap-1.5 hover:text-primary"
                >
                  <HugeiconsIcon icon={Building03Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />{" "}
                  {data.entity.name}
                </Link>
                <span className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={File01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />{" "}
                  {data.category.name}
                </span>
                <span className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={Calendar01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />{" "}
                  Filed {fmtDate(data.filed_date)}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => toast.success("Note added")}>
                Add note
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.success("Marked as reviewed")}
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle01Icon}
                  className="mr-1 h-4 w-4"
                  strokeWidth={1.5}
                />{" "}
                Mark reviewed
              </Button>
              <Button size="sm" onClick={() => toast.message("Escalation routed to compliance")}>
                Escalate
              </Button>
            </div>
          </div>
        </div>

        {/* Stepper */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Status progression</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start">
              {data.status_progression.map((step, i) => {
                const done = !isNullDate(step.reached_at) || i <= currentStepIdx;
                const current = i === currentStepIdx;
                const isLast = i === data.status_progression.length - 1;
                const prev = i > 0 ? data.status_progression[i - 1] : null;
                const daysFromPrev =
                  prev && !isNullDate(prev.reached_at) && !isNullDate(step.reached_at)
                    ? Math.max(
                        0,
                        Math.round(
                          (new Date(step.reached_at).getTime() -
                            new Date(prev.reached_at).getTime()) /
                            86400000,
                        ),
                      )
                    : null;
                // SEBI-style ATR / review deadlines. The deadline is on the
                // transition INTO this step from the previous one, so the
                // badge between step (i-1) and step (i) is what gets flagged.
                //   AWAITING_FOR_REVIEW    → 21 days for first ATR cycle
                //   SECOND_LEVEL_REVIEW    → 10 days for second ATR cycle
                const DEADLINE_BY_STATE: Record<string, number> = {
                  AWAITING_FOR_REVIEW: 21,
                  SECOND_LEVEL_REVIEW: 10,
                };
                const deadline = DEADLINE_BY_STATE[step.state];
                const overdue =
                  deadline !== undefined && daysFromPrev !== null && daysFromPrev > deadline;
                return (
                  <div key={step.state} className="flex flex-1 flex-col items-center">
                    <div className="flex w-full items-center">
                      <div
                        className={`relative h-0.5 flex-1 ${i === 0 ? "invisible" : overdue ? "bg-red-400" : i <= currentStepIdx ? "bg-emerald-400" : "bg-border"}`}
                      >
                        {daysFromPrev !== null && (
                          <span
                            className={`absolute left-0 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-center text-[10px] font-medium ${
                              overdue
                                ? "border border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                                : "border border-border bg-background text-muted-foreground"
                            }`}
                            title={overdue ? `Exceeds the ${deadline}-day deadline` : undefined}
                          >
                            {overdue && (
                              <span aria-hidden className="mr-0.5">
                                ⚠
                              </span>
                            )}
                            {daysFromPrev} {daysFromPrev === 1 ? "day" : "days"}
                          </span>
                        )}
                      </div>
                      <div
                        className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          done && !current
                            ? "bg-emerald-500 text-white shadow-sm shadow-emerald-200 dark:shadow-emerald-900"
                            : current
                              ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
                              : "bg-muted text-muted-foreground ring-1 ring-border"
                        }`}
                      >
                        {i + 1}
                      </div>
                      <div
                        className={`h-0.5 flex-1 ${isLast ? "invisible" : i < currentStepIdx ? "bg-emerald-400" : "bg-border"}`}
                      />
                    </div>
                    <div className="mt-2 px-1 text-center">
                      <div
                        className={`text-[11px] font-medium leading-tight ${current ? "text-primary" : done ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {step.state.replace(/_/g, " ")}
                      </div>
                      {done && !isNullDate(step.reached_at) && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {fmtDate(step.reached_at)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:h-[460px]">
          {/* Description */}
          <Card
            className="flex flex-col overflow-hidden"
            style={{
              flex: showAi ? "1 1 0%" : "2 1 0%",
              minWidth: 0,
              transition: "flex 280ms cubic-bezier(0.4,0,0.2,1)",
            }}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>Description</span>
                <button
                  onClick={() => {
                    setShowAi((v) => !v);
                    // Eagerly trigger the workflow-analysis fetch the first
                    // time the user opens the AI pane — that's what
                    // populates ai_generated_name on every doc, which the
                    // Documents card on the right and the chips at the
                    // bottom of the AI Summary tab both consume. Without
                    // this, names only appeared once the user navigated to
                    // the Activity Timeline → AI Summary toggle.
                    if (!summaryLoaded) {
                      setAnalyzing(true);
                      getWorkflowAnalysis(id)
                        .then((d) => {
                          setSummaryApiData(d);
                          setSummaryLoaded(true);
                        })
                        .catch((err) => {
                          console.error(
                            "[complaint-detail] workflow-analysis fetch failed",
                            err,
                          );
                          // Mark as loaded so the panel transitions out of
                          // the skeleton state into "data === null" branch,
                          // which renders an explicit error / empty UI
                          // rather than showing pre-baked sample content.
                          setSummaryLoaded(true);
                        })
                        .finally(() => setAnalyzing(false));
                    }
                    // Re-classify "Others" complaints on the same click. The
                    // AI service persists a pending suggestion back to CRUD,
                    // so re-clicks during the same session short-circuit on
                    // local state.
                    if (
                      data.sub_category?.toLowerCase() === "others" &&
                      !suggestedCategory &&
                      !classifying
                    ) {
                      setClassifying(true);
                      setClassifyError(null);
                      classifySubCategory(id)
                        .then((r) => setSuggestedCategory(r))
                        .catch((err: unknown) => {
                          console.error(
                            "[complaint-detail] classify-sub-category failed",
                            err,
                          );
                          const msg =
                            err instanceof Error && err.message
                              ? err.message
                              : "AI service unavailable";
                          setClassifyError(msg);
                        })
                        .finally(() => setClassifying(false));
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-200 ${
                    showAi
                      ? "border border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400"
                      : "border border-violet-300 text-violet-600 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-900/20"
                  }`}
                >
                  <span className="text-[13px]">✦</span>
                  {showAi ? "Hide analysis" : "AI Analysis"}
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent
              className="flex flex-1 flex-col overflow-hidden min-w-0"
              style={{ contain: "layout style" }}
            >
              <p className="flex-1 text-sm leading-relaxed text-foreground/90">
                {data.complaint_details}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Created
                  </div>
                  <div className="mt-0.5">{fmtDate(data.created_at)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Updated
                  </div>
                  <div className="mt-0.5">{fmtRelative(data.updated_at)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Time taken
                  </div>
                  <div className="mt-0.5">{data.time_taken_label}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Closed
                  </div>
                  <div className="mt-0.5">
                    {data.closed_at && !isNullDate(data.closed_at) ? fmtDate(data.closed_at) : "—"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Analysis panel — middle column when active */}
          {showAi && (
            <div className="flex-1 animate-in fade-in slide-in-from-top-2 duration-400 min-w-0">
              <AiAnalysisPanel key={id} complaint={data} />
            </div>
          )}

          {/* Documents */}
          <Card className="flex flex-col" style={{ flex: "1 1 0%" }}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>Documents</span>
                {docs.length > 0 && (
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {docs.length} file{docs.length !== 1 ? "s" : ""}
                  </span>
                )}
              </CardTitle>
              {/* Workflow-analysis runs OCR + an LLM-naming pass per doc.
                  It can take 30-90s on first hit for document-heavy
                  complaints, so we surface a hint instead of leaving the
                  user staring at UUIDs wondering if AI Analysis is broken. */}
              {analyzing && (
                <p className="-mt-0.5 flex items-center gap-1.5 text-[11px] text-violet-600 dark:text-violet-400">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500"
                  />
                  Generating document names…
                </p>
              )}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-3">
              {docs.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                  <HugeiconsIcon
                    icon={FileNotFoundIcon}
                    className="h-8 w-8 opacity-30"
                    strokeWidth={1.5}
                  />
                  <p className="text-sm">No documents attached</p>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {docs
                      .slice(docPage * DOCS_PER_PAGE, (docPage + 1) * DOCS_PER_PAGE)
                      .map((docId) => {
                        const aiName = docNameByUuid.get(docId);
                        return (
                          <button
                            key={docId}
                            onClick={() => setActiveDoc(docId)}
                            title={aiName ? `${aiName}\n${docId}` : docId}
                            className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-left transition hover:border-primary/40 hover:bg-accent"
                          >
                            <HugeiconsIcon
                              icon={File01Icon}
                              className="h-4 w-4 shrink-0 text-muted-foreground"
                              strokeWidth={1.5}
                            />
                            <span className="min-w-0 flex-1">
                              {aiName ? (
                                <>
                                  <span className="block truncate text-[12px] font-medium text-foreground">
                                    {aiName}
                                  </span>
                                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                                    {docId}
                                  </span>
                                </>
                              ) : (
                                <span className="block truncate font-mono text-[11px] text-foreground">
                                  {docId}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                  {docs.length > DOCS_PER_PAGE && (
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <span className="text-[11px] text-muted-foreground">
                        {docPage * DOCS_PER_PAGE + 1}–
                        {Math.min((docPage + 1) * DOCS_PER_PAGE, docs.length)} of {docs.length}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setDocPage((p) => p - 1)}
                          disabled={docPage === 0}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                        >
                          <svg
                            className="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path d="M15 18l-6-6 6-6" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setDocPage((p) => p + 1)}
                          disabled={(docPage + 1) * DOCS_PER_PAGE >= docs.length}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                        >
                          <svg
                            className="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Activity timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={MessageSquare}
                  className="h-4 w-4 text-primary"
                  strokeWidth={1.5}
                />
                {timelineView === "timeline" ? "Activity timeline" : "AI Summary"}
              </div>
              {/* Switcher */}
              <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5 text-[12px] font-medium">
                <button
                  onClick={() => setTimelineView("timeline")}
                  className={`rounded-md px-3 py-1 transition-all duration-150 ${timelineView === "timeline" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Timeline
                </button>
                <button
                  onClick={() => {
                    setTimelineView("summary");
                    if (!summaryLoaded) {
                      getWorkflowAnalysis(id)
                        .then((d) => {
                          setSummaryApiData(d);
                          setSummaryLoaded(true);
                        })
                        .catch((err) => {
                          console.error(
                            "[complaint-detail] workflow-analysis fetch failed",
                            err,
                          );
                          setSummaryLoaded(true);
                        });
                    }
                  }}
                  className={`rounded-md px-3 py-1 transition-all duration-150 ${timelineView === "summary" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  ✦ AI Summary
                </button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <ol
                className={`relative space-y-5 border-l border-border pl-5 ${timelineView === "summary" ? "hidden" : ""}`}
              >
                {data.activity_timeline.map((evt) => (
                  <ActivityItem key={evt.log_id} evt={evt} onOpenDoc={setActiveDoc} />
                ))}
              </ol>
              <div className={timelineView === "timeline" ? "hidden" : ""}>
                <TimelineSummaryPanel data={summaryApiData} loaded={summaryLoaded} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Doc modal */}
      {activeDoc && (
        <DocModal
          url={docUrl(data.complaint_id, activeDoc)}
          docId={activeDoc}
          onClose={() => setActiveDoc(null)}
        />
      )}
    </>
  );
}

const ROLE_CONFIG: Record<string, { dot: string; badge: string; label: string }> = {
  Investor: {
    dot: "bg-blue-500",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    label: "Investor",
  },
  Entity: {
    dot: "bg-purple-500",
    badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    label: "Entity",
  },
  "Designated Body": {
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    label: "Designated Body",
  },
  System: {
    dot: "bg-neutral-400",
    badge: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
    label: "System",
  },
  DO: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    label: "DO",
  },
  DC: {
    dot: "bg-teal-500",
    badge: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
    label: "DC",
  },
};

const REMARK_BG: Record<string, string> = {
  Investor: "bg-blue-50/60 border-blue-200/60 dark:bg-blue-900/10 dark:border-blue-800/40",
  Entity: "bg-purple-50/60 border-purple-200/60 dark:bg-purple-900/10 dark:border-purple-800/40",
  "Designated Body":
    "bg-amber-50/60 border-amber-200/60 dark:bg-amber-900/10 dark:border-amber-800/40",
  System: "bg-muted/40 border-border",
  DO: "bg-emerald-50/60 border-emerald-200/60 dark:bg-emerald-900/10 dark:border-emerald-800/40",
  DC: "bg-teal-50/60 border-teal-200/60 dark:bg-teal-900/10 dark:border-teal-800/40",
};

function ActivityItem({ evt, onOpenDoc }: { evt: ActivityEntry; onOpenDoc: (id: string) => void }) {
  const cfg = ROLE_CONFIG[evt.role] ?? {
    dot: "bg-muted-foreground",
    badge: "bg-muted text-muted-foreground",
    label: evt.role,
  };
  const remarkBg = REMARK_BG[evt.role] ?? "bg-muted/40 border-border";

  return (
    <li className="relative">
      <span
        className={`absolute -left-[27px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-2 ${cfg.dot.replace("bg-", "ring-")}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.badge}`}
        >
          {cfg.label}
        </span>
        <span className="text-sm font-medium text-foreground">{evt.action.replace(/_/g, " ")}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium">
          {evt.wfstate.replace(/_/g, " ")}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDateTime(evt.at)}</div>
      {evt.remarks && (
        <div
          className={`mt-1.5 rounded-lg border p-3 text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap ${remarkBg}`}
        >
          {evt.remarks}
        </div>
      )}
      {evt.doc_urls && evt.doc_urls.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {evt.doc_urls.map((docId) => (
            <button
              key={docId}
              onClick={() => onOpenDoc(docId)}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-mono text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
            >
              <HugeiconsIcon icon={File01Icon} className="h-3 w-3" strokeWidth={1.5} />
              {docId.slice(0, 8)}…
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
