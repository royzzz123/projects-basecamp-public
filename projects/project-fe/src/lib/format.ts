import { formatDistanceToNow } from "date-fns";

const IST = "Asia/Kolkata";

export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));

export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));

export const fmtRelative = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true });

export const fmtNumber = (n: number) => n.toLocaleString("en-IN");
