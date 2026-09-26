// A mocked Strata API over a fixture dataset. It answers like services/api/routers/read.py (filters, order, shapes)
// and like the governance endpoints (roles, 403 for the creator, reasons). The response types of the governance,
// engagement, quarantine and priority endpoints come from the generated OpenAPI schema, so the mock gives the real
// shapes (M6). A write changes the dataset and gives the live events that the database trigger would send.
import yaml from "js-yaml";
import type { Alert, Deal, Engagement, PriorityItem, Site } from "../src/api/types";
import type {
  AlertState,
  ApproveResult,
  EditedEvent,
  EngagementResult,
  Proposal,
  ProposalsResponse,
  ProposedEvent,
  QuarantineResponse,
  RejectResult,
  StageMoveResult,
  TelemetryAlert,
  TelemetryResponse,
} from "../src/api/writes";
import { computePriority, type Dataset, priorityConfig, type StoredProposal, type StreamEvent } from "./fixtures/dataset";

export type Role = "viewer" | "analyst" | "approver" | "admin";
const ORDER: Role[] = ["viewer", "analyst", "approver", "admin"];

export interface LiveOut {
  type: string;
  data: { id: string; stream_type: string; stream_id: string; event_type: string };
}

export interface MockResponse {
  status: number;
  json: unknown;
  live?: LiveOut[];
}

const ok = (json: unknown, live?: LiveOut[]): MockResponse => ({ status: 200, json, live });
const err = (status: number, detail: unknown): MockResponse => ({ status, json: { detail } });
const time = (s: string | null | undefined) => (s ? Date.parse(s) : 0);
/** Linear interpolation between the closest ranks, as services/governance/alerts.percentile. */
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = ((s.length - 1) * p) / 100;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, s.length - 1);
  return Math.round((s[lo]! + (s[hi]! - s[lo]!) * (k - lo)) * 1000) / 1000;
};

/** Differences between two brief contents, like services/collectors/brief.py diff (lists matched by id). */
export function briefDiff(a: unknown, b: unknown, path = ""): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const sub = path ? `${path}.${k}` : k;
      if (!(k in a)) out.push({ path: sub, op: "added", to: b[k] });
      else if (!(k in b)) out.push({ path: sub, op: "removed", from: a[k] });
      else out.push(...briefDiff(a[k], b[k], sub));
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const keyed = (xs: unknown[]) => (xs.every((x) => isObj(x) && typeof x.id === "string") ? new Map(xs.map((x) => [(x as { id: string }).id, x])) : null);
    const ka = keyed(a);
    const kb = keyed(b);
    if (ka && kb) {
      for (const id of [...ka.keys(), ...[...kb.keys()].filter((i) => !ka.has(i))]) {
        const sub = `${path}[id=${id}]`;
        if (!kb.has(id)) out.push({ path: sub, op: "removed", from: ka.get(id) });
        else if (!ka.has(id)) out.push({ path: sub, op: "added", to: kb.get(id) });
        else out.push(...briefDiff(ka.get(id), kb.get(id), sub));
      }
      return out;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, op: "changed", from: a, to: b });
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, op: "changed", from: a, to: b });
  return out;
}

export class MockApi {
  private seq = 0;
  /** Paths that fail on purpose, for the error state tests. */
  readonly failures = new Map<string, number>();

  constructor(
    readonly data: Dataset,
    public role: Role,
    public userId: string,
  ) {}

  private can(r: Role) {
    return ORDER.indexOf(this.role) >= ORDER.indexOf(r);
  }

  private newEvent(e: Omit<StreamEvent, "id" | "sequence" | "recorded_at" | "occurred_at" | "supersedes_event_id"> & { recorded_at?: string }): LiveOut {
    this.seq += 1;
    const ev: StreamEvent = {
      id: `evt-live-${Date.now()}-${this.seq}`,
      sequence: this.data.events.filter((x) => x.stream_type === e.stream_type && x.stream_id === e.stream_id).length + 1,
      occurred_at: null,
      supersedes_event_id: null,
      recorded_at: e.recorded_at ?? new Date().toISOString(),
      ...e,
    };
    this.data.events.push(ev);
    return { type: ev.event_type, data: { id: ev.id, stream_type: ev.stream_type, stream_id: ev.stream_id, event_type: ev.event_type } };
  }

  // ---------- reads ----------

  private signalTime = (s: { published_at: string | null; recorded_at: string }) => time(s.published_at ?? s.recorded_at);

  handle(method: string, path: string, q: URLSearchParams, body: unknown): MockResponse {
    const fail = this.failures.get(path);
    if (fail) return err(fail, "fixture failure");
    const all = (k: string) => q.getAll(k).filter((x) => x !== "");
    const d = this.data;
    const m = (re: RegExp) => path.match(re);
    let x: RegExpMatchArray | null;

    if (method === "GET") {
      if (path === "/api/config/stages") return ok(d.stages);
      if (path === "/api/config/taxonomy") return ok(d.taxonomy);
      if (path === "/api/ticker") {
        const limit = Number(q.get("limit") ?? 40);
        const now = Date.now();
        const items = d.signals.filter((s) => s.tier <= 1).sort((a, b) => this.signalTime(b) - this.signalTime(a)).slice(0, limit);
        const counts = [0, 1, 2]
          .map((tier) => {
            const ts = d.signals.filter((s) => s.tier === tier).map(this.signalTime);
            // The fixture clock is FIXTURE_NOW, so the day and week counts use the later of the two clocks.
            const ref = Math.max(now, Date.parse(d.now));
            return { tier, day: ts.filter((t) => t > ref - 86_400_000).length, week: ts.filter((t) => t > ref - 7 * 86_400_000).length, total: ts.length };
          })
          .filter((c) => c.total > 0);
        return ok({ items, counts });
      }
      if (path === "/api/signals") {
        const tiers = all("tier").map(Number);
        const sector = all("sector");
        const geo = all("geography");
        const theme = all("theme");
        const entity = q.get("entity_id");
        const text = (q.get("q") ?? "").toLowerCase();
        const limit = Math.min(Number(q.get("limit") ?? 100), 1000);
        const offset = Number(q.get("offset") ?? 0);
        const hit = d.signals.filter(
          (s) =>
            (!tiers.length || tiers.includes(s.tier)) &&
            (!sector.length || s.sectors.some((c) => sector.includes(c))) &&
            (!geo.length || s.geographies.some((c) => geo.includes(c))) &&
            (!theme.length || s.themes.some((c) => theme.includes(c))) &&
            (!entity || s.entity_ids.includes(entity)) &&
            (!text || s.title.toLowerCase().includes(text)),
        );
        hit.sort((a, b) => this.signalTime(b) - this.signalTime(a) || (a.id < b.id ? 1 : -1));
        return ok({ total: hit.length, items: hit.slice(offset, offset + limit) });
      }
      if (path === "/api/demand-drivers") {
        const items = [...d.drivers].sort((a, b) => time(b.observed_at ?? b.recorded_at) - time(a.observed_at ?? a.recorded_at)).slice(0, Number(q.get("limit") ?? 100));
        return ok({ items });
      }
      if (path === "/api/alerts") {
        const st = all("status");
        const tier = q.get("tier");
        const items = d.alerts
          .filter((a) => (!st.length || st.includes(a.status)) && (tier === null || a.tier === Number(tier)))
          .sort((a, b) => time(b.raised_at) - time(a.raised_at))
          .slice(0, Number(q.get("limit") ?? 100));
        return ok({ items });
      }
      if (path === "/api/sites") {
        const watch = q.get("watch") ?? "all";
        const cls = all("site_class");
        const order = { daily: 0, weekly: 1, none: 2 } as const;
        const items = d.sites
          .filter((s) => (watch === "all" ? s.watch !== "none" : watch === "any" ? true : s.watch === watch) && (!cls.length || cls.includes(s.site_class ?? "")))
          .sort((a, b) => order[a.watch] - order[b.watch] || a.name.localeCompare(b.name));
        return ok({ items });
      }
      if ((x = m(/^\/api\/entities\/([^/]+)$/))) {
        const id = decodeURIComponent(x[1]!);
        const s = d.sites.find((e) => e.id === id);
        if (!s) return err(404, "entity not found");
        const asOf = q.get("as_of");
        const status = asOf ? this.foldStatus(id, asOf) : s.status;
        return ok({
          entity: { ...s, status, type: "site" },
          registry: { geometry_source: null, external_ids: {} },
          facts: Object.entries(s.attributes).map(([k, a]) => ({ event_id: a.event_id, stream_type: "entity", stream_id: id, predicate: k, value: a.value, certainty: a.certainty ?? null, evidence_ids: a.evidence_ids, superseded_by: null, retracted: false, recorded_at: d.now })),
          relationships: d.relationships.filter((r) => r.object_id === id || r.subject_id === id || d.projects.some((p) => p.site_id === id && p.id === r.subject_id)),
          signals: d.signals.filter((g) => g.entity_ids.includes(id)).slice(0, 20),
          as_of: asOf,
        });
      }
      if (path === "/api/map") {
        const cls = all("site_class");
        const stage = all("stage");
        const sector = all("sector");
        const now = Math.max(Date.now(), Date.parse(d.now));
        const sites = d.sites
          .filter((s) => s.lat !== null && s.lon !== null && (!cls.length || cls.includes(s.site_class ?? "")))
          .map((s) => ({
            id: s.id,
            name: s.name,
            site_class: s.site_class,
            watch: s.watch,
            status: s.status,
            status_pending: s.status_pending,
            lat: s.lat,
            lon: s.lon,
            geometry_approximate: s.geometry_approximate,
            last_signal_at: s.last_signal_at,
            signals_90d: d.signals.filter((g) => g.entity_ids.includes(s.id) && this.signalTime(g) > now - 90 * 86_400_000).length,
            identity_evidence_ids: s.identity_evidence_ids,
            status_event_id: s.status_event_id,
            status_evidence_ids: s.status_evidence_ids,
            status_certainty: s.status_certainty,
            geometry_source: s.lat === null ? null : { dataset: "brief v1 geometry (fixture)", approximate: s.geometry_approximate },
          }));
        const deals = d.deals
          .filter((x2) => x2.site_id && (!stage.length || stage.includes(x2.stage)))
          .map((x2) => ({
            id: x2.id,
            title: x2.title,
            stage: x2.stage,
            stage_pending: x2.stage_pending,
            deal_type: x2.deal_type,
            site_id: x2.site_id,
            priority_score: x2.priority_score,
            evidence_ids: x2.evidence_ids,
            stage_event_id: x2.stage_event_id,
            stage_evidence_ids: x2.stage_evidence_ids,
            stage_reason: x2.stage_reason,
          }));
        const projects = d.projects
          .filter((p) => p.site_id && (!sector.length || sector.includes(p.sector ?? "")))
          .map((p) => ({
            id: p.id,
            name: p.name,
            site_id: p.site_id,
            stage: p.stage,
            sector: p.sector,
            in_engagement_window: p.in_engagement_window,
            forecast_start: p.forecast_start,
            forecast_end: p.forecast_end,
            stage_event_id: p.stage_event_id,
            stage_evidence_ids: p.stage_evidence_ids,
            forecast_event_id: p.forecast_detail?.event_id ?? null,
            forecast_evidence_ids: p.forecast_detail?.evidence_ids ?? [],
          }));
        return ok({ sites, deals, projects });
      }
      if (path === "/api/projects") {
        const st = all("stage");
        const items = d.projects.filter((p) => !st.length || st.includes(p.stage ?? "")).sort((a, b) => (a.stage_order ?? -1) - (b.stage_order ?? -1) || a.name.localeCompare(b.name));
        return ok({ items });
      }
      if ((x = m(/^\/api\/projects\/([^/]+)$/))) {
        const p = d.projects.find((e) => e.id === decodeURIComponent(x![1]!));
        if (!p) return err(404, "project not found");
        const history = d.events.filter((e) => e.stream_type === "project" && e.stream_id === p.id && e.event_type === "ProjectStageChanged").map((e) => ({ from: e.payload.from_stage, to: e.payload.to_stage, event_id: e.id, at: e.recorded_at }));
        return ok({ project: { ...p, stage_history: history }, relationships: d.relationships.filter((r) => r.subject_id === p.id), as_of: q.get("as_of") });
      }
      if (path === "/api/calendar") {
        const items = d.projects
          .filter((p) => p.stage)
          .map((p) => ({
            id: p.id,
            name: p.name,
            stage: p.stage,
            stage_order: p.stage_order,
            in_engagement_window: p.in_engagement_window,
            forecast_start: p.forecast_start,
            forecast_end: p.forecast_end,
            forecast_detail: p.forecast_detail,
            site_id: p.site_id,
            site_name: p.site_name,
            stage_event_id: p.stage_event_id,
            stage_evidence_ids: p.stage_evidence_ids,
            stage_certainty: p.stage_certainty,
            demand_estimate: p.demand_estimate,
          }))
          .sort((a, b) => (a.forecast_start ?? "9999").localeCompare(b.forecast_start ?? "9999") || a.name.localeCompare(b.name));
        return ok({ months: Number(q.get("months") ?? 24), items });
      }
      if (path === "/api/deals") {
        const st = all("stage");
        return ok({ items: d.deals.filter((x2) => !st.length || st.includes(x2.stage)).sort((a, b) => time(b.updated_at) - time(a.updated_at)) });
      }
      if ((x = m(/^\/api\/deals\/([^/]+)\/relationship$/))) {
        const deal = d.deals.find((e) => e.id === decodeURIComponent(x![1]!));
        if (!deal) return err(404, "deal not found");
        const subjects = [deal.project_id, deal.site_id].filter(Boolean);
        const eng = d.engagement.filter((e) => e.deal_id === deal.id).sort((a, b) => time(b.recorded_at) - time(a.recorded_at));
        const of = (k: Engagement["kind"]) => eng.filter((e) => e.kind === k);
        return ok({
          deal,
          buyer_roles: d.relationships.filter((r) => subjects.includes(r.subject_id) && r.predicate.startsWith("buyer_role_")),
          contacts: of("contact"),
          touchpoints: of("touchpoint"),
          next_action: of("next_action")[0] ?? null,
          prequalification: of("prequalification"),
        });
      }
      if ((x = m(/^\/api\/deals\/([^/]+)$/))) {
        const deal = d.deals.find((e) => e.id === decodeURIComponent(x![1]!));
        if (!deal) return err(404, "deal not found");
        const asOf = q.get("as_of");
        const history = d.events.filter((e) => e.stream_type === "deal" && e.stream_id === deal.id && e.event_type === "DealStageChanged" && (!asOf || time(e.recorded_at) <= time(asOf)));
        return ok({
          deal: { ...deal, stage: asOf ? this.foldStage(deal.id, asOf) : deal.stage, attributes: {}, stage_history: history.map((e) => ({ from: e.payload.from_stage, to: e.payload.to_stage, event_id: e.id, at: e.recorded_at })), touchpoints: 0 },
          as_of: asOf,
        });
      }
      if (path === "/api/priority") return ok({ items: this.priority(Number(q.get("limit") ?? 100)) });
      if (path === "/api/timeline") {
        const st = q.get("stream_type") ?? "";
        const id = q.get("stream_id") ?? "";
        const asOf = q.get("as_of");
        const items = d.events
          .filter((e) => e.stream_type === st && e.stream_id === id && (!asOf || time(e.recorded_at) <= time(asOf)))
          .sort((a, b) => a.sequence - b.sequence)
          .map(({ stream_type: _s, stream_id: _i, ...rest }) => rest);
        const proposals = d.proposals
          .filter((p) => p.stream_type === st && p.stream_id === id && (!asOf || time(p.created_at) <= time(asOf)))
          .map((p) => ({ id: p.id, title: p.title, status: p.status, created_at: p.created_at, decided_at: p.decided_at ?? null, decided_by: p.decided_by ?? null }));
        let state: Record<string, unknown> | null = null;
        if (st === "deal") state = { id, stage: asOf ? this.foldStage(id, asOf) : d.deals.find((x2) => x2.id === id)?.stage };
        else if (st === "project") state = { id, stage: this.foldProjectStage(id, asOf) };
        else if (st === "entity") state = { id, status: asOf ? this.foldStatus(id, asOf) : d.sites.find((s) => s.id === id)?.status };
        return ok({ items, proposals, state, as_of: asOf });
      }
      if (path === "/api/evidence") {
        const ids = all("ids");
        return ok({ items: ids.map((i) => d.evidence[i]).filter(Boolean) });
      }
      if (path === "/api/sources/health") return ok({ brief_version: d.briefVersion, brief_version_id: `brief-v${d.briefVersion}`, sources: d.sources, known_gaps: d.knownGaps });
      if (path === "/api/sources/known-gaps") return ok({ brief_version: d.briefVersion, known_gaps: d.knownGaps });
      if (path === "/api/briefs") {
        const active = d.briefs.find((b) => b.active);
        return ok({ active_version: active?.version ?? null, versions: [...d.briefs].sort((a, b) => b.version - a.version).map(({ content: _c, yaml: _y, ...rest }) => rest) });
      }
      if (path === "/api/briefs/diff") {
        const a = d.briefs.find((b) => b.version === Number(q.get("from")));
        const b = d.briefs.find((v) => v.version === Number(q.get("to")));
        if (!a || !b) return err(404, "brief version not found");
        return ok({ from: a.version, to: b.version, changes: briefDiff(yaml.load(a.yaml), yaml.load(b.yaml)) });
      }
      if ((x = m(/^\/api\/briefs\/(\d+)$/))) {
        const b = d.briefs.find((v) => v.version === Number(x![1]));
        return b ? ok(b) : err(404, "brief version not found");
      }
      if (path === "/api/quarantine") {
        // The list gives no agent output. GET /api/quarantine/{id} gives it (services/api/routers/quarantine.py).
        const items = [...d.quarantine].sort((a, b) => time(b.created_at) - time(a.created_at));
        const body: QuarantineResponse = { items: items.slice(0, Number(q.get("limit") ?? 100)).map((x2) => ({ ...x2, output: null })), total: items.length, reason_codes: d.reasonCodes };
        return ok(body);
      }
      if ((x = m(/^\/api\/quarantine\/([^/]+)$/))) {
        const item = d.quarantine.find((e) => e.id === x![1]);
        return item ? ok(item) : err(404, "quarantine item not found");
      }
      if (path === "/api/proposals") {
        const st = q.get("status");
        const kind = q.get("kind");
        const hit = d.proposals.filter((p) => (!st || p.status === st) && (!kind || p.kind === kind)).sort((a, b) => time(b.created_at) - time(a.created_at) || (a.id < b.id ? 1 : -1));
        const body: ProposalsResponse = { total: hit.length, items: hit.map((p) => this.proposalView(p)) };
        return ok(body);
      }
      if (path === "/api/telemetry/alerts") return ok(this.telemetry());
    }

    if (method === "POST") return this.write(path, (body ?? {}) as Record<string, unknown>);
    return err(404, "not mocked");
  }

  // ---------- folds for "as of" ----------

  foldStage(dealId: string, asOf: string): string | undefined {
    const evs = this.data.events.filter((e) => e.stream_type === "deal" && e.stream_id === dealId && time(e.recorded_at) <= time(asOf)).sort((a, b) => a.sequence - b.sequence);
    let stage: string | undefined;
    for (const e of evs) {
      if (e.event_type === "DealIdentified") stage = String(e.payload.stage ?? "signal");
      if (e.event_type === "DealStageChanged") stage = String(e.payload.to_stage);
    }
    return stage;
  }

  private foldProjectStage(id: string, asOf: string | null): string | undefined {
    const evs = this.data.events.filter((e) => e.stream_type === "project" && e.stream_id === id && e.event_type === "ProjectStageChanged" && (!asOf || time(e.recorded_at) <= time(asOf)));
    return evs.length ? String(evs[evs.length - 1]!.payload.to_stage) : undefined;
  }

  private foldStatus(id: string, asOf: string): string | null {
    const evs = this.data.events.filter((e) => e.stream_type === "entity" && e.stream_id === id && e.event_type === "SiteStatusChanged" && time(e.recorded_at) <= time(asOf));
    return evs.length ? String(evs[evs.length - 1]!.payload.to_status) : (this.data.sites.find((s) => s.id === id)?.status ?? null);
  }

  // ---------- telemetry (docs/06), as services/governance/alerts.telemetry ----------

  telemetry(): TelemetryResponse {
    const secs = (later: string | null, earlier: string | null) => (later && earlier ? Math.round(time(later) - time(earlier)) / 1000 : null);
    const items: TelemetryAlert[] = [...this.data.alerts]
      .sort((a, b) => time(b.raised_at) - time(a.raised_at))
      .map((a) => {
        const del = this.data.deliveries[a.id] ?? { delivered: { frontend: null, frontend_broadcast: null, email: null }, delivery_status: { frontend: null, email: null } };
        return {
          id: a.id,
          tier: a.tier,
          tier_rule: a.tier_rule,
          title: a.title,
          status: a.status,
          outcome: a.status === "unconfirmed" ? null : a.status,
          source_id: a.source_id,
          signal_id: a.signal_id,
          published_at: a.published_at,
          fetched_at: a.fetched_at,
          raised_at: a.raised_at,
          delivered: del.delivered,
          delivery_status: del.delivery_status,
          acknowledged_at: a.acknowledged_at,
          acknowledged_by: a.acknowledged_by,
          decided_at: a.decided_at,
          decided_by: a.decided_by,
          decision_reason: a.decision_reason,
          latency_fetch_to_alert_seconds: secs(a.raised_at, a.fetched_at),
          latency_publish_to_alert_seconds: secs(a.raised_at, a.published_at),
          time_to_acknowledgement_seconds: secs(a.acknowledged_at, a.raised_at),
        };
      });
    const lat = items.map((a) => a.latency_fetch_to_alert_seconds).filter((v): v is number => v !== null);
    const ack = items.map((a) => a.time_to_acknowledgement_seconds).filter((v): v is number => v !== null);
    const stats = (xs: number[]) => ({ n: xs.length, median: percentile(xs, 50), p90: percentile(xs, 90) });
    const rules = new Map<string, { tier_rule: string; tier: number; alerts: number; decided: number; confirmed: number; dismissed: number; false_positive: number; false_positive_rate: number | null }>();
    for (const a of items) {
      const r = rules.get(a.tier_rule) ?? { tier_rule: a.tier_rule, tier: a.tier, alerts: 0, decided: 0, confirmed: 0, dismissed: 0, false_positive: 0, false_positive_rate: null };
      r.alerts += 1;
      if (a.outcome) {
        r.decided += 1;
        r[a.outcome] += 1;
      }
      rules.set(a.tier_rule, r);
    }
    for (const r of rules.values()) r.false_positive_rate = r.decided ? Math.round((r.false_positive / r.decided) * 10_000) / 10_000 : null;
    return {
      items,
      metrics: {
        latency_fetch_to_alert_seconds: stats(lat),
        time_to_acknowledgement_seconds: stats(ack),
        false_positive_rate_by_tier_rule: [...rules.values()].sort((a, b) => a.tier - b.tier || a.tier_rule.localeCompare(b.tier_rule)),
      },
    };
  }

  // ---------- priority list (services/projections/priority.py and GET /api/priority) ----------

  /** Recalculate the priority of a deal after a write, as the projector hook does. */
  reprioritise(deal: Deal, asOf = new Date().toISOString().slice(0, 10)) {
    const project = deal.project_id ? (this.data.projects.find((p) => p.id === deal.project_id) ?? null) : null;
    const first = this.data.events.find((e) => e.stream_type === "deal" && e.stream_id === deal.id && e.event_type === "DealIdentified");
    Object.assign(
      deal,
      computePriority({ deal, project, relationships: this.data.relationships, engagement: this.data.engagement, stageCodes: this.data.stages.deal_stages.map((s) => s.code), dealEventId: first?.id ?? "", asOf, cfg: priorityConfig() }),
    );
  }

  /** The ranked list: by group, then the "no contact found" rule, then the score, as the SQL of GET /api/priority. */
  priority(limit: number): PriorityItem[] {
    const terminal = new Set(this.data.stages.deal_stages.filter((s) => s.terminal).map((s) => s.code));
    const rows = this.data.deals
      .filter((x) => !terminal.has(x.stage))
      .map((x) => ({
        deal: x,
        groupOrder: x.priority_breakdown?.group.order ?? 999,
        rule: x.priority_breakdown?.no_contact_boost.applied ?? false,
      }))
      .sort((a, b) => a.groupOrder - b.groupOrder || Number(b.rule) - Number(a.rule) || (b.deal.priority_score ?? -1) - (a.deal.priority_score ?? -1) || time(b.deal.updated_at) - time(a.deal.updated_at) || a.deal.id.localeCompare(b.deal.id));
    const inGroup = new Map<number, number>();
    return rows.slice(0, limit).map(({ deal: x, groupOrder, rule }, i) => {
      const groupRank = (inGroup.get(groupOrder) ?? 0) + 1;
      inGroup.set(groupOrder, groupRank);
      return {
        id: x.id,
        title: x.title,
        deal_type: x.deal_type,
        stage: x.stage,
        stage_pending: x.stage_pending,
        site_id: x.site_id,
        site_name: x.site_name ?? null,
        project_id: x.project_id,
        project_name: this.data.projects.find((p) => p.id === x.project_id)?.name ?? null,
        lead_time_days: x.lead_time_days,
        demand_litres_month: x.demand_litres_month,
        confidence: x.confidence,
        buyer_fit: x.buyer_fit,
        has_contact: x.has_contact,
        priority_score: x.priority_score,
        priority_breakdown: x.priority_breakdown,
        evidence_ids: x.evidence_ids,
        stage_event_id: x.stage_event_id,
        stage_evidence_ids: x.stage_evidence_ids,
        priority_group: x.priority_breakdown?.group.id ?? null,
        group_order: groupOrder,
        group_rank: groupRank,
        rank: i + 1,
        no_contact_rule: rule,
      };
    });
  }

  // ---------- approval queue ----------

  proposalView(p: StoredProposal): Proposal {
    return { ...p, created_by_me: p.created_by === this.userId };
  }

  private proposalEvidence(ids: string[]) {
    return ids
      .map((id) => this.data.evidence[id])
      .filter((e): e is NonNullable<typeof e> => !!e)
      .map((e) => ({ id: e.id, source_id: e.source_id, char_start: e.char_start, char_end: e.char_end, quote: e.quote, verified: e.verified, url: e.url, title: e.title, publisher: e.publisher, published_at: e.published_at, retention_policy: e.retention_policy }));
  }

  // ---------- writes (M4 contract) ----------

  private write(path: string, body: Record<string, unknown>): MockResponse {
    const d = this.data;
    let x: RegExpMatchArray | null;
    const need = (r: Role) => (this.can(r) ? null : err(403, `the role ${this.role} cannot do this`));

    if ((x = path.match(/^\/api\/proposals\/([^/]+)\/(approve|reject|edit-approve)$/))) {
      const denied = need("approver");
      if (denied) return denied;
      const p = d.proposals.find((e) => e.id === x![1]);
      if (!p) return err(404, "proposal not found");
      if (p.status !== "pending") return err(409, "the proposal is decided");
      const action = x[2]!;
      if (action !== "reject" && p.created_by === this.userId) return err(403, "you cannot approve a proposal that you created");
      if (action === "reject") {
        const reason = String(body.reason ?? "").trim();
        if (!reason) return err(422, "a reason is required");
        Object.assign(p, { status: "rejected", decision_reason: reason, decided_by: this.userId, decided_at: new Date().toISOString() } satisfies Partial<StoredProposal>);
        this.clearPending(p);
        const live = this.newEvent({ stream_type: "proposal", stream_id: p.id, event_type: "ProposalRejected", payload: { proposal_id: p.id, reason }, evidence_ids: [], certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: p.id });
        const result: RejectResult = { status: "rejected", proposal_id: p.id };
        return ok(result, [live]);
      }
      let events: ProposedEvent[] = p.events;
      if (action === "edit-approve") {
        // Edit and approve: one entry for each proposed event, with a new payload and certainty. The stream, the type
        // and the evidence of each event stay (services/governance/proposals.edit_and_approve).
        const edits = (body.events as EditedEvent[] | undefined) ?? [];
        if (edits.length !== p.events.length) return err(422, "edited_events must have one entry for each proposed event");
        events = p.events.map((e, i) => ({ ...e, payload: edits[i]!.payload ?? e.payload, certainty: edits[i]!.certainty ?? e.certainty }));
      }
      p.status = action === "edit-approve" ? "edited_approved" : "approved";
      p.decided_by = this.userId;
      p.decided_at = new Date().toISOString();
      this.clearPending(p);
      const live = events.map((e) => this.apply(e, p));
      live.push(this.newEvent({ stream_type: "proposal", stream_id: p.id, event_type: action === "edit-approve" ? "ProposalEditedApproved" : "ProposalApproved", payload: { proposal_id: p.id }, evidence_ids: [], certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: p.id }));
      const result: ApproveResult = { status: p.status === "edited_approved" ? "edited_approved" : "approved", proposal_id: p.id, event_ids: live.slice(0, -1).map((l) => l.data.id) };
      return ok(result, live);
    }

    if ((x = path.match(/^\/api\/deals\/([^/]+)\/(stage|contacts|touchpoints|next-action|prequalification)$/))) {
      const denied = need("analyst");
      if (denied) return denied;
      const deal = d.deals.find((e) => e.id === decodeURIComponent(x![1]!));
      if (!deal) return err(404, "deal not found");
      const kind = x[2]!;
      if (kind === "stage") {
        const to = String(body.to_stage ?? "");
        if (!d.stages.deal_stages.some((s) => s.code === to)) return err(422, "unknown stage");
        if (to === deal.stage) return err(422, `the deal is already at stage ${to}`);
        if (deal.stage_pending) return err(409, `the deal has a pending stage change to ${deal.stage_pending}`);
        const id = `prop-live-${Date.now()}`;
        const name = (c: string) => d.stages.deal_stages.find((s) => s.code === c)?.name ?? c;
        // A stage move by the team: a human event with a reason and no source evidence (services/governance/engagement.py).
        const reason = String(body.reason ?? "").trim() || `Moved from ${name(deal.stage)} to ${name(to)} by an analyst`;
        const proposal: StoredProposal = {
          id,
          kind: "DealStageChanged",
          status: "pending",
          policy: "review",
          created_by_type: "human",
          created_by: this.userId,
          model_id: null,
          prompt_version: null,
          source_id: null,
          stream_type: "deal",
          stream_id: deal.id,
          title: `${deal.title}: ${name(to)}`,
          summary: null,
          events: [{ event_type: "DealStageChanged", stream_type: "deal", stream_id: deal.id, payload: { from_stage: deal.stage, to_stage: to, reason }, evidence_ids: [], certainty: null, evidence: [] }],
          evidence: this.proposalEvidence([]),
          tier: null,
          created_at: new Date().toISOString(),
          decided_by: null,
          decided_at: null,
          decision_reason: null,
        };
        d.proposals.push(proposal);
        deal.stage_pending = to;
        deal.pending_proposal_id = id;
        const live = this.newEvent({ stream_type: "proposal", stream_id: id, event_type: "ProposalCreated", payload: { proposal_id: id, kind: "DealStageChanged", policy: "review" }, evidence_ids: [], certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: id });
        const result: StageMoveResult = { status: "pending", proposal_id: id, deal_id: deal.id, stage: deal.stage, stage_pending: to };
        return ok(result, [live]);
      }
      const now = new Date().toISOString();
      const add = (k: Engagement["kind"], data: Record<string, unknown>, eventType: string, contactId?: string) => {
        const proposalId = `prop-eng-${Date.now()}-${this.seq}`;
        const live = this.newEvent({ stream_type: "deal", stream_id: deal.id, event_type: eventType, payload: data, evidence_ids: [], certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: proposalId });
        d.engagement.push({ event_id: live.data.id, deal_id: deal.id, kind: k, actor_id: this.userId, data, recorded_at: now });
        deal.updated_at = now;
        this.reprioritise(deal);
        const result: EngagementResult = { status: "recorded", proposal_id: proposalId, event_type: eventType, event_id: live.data.id, deal_id: deal.id, ...(contactId ? { contact_id: contactId } : {}) };
        return ok(result, [live]);
      };
      if (kind === "contacts") {
        if (!body.role || !body.found_via) return err(422, "role and found_via are required");
        if (!body.name && !body.person_id) return err(422, "a new contact needs a name");
        deal.has_contact = true;
        const contactId = String(body.person_id ?? `person-live-${Date.now()}`);
        // The relationship endpoint gives the decrypted personal fields in data (services/api/routers/read.py).
        return add(
          "contact",
          { contact_id: contactId, role: body.role, organisation_id: body.organisation_id ?? null, found_via: body.found_via, name: body.name ?? null, email: body.email ?? null, phone: body.phone ?? null, erased: false },
          "ContactAdded",
          contactId,
        );
      }
      if (kind === "touchpoints") {
        if (!body.kind || !body.date || !body.note) return err(422, "kind, date and note are required");
        return add("touchpoint", { kind: body.kind, date: body.date, note: body.note, contact_id: body.contact_id ?? null }, "TouchpointLogged");
      }
      if (kind === "next-action") {
        if (!body.action || !body.owner_user_id || !body.due_date) return err(422, "action, owner_user_id and due_date are required");
        deal.next_action = { action: String(body.action), owner_user_id: String(body.owner_user_id), due_date: String(body.due_date) };
        return add("next_action", { action: body.action, owner_user_id: body.owner_user_id, due_date: body.due_date }, "NextActionSet");
      }
      if (!body.buyer_id || !body.status) return err(422, "buyer_id and status are required");
      deal.prequalification_status = String(body.status);
      return add("prequalification", { buyer_id: body.buyer_id, status: body.status }, "PrequalificationStatusChanged");
    }

    if ((x = path.match(/^\/api\/alerts\/([^/]+)\/(acknowledge|confirm|dismiss)$/))) {
      const action = x[2]!;
      const denied = need(action === "acknowledge" ? "analyst" : "approver");
      if (denied) return denied;
      const a = d.alerts.find((e) => e.id === x![1]);
      if (!a) return err(404, "alert not found");
      const now = new Date().toISOString();
      let type = "AlertAcknowledged";
      if (action === "acknowledge") {
        if (a.acknowledged_at) type = "";
        a.acknowledged_at ??= now;
        a.acknowledged_by ??= this.userId;
      } else if (a.status !== "unconfirmed") {
        return err(409, `alert ${a.id} is ${a.status}`);
      } else if (action === "confirm") {
        Object.assign(a, { status: "confirmed", decided_at: now, decided_by: this.userId, decision_reason: (body.reason as string) || null } satisfies Partial<Alert>);
        type = "AlertConfirmed";
      } else {
        if (!String(body.reason ?? "").trim()) return err(422, "a dismissal needs a reason");
        Object.assign(a, { status: body.false_positive ? "false_positive" : "dismissed", decided_at: now, decided_by: this.userId, decision_reason: (body.reason as string) || null } satisfies Partial<Alert>);
        type = "AlertDismissed";
      }
      a.updated_at = now;
      const state: AlertState = {
        id: a.id,
        tier: a.tier,
        tier_rule: a.tier_rule,
        title: a.title,
        status: a.status,
        acknowledged_at: a.acknowledged_at,
        acknowledged_by: a.acknowledged_by,
        decided_at: a.decided_at,
        decided_by: a.decided_by,
        decision_reason: a.decision_reason,
      };
      // A second acknowledgement writes nothing (services/governance/alerts.acknowledge).
      if (!type) return ok(state, []);
      const live = this.newEvent({ stream_type: "alert", stream_id: a.id, event_type: type, payload: body, evidence_ids: type === "AlertAcknowledged" ? [] : a.evidence_ids, certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: null });
      return ok(state, [live]);
    }

    if (path === "/api/briefs") {
      const denied = need("admin");
      if (denied) return denied;
      const text = String(body.yaml ?? "");
      try {
        const parsed = yaml.load(text) as Record<string, unknown> | null;
        if (!parsed || typeof parsed !== "object" || !parsed.sources) return err(422, { errors: ["sources: the brief needs a sources section"] });
      } catch (e) {
        return err(422, { errors: [`yaml: ${(e as Error).message.split("\n")[0]}`] });
      }
      const version = Math.max(...d.briefs.map((b) => b.version)) + 1;
      const row = { id: `brief-v${version}`, version, name: `Version ${version}`, created_by: this.userId, created_at: new Date().toISOString(), parent_version_id: null, change_note: (body.change_note as string) ?? null, content_hash: `hash-v${version}`, active: false, content: {}, yaml: text };
      d.briefs.push(row);
      const live: LiveOut[] = [];
      if (body.activate) live.push(this.activate(version));
      return ok({ ...row, created: true }, live);
    }
    if ((x = path.match(/^\/api\/briefs\/(\d+)\/activate$/))) {
      const denied = need("admin");
      if (denied) return denied;
      if (!d.briefs.some((b) => b.version === Number(x![1]))) return err(404, "brief version not found");
      return ok({ version: Number(x[1]) }, [this.activate(Number(x[1]))]);
    }
    return err(404, "not mocked");
  }

  private activate(version: number): LiveOut {
    for (const b of this.data.briefs) b.active = b.version === version;
    this.data.briefVersion = version;
    return this.newEvent({ stream_type: "brief", stream_id: "brief", event_type: "BriefVersionActivated", payload: { brief_version_id: `brief-v${version}`, version }, evidence_ids: [], certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: null });
  }

  private clearPending(p: StoredProposal) {
    if (p.kind === "DealStageChanged") {
      const deal = this.data.deals.find((x) => x.id === p.stream_id);
      if (deal && deal.pending_proposal_id === p.id) Object.assign(deal, { stage_pending: null, pending_proposal_id: null } satisfies Partial<Deal>);
    }
    if (p.kind === "SiteStatusChanged") {
      const site = this.data.sites.find((x) => x.id === p.stream_id);
      if (site) site.status_pending = null;
    }
  }

  /** Apply an approved event to the read models and the event store of the fixture. */
  private apply(e: ProposedEvent, p: StoredProposal): LiveOut {
    const st = e.stream_type ?? p.stream_type ?? "entity";
    const sid = e.stream_id ?? p.stream_id ?? "";
    // The actor of an approved event is the author of the proposal (services/governance/proposals.approve).
    const live = this.newEvent({ stream_type: st, stream_id: sid, event_type: e.event_type, payload: e.payload, evidence_ids: e.evidence_ids, certainty: e.certainty ?? null, actor_type: p.created_by_type, actor_id: p.created_by, proposal_id: p.id });
    if (e.event_type === "DealStageChanged") {
      const deal = this.data.deals.find((x) => x.id === sid);
      if (deal) {
        Object.assign(deal, {
          stage: String(e.payload.to_stage),
          updated_at: new Date().toISOString(),
          stage_event_id: live.data.id,
          stage_evidence_ids: e.evidence_ids,
          stage_reason: typeof e.payload.reason === "string" ? e.payload.reason : null,
          stage_actor_type: p.created_by_type,
        } satisfies Partial<Deal>);
        this.reprioritise(deal);
      }
    }
    if (e.event_type === "SiteStatusChanged") {
      const site = this.data.sites.find((x) => x.id === sid);
      if (site) Object.assign(site, { status: String(e.payload.to_status), status_event_id: live.data.id, status_evidence_ids: e.evidence_ids, status_certainty: e.certainty ?? null } satisfies Partial<Site>);
    }
    return live;
  }
}
