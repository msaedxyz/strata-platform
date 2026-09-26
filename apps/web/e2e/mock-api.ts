// A mocked Strata API over a fixture dataset. It answers like services/api/routers/read.py (filters, order, shapes)
// and like the M4 write endpoints in docs/api-contract.md (roles, 403 for the creator, reasons). A write changes the
// dataset and gives the live events that the database trigger would send (event_notify).
import yaml from "js-yaml";
import type { Alert, Deal, Engagement, Site } from "../src/api/types";
import type { Proposal, ProposedEvent, TelemetryAlert } from "../src/api/writes";
import type { Dataset, StreamEvent } from "./fixtures/dataset";

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
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
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
          }));
        const deals = d.deals
          .filter((x2) => x2.site_id && (!stage.length || stage.includes(x2.stage)))
          .map((x2) => ({ id: x2.id, title: x2.title, stage: x2.stage, stage_pending: x2.stage_pending, deal_type: x2.deal_type, site_id: x2.site_id, priority_score: x2.priority_score }));
        const projects = d.projects
          .filter((p) => p.site_id && (!sector.length || sector.includes(p.sector ?? "")))
          .map((p) => ({ id: p.id, name: p.name, site_id: p.site_id, stage: p.stage, sector: p.sector, in_engagement_window: p.in_engagement_window, forecast_start: p.forecast_start, forecast_end: p.forecast_end }));
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
          .map((p) => ({ id: p.id, name: p.name, stage: p.stage, stage_order: p.stage_order, in_engagement_window: p.in_engagement_window, forecast_start: p.forecast_start, forecast_end: p.forecast_end, forecast_detail: p.forecast_detail, site_id: p.site_id, site_name: p.site_name }))
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
      if (path === "/api/priority") {
        const items = d.deals
          .filter((x2) => !["won", "lost", "parked"].includes(x2.stage))
          .sort((a, b) => (b.priority_score ?? -1) - (a.priority_score ?? -1) || time(b.updated_at) - time(a.updated_at))
          .slice(0, Number(q.get("limit") ?? 100))
          .map((x2) => ({
            id: x2.id,
            title: x2.title,
            deal_type: x2.deal_type,
            stage: x2.stage,
            stage_pending: x2.stage_pending,
            site_id: x2.site_id,
            site_name: x2.site_name,
            project_id: x2.project_id,
            lead_time_days: x2.lead_time_days,
            demand_litres_month: x2.demand_litres_month,
            confidence: x2.confidence,
            buyer_fit: x2.buyer_fit,
            has_contact: x2.has_contact,
            priority_score: x2.priority_score,
            priority_breakdown: x2.priority_breakdown,
            evidence_ids: x2.evidence_ids,
          }));
        return ok({ items });
      }
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
      if (path === "/api/quarantine") return ok({ items: d.quarantine.slice(0, Number(q.get("limit") ?? 100)) });
      if ((x = m(/^\/api\/quarantine\/([^/]+)$/))) {
        const item = d.quarantine.find((e) => e.id === x![1]);
        return item ? ok(item) : err(404, "quarantine item not found");
      }
      if (path === "/api/proposals") {
        const st = q.get("status");
        return ok({ items: d.proposals.filter((p) => !st || p.status === st).sort((a, b) => time(b.created_at) - time(a.created_at)) });
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

  // ---------- telemetry (docs/06) ----------

  telemetry() {
    const secs = (a: string | null, b: string | null) => (a && b ? (time(b) - time(a)) / 1000 : null);
    const alerts: TelemetryAlert[] = this.data.alerts.map((a) => ({
      id: a.id,
      tier: a.tier,
      tier_rule: a.tier_rule,
      title: a.title,
      status: a.status,
      published_at: a.published_at,
      fetched_at: a.fetched_at,
      raised_at: a.raised_at,
      deliveries: this.data.deliveries[a.id] ?? [],
      acknowledged_at: a.acknowledged_at,
      acknowledged_by: a.acknowledged_by,
      decided_at: a.decided_at,
      outcome: a.status === "unconfirmed" ? null : a.status,
      latency_fetch_to_alert_seconds: secs(a.fetched_at, a.raised_at),
      time_to_ack_seconds: secs(a.raised_at, a.acknowledged_at),
    }));
    const lat = alerts.map((a) => a.latency_fetch_to_alert_seconds).filter((v): v is number => v !== null);
    const ack = alerts.map((a) => a.time_to_ack_seconds).filter((v): v is number => v !== null);
    const rules = [...new Set(alerts.map((a) => a.tier_rule))].sort();
    return {
      alerts,
      metrics: {
        latency_fetch_to_alert_seconds: { n: lat.length, median: median(lat), p90: pct(lat, 0.9) },
        time_to_ack_seconds: { n: ack.length, median: median(ack), p90: pct(ack, 0.9) },
        false_positive_rate_by_rule: rules.map((r) => {
          const xs = alerts.filter((a) => a.tier_rule === r);
          const decided = xs.filter((a) => a.outcome);
          const fp = xs.filter((a) => a.outcome === "false_positive").length;
          return { tier_rule: r, alerts: xs.length, false_positives: fp, rate: decided.length ? fp / decided.length : null };
        }),
      },
    };
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
        p.status = "rejected";
        p.decision_reason = reason;
        this.clearPending(p);
        const live = this.newEvent({ stream_type: "proposal", stream_id: p.id, event_type: "ProposalRejected", payload: { proposal_id: p.id, reason }, evidence_ids: [], certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: p.id });
        return ok({ status: "rejected" }, [live]);
      }
      const events = action === "edit-approve" ? ((body.events as ProposedEvent[]) ?? p.events) : p.events;
      p.status = action === "edit-approve" ? "edited_approved" : "approved";
      p.decided_by = this.userId;
      p.decided_at = new Date().toISOString();
      this.clearPending(p);
      const live = events.map((e) => this.apply(e, p));
      live.push(this.newEvent({ stream_type: "proposal", stream_id: p.id, event_type: action === "edit-approve" ? "ProposalEditedApproved" : "ProposalApproved", payload: { proposal_id: p.id }, evidence_ids: [], certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: p.id }));
      return ok({ status: p.status }, live);
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
        const id = `prop-live-${Date.now()}`;
        const proposal: Proposal = {
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
          title: `Move "${deal.title}" to ${d.stages.deal_stages.find((s) => s.code === to)!.name}`,
          summary: null,
          events: [{ event_type: "DealStageChanged", stream_type: "deal", stream_id: deal.id, payload: { from_stage: deal.stage, to_stage: to }, evidence_ids: deal.evidence_ids, certainty: "stated" }],
          evidence_ids: deal.evidence_ids,
          tier: null,
          created_at: new Date().toISOString(),
        };
        d.proposals.push(proposal);
        deal.stage_pending = to;
        deal.pending_proposal_id = id;
        const live = this.newEvent({ stream_type: "proposal", stream_id: id, event_type: "ProposalCreated", payload: { proposal_id: id, kind: "DealStageChanged", policy: "review" }, evidence_ids: [], certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: id });
        return ok({ proposal_id: id, status: "pending" }, [live]);
      }
      const now = new Date().toISOString();
      const add = (k: Engagement["kind"], data: Record<string, unknown>, eventType: string) => {
        const live = this.newEvent({ stream_type: "deal", stream_id: deal.id, event_type: eventType, payload: data, evidence_ids: [], certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: null });
        d.engagement.push({ event_id: live.data.id, deal_id: deal.id, kind: k, actor_id: this.userId, data, recorded_at: now });
        deal.updated_at = now;
        return ok({ event_id: live.data.id }, [live]);
      };
      if (kind === "contacts") {
        if (!body.name || !body.role || !body.found_via) return err(422, "name, role and found_via are required");
        deal.has_contact = true;
        return add("contact", { contact_id: `person-live-${Date.now()}`, role: body.role, organisation_id: body.organisation_id ?? null, found_via: body.found_via, personal: { name: body.name, email: body.email, phone: body.phone } }, "ContactAdded");
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
        a.acknowledged_at ??= now;
        a.acknowledged_by ??= this.userId;
      } else if (action === "confirm") {
        Object.assign(a, { status: "confirmed", decided_at: now, decided_by: this.userId, decision_reason: (body.reason as string) || null } satisfies Partial<Alert>);
        type = "AlertConfirmed";
      } else {
        Object.assign(a, { status: body.false_positive ? "false_positive" : "dismissed", decided_at: now, decided_by: this.userId, decision_reason: (body.reason as string) || null } satisfies Partial<Alert>);
        type = "AlertDismissed";
      }
      a.updated_at = now;
      const live = this.newEvent({ stream_type: "alert", stream_id: a.id, event_type: type, payload: body, evidence_ids: [], certainty: null, actor_type: "human", actor_id: this.userId, proposal_id: null });
      return ok({ status: a.status }, [live]);
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

  private clearPending(p: Proposal) {
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
  private apply(e: ProposedEvent, p: Proposal): LiveOut {
    const st = e.stream_type ?? p.stream_type ?? "entity";
    const sid = e.stream_id ?? p.stream_id ?? "";
    if (e.event_type === "DealStageChanged") {
      const deal = this.data.deals.find((x) => x.id === sid);
      if (deal) Object.assign(deal, { stage: String(e.payload.to_stage), updated_at: new Date().toISOString() } satisfies Partial<Deal>);
    }
    if (e.event_type === "SiteStatusChanged") {
      const site = this.data.sites.find((x) => x.id === sid);
      if (site) Object.assign(site, { status: String(e.payload.to_status) } satisfies Partial<Site>);
    }
    return this.newEvent({ stream_type: st, stream_id: sid, event_type: e.event_type, payload: e.payload, evidence_ids: e.evidence_ids ?? [], certainty: e.certainty ?? null, actor_type: "human", actor_id: this.userId, proposal_id: p.id });
  }
}
