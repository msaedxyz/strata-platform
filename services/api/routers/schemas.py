"""Response models of the governance, engagement and priority endpoints (M6).

The typed client (packages/api-client) comes from the OpenAPI schema. These models give the frontend the real
response shapes, so the frontend and its mocks do not type them by hand. Each model allows extra fields, so a new
field in a router never breaks a response (add fields only).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


def _closed_schema(schema: dict[str, Any]) -> None:
    # The response keeps extra fields at run time, but the schema lists the known fields only, so the generated
    # TypeScript types stay exact (no index signature).
    schema.pop("additionalProperties", None)


class _Open(BaseModel):
    model_config = ConfigDict(extra="allow", json_schema_extra=_closed_schema)


# ---------- approval queue ----------


class ProposalEvidence(_Open):
    """An evidence item of a proposal: the quote, the span offsets and the source link."""

    id: str
    source_id: str
    char_start: int
    char_end: int
    quote: str
    verified: bool
    url: str | None = None
    title: str | None = None
    publisher: str | None = None
    published_at: str | None = None
    retention_policy: str | None = None


class ProposedEvent(_Open):
    stream_type: str
    stream_id: str
    event_type: str
    payload: dict[str, Any]
    # A SourceProposed event (a new source for the brief, docs/04) has no evidence ids.
    evidence_ids: list[str] = []
    certainty: Literal["stated", "reported", "speculative"] | None = None
    occurred_at: str | None = None
    evidence: list[ProposalEvidence] = []


class Proposal(_Open):
    id: str
    kind: str
    status: Literal["pending", "approved", "rejected", "edited_approved", "auto_approved"]
    policy: Literal["automatic", "review", "admin_review"]
    title: str
    summary: str | None
    tier: int | None
    created_by_type: Literal["agent", "human", "system"]
    created_by: str
    created_by_me: bool
    model_id: str | None
    prompt_version: str | None
    source_id: str | None
    stream_type: str | None
    stream_id: str | None
    created_at: str
    decided_by: str | None
    decided_at: str | None
    decision_reason: str | None
    events: list[ProposedEvent]
    evidence: list[ProposalEvidence]


class ProposalList(_Open):
    total: int
    items: list[Proposal]


class ApproveResult(_Open):
    status: Literal["approved", "edited_approved"]
    proposal_id: str
    event_ids: list[str]


class RejectResult(_Open):
    status: Literal["rejected"]
    proposal_id: str


# ---------- alerts and telemetry ----------


class AlertState(_Open):
    """The alert after an acknowledgement or a decision."""

    id: str
    tier: int
    tier_rule: str
    title: str
    status: Literal["unconfirmed", "confirmed", "dismissed", "false_positive"]
    acknowledged_at: str | None
    acknowledged_by: str | None
    decided_at: str | None
    decided_by: str | None
    decision_reason: str | None


class DeliveryTimes(_Open):
    frontend: str | None
    frontend_broadcast: str | None
    email: str | None


class DeliveryStatus(_Open):
    frontend: str | None
    email: str | None


class TelemetryAlert(_Open):
    id: str
    tier: int
    tier_rule: str
    title: str
    status: Literal["unconfirmed", "confirmed", "dismissed", "false_positive"]
    outcome: Literal["confirmed", "dismissed", "false_positive"] | None
    source_id: str | None
    signal_id: str | None
    published_at: str | None
    fetched_at: str | None
    raised_at: str
    delivered: DeliveryTimes
    delivery_status: DeliveryStatus
    acknowledged_at: str | None
    acknowledged_by: str | None
    decided_at: str | None
    decided_by: str | None
    decision_reason: str | None
    latency_fetch_to_alert_seconds: float | None
    latency_publish_to_alert_seconds: float | None
    time_to_acknowledgement_seconds: float | None


class DurationStats(_Open):
    n: int
    median: float | None
    p90: float | None


class RuleRate(_Open):
    tier_rule: str
    tier: int
    alerts: int
    decided: int
    confirmed: int
    dismissed: int
    false_positive: int
    false_positive_rate: float | None


class TelemetryMetrics(_Open):
    latency_fetch_to_alert_seconds: DurationStats
    time_to_acknowledgement_seconds: DurationStats
    false_positive_rate_by_tier_rule: list[RuleRate]


class Telemetry(_Open):
    items: list[TelemetryAlert]
    metrics: TelemetryMetrics


# ---------- deals and engagement ----------


class StageMoveResult(_Open):
    status: Literal["pending", "approved"]
    proposal_id: str
    deal_id: str
    stage: str
    stage_pending: str | None


class EngagementResult(_Open):
    status: str
    proposal_id: str
    event_type: str
    event_id: str | None
    deal_id: str
    contact_id: str | None = None


# ---------- priority list ----------


class PriorityPart(_Open):
    """One part of the score: the value, the score (0 to 1), the weight, the contribution (score x weight), and the
    event ids and the evidence ids that it uses (docs/07 rule 1)."""

    value: Any = None
    score: float
    weight: float
    contribution: float
    event_ids: list[str]
    evidence_ids: list[str]


class NoContactRule(_Open):
    """docs/05 scorer rule 6: a project in the engagement window with no contact found."""

    value: bool
    applied: bool
    in_engagement_window: bool
    contact_found: bool
    contact_found_by: Literal["stage", "engagement"] | None
    project_stage: str | None
    contribution: float
    weight: None = None
    event_ids: list[str]
    evidence_ids: list[str]


class PriorityGroup(_Open):
    id: str
    name: str
    order: int


class PriorityBreakdown(_Open):
    version: str | None
    as_of: str
    parts: list[str]
    lead_time: PriorityPart
    demand: PriorityPart
    confidence: PriorityPart
    buyer_fit: PriorityPart
    no_contact_boost: NoContactRule
    weighted_score: float
    total: float
    group: PriorityGroup
    project_id: str | None


class PriorityItem(_Open):
    id: str
    title: str
    deal_type: str | None
    stage: str
    stage_pending: str | None
    site_id: str | None
    site_name: str | None
    project_id: str | None
    project_name: str | None
    lead_time_days: int | None
    demand_litres_month: float | None
    confidence: float | None
    buyer_fit: float | None
    has_contact: bool
    priority_score: float | None
    priority_breakdown: PriorityBreakdown | None
    evidence_ids: list[str]
    stage_event_id: str | None
    stage_evidence_ids: list[str]
    priority_group: str | None
    group_order: int
    group_rank: int
    rank: int
    no_contact_rule: bool


class PriorityList(_Open):
    items: list[PriorityItem]
