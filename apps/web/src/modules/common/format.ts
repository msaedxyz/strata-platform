// Text formats for dates, numbers and codes. One format for each kind of value in every module.
import type { BadgeTone, Status } from "@strata/design-system";
import { appConfig } from "../../config/app.config";
import type { Certainty, CodeName } from "../../api/types";

const locale = appConfig.format.locale;
const timeZone = appConfig.format.timeZone;

const dateTimeFmt = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone });
const dateFmt = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone });
const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone });
const numberFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });

const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatDateTime = (iso: string | null | undefined) => {
  const d = parse(iso);
  return d ? dateTimeFmt.format(d) : "";
};

/** A date only. Date-only values (YYYY-MM-DD) show the same day in every time zone. */
export const formatDate = (iso: string | null | undefined) => {
  const d = parse(iso);
  if (!d) return "";
  return iso && iso.length === 10 ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d) : dateFmt.format(d);
};

export const formatTime = (iso: string | null | undefined) => {
  const d = parse(iso);
  return d ? timeFmt.format(d) : "";
};

export const formatNumber = (n: number | null | undefined) => (n === null || n === undefined ? "" : numberFmt.format(n));
export const formatPercent = (n: number | null | undefined) => (n === null || n === undefined ? "" : pctFmt.format(n));

/** A duration in seconds as text, for example "4 min 10 s" or "2 h 5 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Lead time in days as months, for example "14 months". */
export function formatLeadTime(days: number | null | undefined): string {
  if (days === null || days === undefined) return "";
  const months = Math.round(days / 30.4);
  return months >= 1 ? `${months} ${months === 1 ? "month" : "months"}` : `${days} days`;
}

/** "care_and_maintenance" gives "Care and maintenance". */
export function humanise(code: string | null | undefined): string {
  if (!code) return "";
  const text = code.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The name of a code from a configuration list, or the code in words. */
export function nameOf(list: readonly CodeName[] | undefined, code: string | null | undefined): string {
  if (!code) return "";
  return list?.find((x) => x.code === code)?.name ?? humanise(code);
}

/** Certainty of a claim as a status (docs/07 rule 4): reported and speculative use the one unverified style. */
export function certaintyStatus(c: Certainty | null | undefined): Status | undefined {
  if (c === "reported") return "reported";
  if (c === "speculative") return "unconfirmed";
  return undefined;
}

/** The tier badge of a signal or an alert. */
export function tierBadge(tier: number): { label: string; tone: BadgeTone } {
  return { label: `T${tier}`, tone: tier === 0 ? "accent" : tier === 1 ? "warning" : "neutral" };
}

/** Today as YYYY-MM-DD in the app time zone. */
export function todayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(now);
  return parts;
}

/** The end of a day (YYYY-MM-DD) as an ISO timestamp, for "as of" reads. */
export function endOfDayIso(date: string): string {
  return `${date}T23:59:59Z`;
}

/** A short text for a value of any type (payloads, brief changes). */
export function shortValue(v: unknown, max = 120): string {
  if (v === null || v === undefined) return "";
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
