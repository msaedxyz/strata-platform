// Write endpoints and the M4 read endpoints (proposals, telemetry, quarantine), typed by hand from docs/api-contract.md.
// The generated client (packages/api-client) does not have them yet. The lead regenerates the client after M4.
// Then these functions can move to the generated client with no change to the modules.
import type { Http } from "./http";
import type { Certainty, EvidenceItem, Iso, QuarantineItem, QuarantineResponse } from "./types";

// ---------- proposals (M4) ----------

export interface ProposedEvent {
  event_type: string;
  stream_type?: string;
  stream_id?: string;
  payload: Record<string, unknown>;
  evidence_ids?: string[];
  certainty?: Certainty | null;
}

/** A row of the proposal table (db/migrations/0001_core.sql) with its evidence items. */
export interface Proposal {
  id: string;
  kind: string;
  status: "pending" | "approved" | "rejected" | "edited_approved" | "auto_approved";
  policy: "automatic" | "review" | "admin_review";
  created_by_type: "agent" | "human" | "system";
  created_by: string;
  model_id: string | null;
  prompt_version: string | null;
  source_id: string | null;
  stream_type: string | null;
  stream_id: string | null;
  title: string;
  summary: string | null;
  events: ProposedEvent[];
  evidence_ids: string[];
  tier: number | null;
  created_at: Iso;
  decided_by?: string | null;
  decided_at?: Iso | null;
  decision_reason?: string | null;
  /** M4 can give the evidence items with the proposal. Without them, the queue calls GET /api/evidence. */
  evidence?: EvidenceItem[];
}

export interface ProposalsResponse {
  items: Proposal[];
}

export const getProposals = (http: Http, status = "pending") => http.get<ProposalsResponse>("/api/proposals", { status });
export const approveProposal = (http: Http, id: string) => http.post<{ status: "approved" }>(`/api/proposals/${encodeURIComponent(id)}/approve`);
export const rejectProposal = (http: Http, id: string, reason: string) =>
  http.post<{ status: "rejected" }>(`/api/proposals/${encodeURIComponent(id)}/reject`, { reason });
export const editApproveProposal = (http: Http, id: string, events: ProposedEvent[]) =>
  http.post<{ status: "edited_approved" }>(`/api/proposals/${encodeURIComponent(id)}/edit-approve`, { events });

// ---------- deals and engagement (M4) ----------

export interface StageMoveResult {
  proposal_id?: string;
  status?: string;
}

export const moveDealStage = (http: Http, dealId: string, toStage: string) =>
  http.post<StageMoveResult>(`/api/deals/${encodeURIComponent(dealId)}/stage`, { to_stage: toStage });

export interface NewContact {
  name: string;
  role: string;
  organisation_id: string | null;
  email?: string;
  phone?: string;
  found_via: string;
}
export const addContact = (http: Http, dealId: string, body: NewContact) => http.post(`/api/deals/${encodeURIComponent(dealId)}/contacts`, body);

export type TouchpointKind = "call" | "meeting" | "email" | "site_visit";
export interface NewTouchpoint {
  kind: TouchpointKind;
  date: string;
  note: string;
  contact_id: string | null;
}
export const logTouchpoint = (http: Http, dealId: string, body: NewTouchpoint) => http.post(`/api/deals/${encodeURIComponent(dealId)}/touchpoints`, body);

export interface NewNextAction {
  action: string;
  owner_user_id: string;
  due_date: string;
}
export const setNextAction = (http: Http, dealId: string, body: NewNextAction) => http.post(`/api/deals/${encodeURIComponent(dealId)}/next-action`, body);

export type PrequalificationStatus = "not_started" | "submitted" | "approved" | "rejected";
export const setPrequalification = (http: Http, dealId: string, body: { buyer_id: string; status: PrequalificationStatus }) =>
  http.post(`/api/deals/${encodeURIComponent(dealId)}/prequalification`, body);

// ---------- alerts (M4) ----------

export const acknowledgeAlert = (http: Http, id: string) => http.post(`/api/alerts/${encodeURIComponent(id)}/acknowledge`);
export const confirmAlert = (http: Http, id: string, reason: string) => http.post(`/api/alerts/${encodeURIComponent(id)}/confirm`, { reason });
export const dismissAlert = (http: Http, id: string, reason: string, falsePositive: boolean) =>
  http.post(`/api/alerts/${encodeURIComponent(id)}/dismiss`, { reason, false_positive: falsePositive });

// ---------- alert telemetry (M4, docs/06 "Alert telemetry") ----------

export interface TelemetryAlert {
  id: string;
  tier: number;
  tier_rule: string;
  title: string;
  status: string;
  published_at: Iso | null;
  fetched_at: Iso | null;
  raised_at: Iso;
  deliveries: Array<{ channel: string; delivered_at: Iso | null }>;
  acknowledged_at: Iso | null;
  acknowledged_by: string | null;
  decided_at: Iso | null;
  outcome: "confirmed" | "dismissed" | "false_positive" | null;
  latency_fetch_to_alert_seconds?: number | null;
  time_to_ack_seconds?: number | null;
}

export interface DurationStats {
  n: number;
  median: number | null;
  p90?: number | null;
  mean?: number | null;
}

export interface TelemetryResponse {
  alerts: TelemetryAlert[];
  metrics: {
    latency_fetch_to_alert_seconds: DurationStats;
    time_to_ack_seconds: DurationStats;
    false_positive_rate_by_rule: Array<{ tier_rule: string; alerts: number; false_positives: number; rate: number | null }>;
  };
}

export const getTelemetry = (http: Http) => http.get<TelemetryResponse>("/api/telemetry/alerts");

// ---------- quarantine (M3) ----------

export const getQuarantine = (http: Http, limit: number) => http.get<QuarantineResponse>("/api/quarantine", { limit });
export const getQuarantineItem = (http: Http, id: string) => http.get<QuarantineItem>(`/api/quarantine/${encodeURIComponent(id)}`);

// ---------- brief versions (M2, admin) ----------

export interface NewBrief {
  yaml: string;
  change_note?: string;
  activate?: boolean;
}
export const createBrief = (http: Http, body: NewBrief) => http.post<{ version: number; created: boolean }>("/api/briefs", body);
export const activateBrief = (http: Http, version: number) => http.post<{ version: number }>(`/api/briefs/${version}/activate`);
