// Write endpoints and the M4 read endpoints (proposals, telemetry, quarantine). The request bodies and the response
// shapes come from the generated OpenAPI schema (packages/api-client, services/api/routers/schemas.py). Regenerate the
// client with `pnpm api-client` after a change to the API. Only the brief results (sources router) have no schema.
import type { components } from "@strata/api-client";
import type { Http } from "./http";

type S = components["schemas"];

// ---------- proposals (M4) ----------

/** A proposed event with its evidence items (GET /api/proposals). */
export type ProposedEvent = S["ProposedEvent"];
/** A proposal of the approval queue: the proposal row, its events, its evidence and created_by_me. */
export type Proposal = S["Proposal"];
export type ProposalEvidence = S["ProposalEvidence"];
export type ProposalsResponse = S["ProposalList"];
export type ApproveResult = S["ApproveResult"];
export type RejectResult = S["RejectResult"];
/** One entry of the edit and approve body: a new payload and certainty for each proposed event, in order. */
export type EditedEvent = S["EditedEvent"];

export const getProposals = (http: Http, status = "pending") => http.get<ProposalsResponse>("/api/proposals", { status });
export const approveProposal = (http: Http, id: string) => http.post<ApproveResult>(`/api/proposals/${encodeURIComponent(id)}/approve`);
export const rejectProposal = (http: Http, id: string, reason: string) =>
  http.post<RejectResult>(`/api/proposals/${encodeURIComponent(id)}/reject`, { reason } satisfies S["Rejection"]);
export const editApproveProposal = (http: Http, id: string, events: EditedEvent[]) =>
  http.post<ApproveResult>(`/api/proposals/${encodeURIComponent(id)}/edit-approve`, { events } satisfies S["EditApprove"]);

// ---------- deals and engagement (M4) ----------

export type StageMoveResult = S["StageMoveResult"];
export type EngagementResult = S["EngagementResult"];
export type NewContact = S["Contact"];
export type NewTouchpoint = S["Touchpoint"];
export type TouchpointKind = NewTouchpoint["kind"];
export type NewNextAction = S["NextAction"];
export type NewPrequalification = S["Prequalification"];
export type PrequalificationStatus = NewPrequalification["status"];

export const moveDealStage = (http: Http, dealId: string, toStage: string) =>
  http.post<StageMoveResult>(`/api/deals/${encodeURIComponent(dealId)}/stage`, { to_stage: toStage } satisfies S["StageMove"]);
export const addContact = (http: Http, dealId: string, body: NewContact) => http.post<EngagementResult>(`/api/deals/${encodeURIComponent(dealId)}/contacts`, body);
export const logTouchpoint = (http: Http, dealId: string, body: NewTouchpoint) => http.post<EngagementResult>(`/api/deals/${encodeURIComponent(dealId)}/touchpoints`, body);
export const setNextAction = (http: Http, dealId: string, body: NewNextAction) => http.post<EngagementResult>(`/api/deals/${encodeURIComponent(dealId)}/next-action`, body);
export const setPrequalification = (http: Http, dealId: string, body: NewPrequalification) =>
  http.post<EngagementResult>(`/api/deals/${encodeURIComponent(dealId)}/prequalification`, body);

// ---------- alerts (M4) ----------

/** The alert after an acknowledgement or a decision. */
export type AlertState = S["AlertState"];

export const acknowledgeAlert = (http: Http, id: string) => http.post<AlertState>(`/api/alerts/${encodeURIComponent(id)}/acknowledge`);
export const confirmAlert = (http: Http, id: string, reason: string) =>
  http.post<AlertState>(`/api/alerts/${encodeURIComponent(id)}/confirm`, { reason } satisfies S["AlertConfirm"]);
export const dismissAlert = (http: Http, id: string, reason: string, falsePositive: boolean) =>
  http.post<AlertState>(`/api/alerts/${encodeURIComponent(id)}/dismiss`, { reason, false_positive: falsePositive } satisfies S["AlertDismiss"]);

// ---------- alert telemetry (M4, docs/06 "Alert telemetry") ----------

export type TelemetryAlert = S["TelemetryAlert"];
export type TelemetryResponse = S["Telemetry"];
export type DurationStats = S["DurationStats"];
export type RuleRate = S["RuleRate"];

export const getTelemetry = (http: Http) => http.get<TelemetryResponse>("/api/telemetry/alerts");

// ---------- quarantine (M3) ----------

export type QuarantineItem = S["QuarantineRecord"];
export type QuarantineResponse = S["QuarantineList"];

export const getQuarantine = (http: Http, limit: number) => http.get<QuarantineResponse>("/api/quarantine", { limit });
export const getQuarantineItem = (http: Http, id: string) => http.get<QuarantineItem>(`/api/quarantine/${encodeURIComponent(id)}`);

// ---------- brief versions (M2, admin) ----------

export type NewBrief = S["NewBrief"];
export const createBrief = (http: Http, body: NewBrief) => http.post<{ version: number; created: boolean }>("/api/briefs", body);
export const activateBrief = (http: Http, version: number) => http.post<{ version: number }>(`/api/briefs/${version}/activate`);
