// The fixture dataset for the end to end tests. It has the shapes of the read endpoints (services/api/routers/read.py)
// and of the M4 endpoints in docs/api-contract.md.
//
// Sites, organisations, sources and known gaps come from the Monitoring Brief (config/monitoring-brief/v1.yaml).
// Stages and taxonomies come from config/. The articles, quotes, projects and opportunities are fictional test data.
// Their publishers are fictional and their links go to fixtures.strata.test, so no text is attributed to a real outlet.
//
// buildDataset({ signals: 60, deals: 24 }) gives the realistic small dataset (e2e/fixtures/small-dataset.json).
// buildDataset({ signals: 10000, deals: 500 }) gives the large dataset for docs/07 criteria 6 and 7.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import type {
  Alert,
  BriefVersion,
  Certainty,
  Deal,
  DemandDriver,
  Engagement,
  EvidenceItem,
  ForecastDetail,
  KnownGap,
  Project,
  QuarantineItem,
  Relationship,
  Signal,
  Site,
  SourceHealth,
  StagesConfig,
  Taxonomy,
  TimelineEvent,
} from "../../src/api/types";
import type { Proposal } from "../../src/api/writes";

export const FIXTURE_NOW = "2026-09-26T09:00:00Z";
const NOW = Date.parse(FIXTURE_NOW);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const readYaml = (...p: string[]) => yaml.load(readFileSync(join(REPO_ROOT, "config", ...p), "utf8")) as Record<string, unknown>;

export interface StreamEvent extends TimelineEvent {
  stream_type: string;
  stream_id: string;
}

export interface Dataset {
  now: string;
  stages: StagesConfig;
  taxonomy: Taxonomy;
  organisations: Record<string, string>;
  sites: Site[];
  signals: Signal[];
  alerts: Alert[];
  deliveries: Record<string, Array<{ channel: string; delivered_at: string | null }>>;
  drivers: DemandDriver[];
  projects: Project[];
  deals: Deal[];
  relationships: Relationship[];
  engagement: Engagement[];
  events: StreamEvent[];
  proposals: Proposal[];
  evidence: Record<string, EvidenceItem>;
  sources: SourceHealth[];
  briefVersion: number;
  knownGaps: KnownGap[];
  briefs: BriefVersion[];
  quarantine: QuarantineItem[];
}

/** A small deterministic random number generator (mulberry32), so each build gives the same data. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (t: number) => new Date(t).toISOString();
const isoDate = (t: number) => iso(t).slice(0, 10);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const PUBLISHERS = ["Copperbelt Wire", "Zambezi Business Daily", "Lusaka Mining Review", "Kafue Industry Notes", "Northern Corridor Post"];
const SITE_SECTOR: Record<string, string> = {
  mine: "mining",
  exploration: "mining",
  farm: "agriculture",
  power: "power",
  industrial: "industry",
  transport: "transport",
  border: "transport",
  fuel_supply: "fuel_supply",
};
const STATUS_MAP: Record<string, string | null> = {
  producing: "producing",
  "ramping up": "ramping_up",
  suspended: "suspended",
  "care and maintenance": "care_and_maintenance",
  "under construction": "under_construction",
  development: "under_construction",
  unknown: null,
};

interface BriefSite {
  id: string;
  name: string;
  aliases?: string[];
  site_class: string;
  operator?: string | null;
  district?: string | null;
  province?: string | null;
  status_hint?: string;
  geometry?: { lat: number | null; lon: number | null; approximate: boolean | null } | null;
}

/** Signal title templates. {site} and {operator} come from the watch list. Fictional events. */
const SIGNAL_TEMPLATES: Array<{ title: string; theme: string; deal_type?: string; quote: string }> = [
  { title: "{operator} files environmental impact statement for {site} expansion", theme: "eia_filed", quote: "has filed an environmental impact statement for the expansion of {site} with the Zambia Environmental Management Agency" },
  { title: "Contract mining tender for {site} opens to prequalified bidders", theme: "tender", deal_type: "contract_mining", quote: "invites prequalified contractors to bid for load and haul services at {site}" },
  { title: "{operator} completes feasibility study for new pit at {site}", theme: "feasibility_study", quote: "completed the definitive feasibility study for the new open pit at {site}" },
  { title: "Haulage contractor appointed for concentrate transport from {site}", theme: "contractor_award", deal_type: "haulage_contract", quote: "appointed a haulage contractor to move concentrate from {site} to the Ndola smelter" },
  { title: "{site} fleet to add 40 haul trucks in 2027", theme: "fleet_purchase", deal_type: "fleet_purchase", quote: "plans to add 40 haul trucks to the mining fleet at {site} in 2027" },
  { title: "Power supply interruptions affect operations at {site}", theme: "load_shedding", quote: "reported power supply interruptions that affected operations at {site}" },
  { title: "{operator} reaches financial close for {site} project", theme: "financing_close", quote: "reached financial close on the loan facility for the {site} project" },
  { title: "Expression of interest: fuel supply to {site}", theme: "eoi", deal_type: "fuel_supply_contract", quote: "calls for expressions of interest for the supply of diesel to {site}" },
  { title: "Exploration drilling programme starts near {site}", theme: "exploration_drilling", quote: "started a drilling programme on the licence area near {site}" },
  { title: "EPC contract signed for processing plant at {site}", theme: "contractor_award", deal_type: "epc_contract", quote: "signed an engineering, procurement and construction contract for the new processing plant at {site}" },
];

const DRIVER_TEMPLATES: Array<{ title: string; driver_type: string; direction: string; geography: string[]; quote: string }> = [
  { title: "Energy Regulation Board raises the diesel pump price by 4 percent", driver_type: "erb_price_change", direction: "demand_down", geography: ["zm"], quote: "the Energy Regulation Board increased the pump price of low sulphur diesel by 4 percent" },
  { title: "Load shedding extended to 12 hours a day on the Copperbelt", driver_type: "load_shedding", direction: "demand_up", geography: ["prov_copperbelt"], quote: "the power utility extended load shedding to 12 hours a day, and mines moved more plant to diesel generators" },
  { title: "TAZAMA pipeline shutdown for maintenance planned for November", driver_type: "pipeline_outage", direction: "demand_up", geography: ["dist_ndola", "corr_dar_es_salaam"], quote: "the pipeline will stop for ten days of maintenance in November" },
  { title: "Truck queues at Kasumbalesa reach 40 km", driver_type: "border_delay", direction: "demand_up", geography: ["corr_kasumbalesa"], quote: "truck queues at the Kasumbalesa border post reached 40 kilometres on Monday" },
  { title: "Fuel shortage reported at filling stations in North-Western Province", driver_type: "fuel_shortage", direction: "demand_up", geography: ["prov_north_western"], quote: "filling stations in Solwezi ran out of diesel for two days" },
  { title: "Rains end: farm block irrigation demand falls", driver_type: "season", direction: "demand_down", geography: ["prov_central"], quote: "irrigation pumps in the Mkushi farm block will run less after the rains" },
  { title: "Lobito corridor rail tender pipeline announced", driver_type: "procurement_pipeline", direction: "procurement", geography: ["corr_lobito"], quote: "the ministry announced a pipeline of rail construction tenders for the Lobito corridor" },
  { title: "Kariba lake level improves, hydro output to rise", driver_type: "hydro_level", direction: "demand_down", geography: ["prov_southern"], quote: "the lake level at Kariba improved, and hydro output will rise in the dry season" },
];

interface ProjectSeed {
  id: string;
  name: string;
  site: string;
  stage: string;
  sector: string;
  forecast: boolean;
  type: string;
}

const PROJECT_SEEDS: ProjectSeed[] = [
  { id: "prj-lumwana-expansion", name: "Lumwana super pit expansion", site: "lumwana", stage: "construction_mobilisation", sector: "mining", forecast: false, type: "mine_expansion" },
  { id: "prj-kansanshi-s3", name: "Kansanshi S3 expansion", site: "kansanshi", stage: "commissioning_rampup", sector: "mining", forecast: false, type: "mine_expansion" },
  { id: "prj-mingomba", name: "Mingomba copper project", site: "mingomba", stage: "feasibility", sector: "mining", forecast: true, type: "new_mine" },
  { id: "prj-kalengwa", name: "Kalengwa copper mine development", site: "kalengwa", stage: "construction_mobilisation", sector: "mining", forecast: false, type: "new_mine" },
  { id: "prj-kashime", name: "Kashime copper mine (Fishtie)", site: "kashime", stage: "eia_filed", sector: "mining", forecast: true, type: "new_mine" },
  { id: "prj-muntanga", name: "Muntanga uranium project", site: "muntanga", stage: "financing_fid", sector: "mining", forecast: true, type: "new_mine" },
  { id: "prj-batoka", name: "Batoka Gorge hydro-electric scheme", site: "batoka_gorge", stage: "feasibility", sector: "power", forecast: true, type: "power_project" },
  { id: "prj-lobito-rail", name: "Zambia-Lobito greenfield rail line", site: "zambia_lobito_rail", stage: "financing_fid", sector: "transport", forecast: true, type: "rail" },
  { id: "prj-tz-pipeline", name: "Tanzania-Zambia products pipeline", site: "tz_zm_products_pipeline", stage: "licence_granted", sector: "fuel_supply", forecast: true, type: "pipeline" },
  { id: "prj-lobito-pipeline", name: "Lobito-Lusaka oil products pipeline", site: "lobito_lusaka_pipeline", stage: "scoping_prefeasibility", sector: "fuel_supply", forecast: false, type: "pipeline" },
  { id: "prj-kabwe-tailings", name: "Kabwe tailings reprocessing plant", site: "kabwe_tailings", stage: "environmental_approval", sector: "mining", forecast: true, type: "tailings" },
  { id: "prj-mimbula-phase2", name: "Mimbula phase 2", site: "mimbula", stage: "resource_defined", sector: "mining", forecast: false, type: "mine_expansion" },
  { id: "prj-arc-nw", name: "Arc Minerals North-Western drilling", site: "arc_minerals_nw", stage: "exploration", sector: "mining", forecast: false, type: "exploration" },
  { id: "prj-chisamba-solar-2", name: "Chisamba solar plant extension", site: "chisamba_solar", stage: "eia_filed", sector: "power", forecast: true, type: "power_project" },
  { id: "prj-nansanga-irrigation", name: "Nansanga farm block irrigation scheme", site: "nansanga_farm_block", stage: "scoping_prefeasibility", sector: "agriculture", forecast: false, type: "irrigation" },
  { id: "prj-mufulira-restart", name: "Mopani Mufulira restart", site: "mopani_mufulira", stage: "care_maintenance_suspension_closure", sector: "mining", forecast: false, type: "mine_restart" },
];

const BUYER_ROLES = ["owner", "mining_contractor", "haulage_contractor", "epc_contractor", "fuel_supplier_of_record"] as const;
const CONTRACTORS = { mining_contractor: "jchx", haulage_contractor: "macro_ocean_consortium", epc_contractor: "powerchina", fuel_supplier_of_record: "puma_energy_zambia" } as const;

const DEAL_TITLES: Record<string, string> = {
  fuel_supply_contract: "Diesel supply for {name}",
  haulage_contract: "Haulage fuel for {name}",
  contract_mining: "Contract mining fleet fuel at {name}",
  epc_contract: "EPC construction fuel for {name}",
  fleet_purchase: "Fuel for the new fleet at {name}",
  power_supply: "Standby generator fuel at {name}",
  equipment_rental: "Plant hire fuel at {name}",
};

export interface BuildOptions {
  signals: number;
  deals: number;
  seed?: number;
}

export function buildDataset({ signals: nSignals, deals: nDeals, seed = 7 }: BuildOptions): Dataset {
  const rand = rng(seed);

  // ---------- configuration ----------
  const stagesYaml = readYaml("stages.yaml") as { stages: StagesConfig["deal_stages"] };
  const lc = readYaml("lifecycle.yaml") as unknown as { stages: StagesConfig["lifecycle_stages"]; restart_path: StagesConfig["restart_path"]; engagement_window: StagesConfig["engagement_window"]; procurement_stage: string };
  const stages: StagesConfig = {
    deal_stages: stagesYaml.stages,
    lifecycle_stages: lc.stages,
    restart_path: lc.restart_path,
    engagement_window: lc.engagement_window,
    procurement_stage: lc.procurement_stage,
  };
  const taxonomy: Taxonomy = {
    sectors: (readYaml("taxonomy", "sectors.yaml") as { sectors: Taxonomy["sectors"] }).sectors,
    site_classes: (readYaml("taxonomy", "site-classes.yaml") as { site_classes: Taxonomy["site_classes"] }).site_classes,
    geographies: readYaml("taxonomy", "geographies.yaml") as unknown as Taxonomy["geographies"],
    deal_types: readYaml("taxonomy", "deal-types.yaml") as unknown as Taxonomy["deal_types"],
  };
  const brief = readYaml("monitoring-brief", "v1.yaml") as {
    watch: { daily: BriefSite[]; weekly: BriefSite[] };
    organisations: Array<{ id: string; name: string }>;
    sources: Record<string, Array<{ id: string; name: string; type: string; url: string; schedule: string; licence_code: string; source_type?: string }>>;
    known_gaps: KnownGap[];
  };
  const briefYaml = readFileSync(join(REPO_ROOT, "config", "monitoring-brief", "v1.yaml"), "utf8");
  const organisations: Record<string, string> = Object.fromEntries(brief.organisations.map((o) => [o.id, o.name]));
  const lifecycleOrder = (c: string) => stages.lifecycle_stages.find((s) => s.code === c)?.order ?? null;
  const winLo = lifecycleOrder(stages.engagement_window.from)!;
  const winHi = lifecycleOrder(stages.engagement_window.to)!;
  const inWindow = (c: string) => {
    const o = lifecycleOrder(c);
    return o !== null && o >= winLo && o <= winHi;
  };

  // ---------- evidence ----------
  const evidence: Record<string, EvidenceItem> = {};
  let sourceSeq = 0;
  const addEvidence = (id: string, quote: string, opts: { title: string; publisher?: string; published: number; full?: boolean }) => {
    sourceSeq += 1;
    const publisher = opts.publisher ?? PUBLISHERS[sourceSeq % PUBLISHERS.length]!;
    const lead = `LUSAKA. ${publisher} reports that`;
    const tail = "The company gave no other details. A spokesperson said that the work follows the plan agreed with the regulator.";
    const excerpt = `${lead} ${quote}. ${tail}`;
    const start = lead.length + 1;
    evidence[id] = {
      id,
      source_id: `src-${sourceSeq}`,
      char_start: start,
      char_end: start + quote.length,
      quote,
      verified: true,
      url: `https://fixtures.strata.test/articles/${sourceSeq}`,
      title: opts.title,
      publisher,
      published_at: iso(opts.published),
      retention_policy: opts.full === false ? "verify_then_purge" : "full",
      read_at_source: false,
      excerpt: opts.full === false ? null : excerpt,
      type: "web",
      context: opts.full === false ? null : excerpt,
    };
    return id;
  };

  // ---------- sites ----------
  const briefSites = [...brief.watch.daily.map((s) => ({ ...s, watch: "daily" as const })), ...brief.watch.weekly.map((s) => ({ ...s, watch: "weekly" as const }))];
  const sites: Site[] = briefSites.map((s): Site => {
    const opId = s.operator ?? null;
    const opEv = opId ? addEvidence(`ev-op-${s.id}`, `${organisations[opId] ?? opId} operates ${s.name}`, { title: `${s.name}: operations`, published: NOW - 200 * DAY }) : null;
    return {
      id: s.id,
      name: s.name,
      aliases: s.aliases ?? [],
      site_class: s.site_class,
      watch: s.watch,
      status: STATUS_MAP[s.status_hint ?? "unknown"] ?? null,
      status_pending: null,
      district: s.district ?? null,
      province: s.province ?? null,
      lat: s.geometry?.lat ?? null,
      lon: s.geometry?.lon ?? null,
      geometry_approximate: s.geometry?.approximate ?? null,
      last_signal_at: null,
      attributes: (opId && opEv ? { operator: { value: opId, event_id: `evt-op-${s.id}`, certainty: "stated", evidence_ids: [opEv] } } : {}) as Site["attributes"],
      operator_id: opId,
      operator_name: opId ? (organisations[opId] ?? null) : null,
    };
  });
  const siteById = new Map(sites.map((s) => [s.id, s]));
  // A pending status change from a SiteStatusChanged proposal (docs/09 scenario 13).
  siteById.get("mopani_nkana")!.status_pending = "suspended";

  const events: StreamEvent[] = [];
  let eventSeq = 0;
  const addEvent = (e: Omit<StreamEvent, "id" | "sequence"> & { id?: string }) => {
    eventSeq += 1;
    const ev: StreamEvent = { id: e.id ?? `evt-${eventSeq}`, sequence: events.filter((x) => x.stream_type === e.stream_type && x.stream_id === e.stream_id).length + 1, ...e };
    events.push(ev);
    return ev;
  };
  for (const s of sites) {
    addEvent({
      stream_type: "entity",
      stream_id: s.id,
      event_type: "EntityIdentified",
      payload: { entity_type: "site", name: s.name, site_class: s.site_class, watch: s.watch },
      evidence_ids: s.attributes.operator ? s.attributes.operator.evidence_ids : [],
      certainty: "stated",
      actor_type: "system",
      actor_id: "brief-bootstrap",
      proposal_id: null,
      supersedes_event_id: null,
      occurred_at: null,
      recorded_at: iso(NOW - 300 * DAY),
    });
  }

  // ---------- signals ----------
  const spacing = nSignals > 1000 ? (365 * DAY) / nSignals : 3 * HOUR;
  const signals: Signal[] = [];
  const certainties: Certainty[] = ["stated", "stated", "reported", "stated", "speculative"];
  for (let i = 0; i < nSignals; i++) {
    const site = sites[(i * 7) % sites.length]!;
    const t = SIGNAL_TEMPLATES[(i * 3 + Math.floor(i / sites.length)) % SIGNAL_TEMPLATES.length]!;
    const operator = site.operator_name ?? "The operator";
    const fill = (x: string) => x.replace(/\{site\}/g, site.name).replace(/\{operator\}/g, operator);
    const tier = i % (nSignals > 1000 ? 19 : 7) === 0 ? 0 : i % 5 === 0 ? 1 : 2;
    const published = NOW - i * spacing - Math.floor(rand() * 30) * 60_000;
    const evId = addEvidence(`ev-sig-${i}`, `${operator} ${fill(t.quote)}`, { title: fill(t.title), published, full: i % 4 !== 3 });
    const sector = SITE_SECTOR[site.site_class ?? ""] ?? "industry";
    const geos = [site.province, site.district].filter((x): x is string => !!x);
    signals.push({
      id: `sig-${String(i).padStart(5, "0")}`,
      source_id: evidence[evId]!.source_id,
      title: fill(t.title),
      url: evidence[evId]!.url,
      publisher: evidence[evId]!.publisher,
      published_at: iso(published),
      fetched_at: iso(published + 20 * 60_000),
      tier,
      tier_rule: tier === 0 ? (t.deal_type ? "t0_open_procurement_notice" : "t0_new_project_first_trace") : tier === 1 ? "t1_stage_change_watched" : "t2_relevant",
      score: round(tier === 0 ? 0.85 + rand() * 0.14 : tier === 1 ? 0.6 + rand() * 0.2 : 0.2 + rand() * 0.35),
      breakdown: { relevance: round(rand()), watch: site.watch === "daily" ? 1 : 0.5, theme: t.theme },
      sectors: [sector],
      geographies: geos,
      themes: [t.theme],
      directions: [t.theme.includes("tender") || t.theme === "eoi" ? "procurement" : "project_pipeline"],
      deal_types: t.deal_type ? [t.deal_type] : [],
      entity_ids: [site.id],
      summary: [`${operator} ${fill(t.quote)}.`],
      certainty: certainties[i % certainties.length]!,
      read_at_source: i % 11 === 0,
      evidence_ids: [evId],
      event_id: `evt-sig-${i}`,
      recorded_at: iso(published + 25 * 60_000),
    });
    if (!site.last_signal_at || site.last_signal_at < iso(published)) site.last_signal_at = iso(published);
  }

  // ---------- alerts (Tier 0) ----------
  const t0 = signals.filter((s) => s.tier === 0).slice(0, 9);
  const statusCycle: Alert["status"][] = ["unconfirmed", "unconfirmed", "confirmed", "unconfirmed", "dismissed", "confirmed", "false_positive", "unconfirmed", "confirmed"];
  const deliveries: Dataset["deliveries"] = {};
  const alerts: Alert[] = t0.map((s, i) => {
    const raised = Date.parse(s.fetched_at!) + (3 + i) * 60_000;
    const status = statusCycle[i]!;
    const decided = status === "unconfirmed" ? null : iso(raised + (40 + i * 7) * 60_000);
    const acked = status !== "unconfirmed" || i === 3 ? iso(raised + (12 + i * 3) * 60_000) : null;
    const id = `alert-${String(i + 1).padStart(3, "0")}`;
    deliveries[id] = [
      { channel: "frontend", delivered_at: iso(raised + 800) },
      { channel: "email", delivered_at: iso(raised + 45_000) },
    ];
    return {
      id,
      tier: 0,
      tier_rule: s.tier_rule!,
      title: s.title,
      status,
      stream_type: "entity",
      stream_id: s.entity_ids[0]!,
      signal_id: s.id,
      source_id: s.source_id,
      evidence_ids: s.evidence_ids,
      published_at: s.published_at,
      fetched_at: s.fetched_at,
      raised_at: iso(raised),
      acknowledged_at: acked,
      acknowledged_by: acked ? "analyst-1" : null,
      decided_at: decided,
      decided_by: decided ? "approver-1" : null,
      decision_reason: status === "false_positive" ? "The article is about a different site with the same name." : status === "dismissed" ? "Old news, already known." : null,
      updated_at: decided ?? acked ?? iso(raised),
      url: s.url,
      publisher: s.publisher,
    };
  });
  // The site status alert of docs/09 scenario 13.
  const nkanaEv = addEvidence("ev-nkana-suspension", "Mopani Copper Mines suspended underground operations at the Nkana mine after a safety review", { title: "Nkana mine operations suspended", published: NOW - 5 * HOUR });
  alerts.unshift({
    id: "alert-000",
    tier: 0,
    tier_rule: "t0_daily_site_status_change",
    title: "Operations suspended at Mopani Nkana mine",
    status: "unconfirmed",
    stream_type: "entity",
    stream_id: "mopani_nkana",
    signal_id: null,
    source_id: evidence[nkanaEv]!.source_id,
    evidence_ids: [nkanaEv],
    published_at: iso(NOW - 5 * HOUR),
    fetched_at: iso(NOW - 4.8 * HOUR),
    raised_at: iso(NOW - 4.7 * HOUR),
    acknowledged_at: null,
    acknowledged_by: null,
    decided_at: null,
    decided_by: null,
    decision_reason: null,
    updated_at: iso(NOW - 4.7 * HOUR),
    url: evidence[nkanaEv]!.url,
    publisher: evidence[nkanaEv]!.publisher,
  });
  deliveries["alert-000"] = [
    { channel: "frontend", delivered_at: iso(NOW - 4.7 * HOUR + 600) },
    { channel: "email", delivered_at: iso(NOW - 4.7 * HOUR + 30_000) },
  ];

  // ---------- demand drivers ----------
  const drivers: DemandDriver[] = DRIVER_TEMPLATES.map((d, i) => {
    const observed = NOW - (i * 9 + 1) * DAY;
    const evId = addEvidence(`ev-drv-${i}`, d.quote, { title: d.title, published: observed });
    return {
      event_id: `evt-drv-${i}`,
      driver_type: d.driver_type,
      title: d.title,
      direction: d.direction,
      geography: d.geography,
      certainty: i === 2 ? "reported" : i === 6 ? "speculative" : "stated",
      observed_at: iso(observed),
      source_id: evidence[evId]!.source_id,
      evidence_ids: [evId],
      detail: {},
      recorded_at: iso(observed + HOUR),
      url: evidence[evId]!.url,
      publisher: evidence[evId]!.publisher,
      published_at: iso(observed),
    };
  });

  // ---------- projects ----------
  const projects: Project[] = PROJECT_SEEDS.filter((p) => siteById.has(p.site)).map((p, pi) => {
    const site = siteById.get(p.site)!;
    const order = lifecycleOrder(p.stage);
    const stageEv = addEvidence(`ev-stage-${p.id}`, `${p.name} reached the stage ${stages.lifecycle_stages.find((s) => s.code === p.stage)?.name.toLowerCase() ?? p.stage}`, {
      title: `${p.name}: stage`,
      published: NOW - (20 + pi * 5) * DAY,
    });
    let forecast: ForecastDetail | null = null;
    if (p.forecast && order !== null) {
      const procOrder = lifecycleOrder(stages.procurement_stage)!;
      const intervals = stages.lifecycle_stages
        .filter((s) => s.order >= order && s.order < procOrder)
        .map((s) => {
          const next = stages.lifecycle_stages.find((x) => x.order === s.order + 1)!;
          const median = 90 + ((s.order * 37) % 120);
          return { from: s.code, to: next.code, median_days: median, min_days: Math.round(median * 0.6), max_days: Math.round(median * 1.7), n_projects: 5 + ((s.order * 3) % 7), projects: ["Kansanshi", "Sentinel", "Lumwana", "Trident", "Enterprise"] };
        });
      const days = intervals.reduce((a, b) => a + b.median_days, 0);
      const start = NOW + days * DAY * 0.8;
      const end = NOW + days * DAY * 1.25;
      const fEv = addEvidence(`ev-fc-${p.id}`, `the ${p.name} timeline puts contractor procurement after the investment decision`, { title: `${p.name}: timeline`, published: NOW - 10 * DAY });
      forecast = { current_stage: p.stage, start: isoDate(start), end: isoDate(end), intervals, shift_months_nearer: pi === 4 ? 6 : null, event_id: `evt-fc-${p.id}`, evidence_ids: [fEv, stageEv] };
    }
    const demandEv = addEvidence(`ev-dem-${p.id}`, `the fleet at ${site.name} will have 60 haul trucks`, { title: `${p.name}: fleet`, published: NOW - 30 * DAY });
    const firstTrace = NOW - (400 + pi * 30) * DAY;
    const history = stages.lifecycle_stages.filter((s) => order !== null && s.order <= order && s.order >= Math.max(1, (order ?? 1) - 2));
    history.forEach((s, hi) =>
      addEvent({
        stream_type: "project",
        stream_id: p.id,
        event_type: "ProjectStageChanged",
        payload: { from_stage: hi === 0 ? null : history[hi - 1]!.code, to_stage: s.code, name: p.name, site_id: p.site },
        evidence_ids: hi === history.length - 1 ? [stageEv] : [addEvidence(`ev-stage-${p.id}-${hi}`, `${p.name} entered the stage ${s.name.toLowerCase()}`, { title: p.name, published: firstTrace + hi * 90 * DAY })],
        certainty: "stated",
        actor_type: "agent",
        actor_id: "lifecycle-agent",
        proposal_id: null,
        supersedes_event_id: null,
        occurred_at: iso(firstTrace + hi * 90 * DAY),
        recorded_at: iso(firstTrace + hi * 90 * DAY + HOUR),
      }),
    );
    return {
      id: p.id,
      name: p.name,
      site_id: p.site,
      project_type: p.type,
      sector: p.sector,
      stage: p.stage,
      stage_order: order,
      stage_evidence_ids: [stageEv],
      stage_certainty: pi === 2 ? "reported" : "stated",
      stage_changed_at: iso(NOW - (20 + pi * 5) * DAY),
      in_engagement_window: inWindow(p.stage),
      first_trace_at: iso(firstTrace),
      forecast_start: forecast?.start ?? null,
      forecast_end: forecast?.end ?? null,
      forecast_detail: forecast,
      demand_estimate:
        pi % 3 === 0
          ? {
              formula_id: "fleet_trucks",
              expression: "trucks * litres_per_truck_hour * hours_per_month",
              inputs: { trucks: { value: 60, evidence_ids: [demandEv] } },
              value: 60 * 45 * 500,
              unit: "litres per month",
              label: "estimate",
              event_id: `evt-dem-${p.id}`,
            }
          : null,
      updated_at: iso(NOW - (20 + pi * 5) * DAY),
      site_name: site.name,
      site_class: site.site_class,
    };
  });

  // ---------- buyer roles ----------
  const relationships: Relationship[] = [];
  for (const p of projects) {
    const site = siteById.get(p.site_id!)!;
    for (const role of BUYER_ROLES) {
      const org = role === "owner" ? site.operator_id : CONTRACTORS[role];
      if (!org || (role === "epc_contractor" && p.sector === "mining" && p.stage_order! > 9)) continue;
      const evId = addEvidence(`ev-rel-${p.id}-${role}`, `${organisations[org] ?? org} is the ${role.replace(/_/g, " ")} for ${p.name}`, { title: `${p.name}: contractors`, published: NOW - 40 * DAY });
      relationships.push({
        event_id: `evt-rel-${p.id}-${role}`,
        subject_id: p.id,
        predicate: `buyer_role_${role}`,
        object_id: org,
        certainty: role === "haulage_contractor" ? "reported" : "stated",
        evidence_ids: [evId],
        superseded_by: null,
        recorded_at: iso(NOW - 40 * DAY),
        organisation_name: organisations[org] ?? org,
      });
    }
  }

  // ---------- deals ----------
  const dealStages = stages.deal_stages.map((s) => s.code);
  const openStages = stages.deal_stages.filter((s) => !s.terminal).map((s) => s.code);
  const dealTypes = Object.keys(DEAL_TITLES);
  const deals: Deal[] = [];
  const engagement: Engagement[] = [];
  for (let i = 0; i < nDeals; i++) {
    const project = i < projects.length * 2 ? projects[i % projects.length]! : i % 3 === 0 ? projects[i % projects.length]! : null;
    const site = project ? siteById.get(project.site_id!)! : sites[(i * 5) % sites.length]!;
    const type = dealTypes[(i * 3) % dealTypes.length]!;
    const name = project?.name ?? site.name;
    const baseTitle = DEAL_TITLES[type]!.replace("{name}", name);
    const title = nDeals > 100 ? `${baseTitle} (${i + 1})` : i >= projects.length ? `${baseTitle}, lot 2` : baseTitle;
    const stage = i % 23 === 21 ? "won" : i % 29 === 27 ? "lost" : i % 31 === 29 ? "parked" : openStages[(i * 5) % openStages.length]!;
    const created = NOW - (120 + (i % 90)) * DAY;
    const evId = addEvidence(`ev-deal-${i}`, `${site.name} will need fuel for ${type.replace(/_/g, " ")} work`, { title: `${name}: opportunity`, published: created - DAY });
    const hasContact = i % 4 === 1 || i % 4 === 2;
    const leadDays = project?.forecast_start ? Math.max(0, Math.round((Date.parse(project.forecast_start) - NOW) / DAY)) : null;
    const demand = project?.demand_estimate?.value ?? (i % 2 === 0 ? 50_000 + ((i * 7919) % 400_000) : null);
    const confidence = round(0.4 + ((i * 13) % 55) / 100);
    const fit = round(0.3 + ((i * 17) % 65) / 100);
    const parts = {
      lead_time: round(leadDays === null ? 0.05 : Math.min(0.4, leadDays / 1500)),
      demand: round(demand === null ? 0 : Math.min(0.3, demand / 1_500_000)),
      confidence: round(confidence * 0.2),
      buyer_fit: round(fit * 0.15),
      no_contact_boost: !hasContact && project?.in_engagement_window ? 0.1 : 0,
    };
    const score = round(Object.values(parts).reduce((a, b) => a + b, 0), 3);
    const nextAction =
      i % 3 !== 2 && openStages.includes(stage)
        ? { action: ["Call the procurement manager", "Send the supplier registration form", "Visit the site office", "Ask for the tender calendar"][i % 4]!, owner_user_id: i % 2 ? "analyst-1" : "e2e-analyst", due_date: isoDate(NOW + ((i % 21) - 6) * DAY), event_id: `evt-na-${i}` }
        : null;
    const deal: Deal = {
      id: `deal-${String(i + 1).padStart(4, "0")}`,
      title,
      deal_type: type,
      stage,
      stage_pending: null,
      pending_proposal_id: null,
      site_id: site.id,
      project_id: project?.id ?? null,
      organisation_id: site.operator_id,
      buyer_fit: fit,
      confidence,
      lead_time_days: leadDays,
      demand_litres_month: demand,
      has_contact: hasContact,
      prequalification_status: i % 6 === 0 ? "submitted" : null,
      next_action: nextAction,
      priority_score: score,
      priority_breakdown: parts,
      evidence_ids: [evId],
      created_at: iso(created),
      updated_at: iso(created + 30 * DAY),
      site_name: site.name,
      organisation_name: site.operator_name,
    };
    deals.push(deal);
    addEvent({
      stream_type: "deal",
      stream_id: deal.id,
      event_type: "DealIdentified",
      payload: { title, deal_type: type, stage: "signal", site_id: site.id, project_id: project?.id ?? null },
      evidence_ids: [evId],
      certainty: "stated",
      actor_type: "agent",
      actor_id: "classifier",
      proposal_id: `prop-deal-${i}`,
      supersedes_event_id: null,
      occurred_at: null,
      recorded_at: iso(created),
    });
    const reach = dealStages.indexOf(stage);
    const path = stage === "won" || stage === "lost" || stage === "parked" ? [...openStages.slice(1, 4), stage] : openStages.slice(1, reach + 1);
    path.forEach((to, k) =>
      addEvent({
        stream_type: "deal",
        stream_id: deal.id,
        event_type: "DealStageChanged",
        payload: { from_stage: k === 0 ? "signal" : path[k - 1]!, to_stage: to },
        evidence_ids: [evId],
        certainty: "stated",
        actor_type: "human",
        actor_id: "approver-1",
        proposal_id: `prop-stage-${i}-${k}`,
        supersedes_event_id: null,
        occurred_at: null,
        recorded_at: iso(created + (k + 1) * 10 * DAY),
      }),
    );
    if (i < 12 && hasContact) {
      engagement.push({
        event_id: `evt-contact-${i}`,
        deal_id: deal.id,
        kind: "contact",
        actor_id: "analyst-1",
        data: { contact_id: `person-${i}`, role: "Procurement manager", organisation_id: site.operator_id, found_via: "Supplier day in Kitwe", personal: { name: ["Mwila Banda", "Chanda Phiri", "Natasha Mulenga", "Joseph Tembo"][i % 4], email: `procurement${i}@example.com` } },
        recorded_at: iso(created + 5 * DAY),
      });
      engagement.push({
        event_id: `evt-touch-${i}`,
        deal_id: deal.id,
        kind: "touchpoint",
        actor_id: "analyst-1",
        data: { kind: "meeting", date: isoDate(created + 12 * DAY), note: "Met at the site office. They buy diesel through the mining contractor.", contact_id: `person-${i}` },
        recorded_at: iso(created + 12 * DAY),
      });
    }
    if (nextAction) engagement.push({ event_id: nextAction.event_id!, deal_id: deal.id, kind: "next_action", actor_id: "analyst-1", data: { ...nextAction }, recorded_at: iso(NOW - 3 * DAY) });
    if (deal.prequalification_status) {
      const buyer = relationships.find((r) => r.subject_id === project?.id && r.predicate === "buyer_role_mining_contractor");
      if (buyer) engagement.push({ event_id: `evt-pq-${i}`, deal_id: deal.id, kind: "prequalification", actor_id: "analyst-1", data: { buyer_id: buyer.object_id, status: "submitted" }, recorded_at: iso(NOW - 8 * DAY) });
    }
  }

  // ---------- proposals ----------
  const proposals: Proposal[] = [];
  const pendingDeal = deals.find((d) => d.stage === "qualified") ?? deals[0]!;
  pendingDeal.stage_pending = "contact_found";
  pendingDeal.pending_proposal_id = "prop-001";
  const mergeEv = addEvidence("ev-merge", "Kansanshi Mining Plc, a subsidiary of First Quantum Minerals, operates the mine", { title: "Kansanshi ownership", published: NOW - 2 * DAY });
  const relEv = addEvidence("ev-rel-new", "Mota-Engil won the load and haul contract at the Kalengwa mine", { title: "Kalengwa contract", published: NOW - DAY });
  const prjEv = addEvidence("ev-prj-new", "ZEMA received a project brief for a new copper mine at Kashime", { title: "ZEMA notice", publisher: "ZEMA notices (fixture)", published: NOW - 6 * HOUR });
  proposals.push(
    {
      id: "prop-001",
      kind: "DealStageChanged",
      status: "pending",
      policy: "review",
      created_by_type: "human",
      created_by: "analyst-1",
      model_id: null,
      prompt_version: null,
      source_id: null,
      stream_type: "deal",
      stream_id: pendingDeal.id,
      title: `Move "${pendingDeal.title}" to ${stages.deal_stages.find((s) => s.code === "contact_found")!.name}`,
      summary: "The analyst found the procurement manager of the mining contractor.",
      events: [{ event_type: "DealStageChanged", stream_type: "deal", stream_id: pendingDeal.id, payload: { from_stage: pendingDeal.stage, to_stage: "contact_found" }, evidence_ids: pendingDeal.evidence_ids, certainty: "stated" }],
      evidence_ids: pendingDeal.evidence_ids,
      tier: null,
      created_at: iso(NOW - 3 * HOUR),
    },
    {
      id: "prop-002",
      kind: "SiteStatusChanged",
      status: "pending",
      policy: "review",
      created_by_type: "agent",
      created_by: "extractor",
      model_id: "fixture-model",
      prompt_version: "extractor-v1",
      source_id: evidence[nkanaEv]!.source_id,
      stream_type: "entity",
      stream_id: "mopani_nkana",
      title: "Mopani Nkana mine: status producing to suspended",
      summary: "The article reports a suspension of underground operations after a safety review.",
      events: [{ event_type: "SiteStatusChanged", stream_type: "entity", stream_id: "mopani_nkana", payload: { from_status: "producing", to_status: "suspended" }, evidence_ids: [nkanaEv], certainty: "reported" }],
      evidence_ids: [nkanaEv],
      tier: 0,
      created_at: iso(NOW - 4.6 * HOUR),
    },
    {
      id: "prop-003",
      kind: "EntityMerged",
      status: "pending",
      policy: "review",
      created_by_type: "agent",
      created_by: "resolver",
      model_id: "fixture-model",
      prompt_version: "resolver-v1",
      source_id: evidence[mergeEv]!.source_id,
      stream_type: "entity",
      stream_id: "kansanshi_mining_plc",
      title: "Merge \"Kansanshi Mining Plc\" and \"KMP\"",
      summary: "Two articles name one company in two ways.",
      events: [{ event_type: "EntityMerged", stream_type: "entity", stream_id: "kansanshi_mining_plc", payload: { merged_ids: ["kmp"], into_id: "kansanshi_mining_plc" }, evidence_ids: [mergeEv], certainty: "stated" }],
      evidence_ids: [mergeEv],
      tier: null,
      created_at: iso(NOW - 26 * HOUR),
    },
    {
      id: "prop-004",
      kind: "RelationshipAsserted",
      status: "pending",
      policy: "review",
      created_by_type: "agent",
      created_by: "extractor",
      model_id: "fixture-model",
      prompt_version: "extractor-v1",
      source_id: evidence[relEv]!.source_id,
      stream_type: "project",
      stream_id: "prj-kalengwa",
      title: "Kalengwa: mining contractor Mota-Engil",
      summary: null,
      events: [{ event_type: "RelationshipAsserted", stream_type: "project", stream_id: "prj-kalengwa", payload: { subject_id: "prj-kalengwa", predicate: "buyer_role_mining_contractor", object_id: "mota_engil" }, evidence_ids: [relEv], certainty: "reported" }],
      evidence_ids: [relEv],
      tier: 1,
      created_at: iso(NOW - 20 * HOUR),
    },
    {
      id: "prop-005",
      kind: "ProjectStageChanged",
      status: "pending",
      policy: "review",
      created_by_type: "human",
      created_by: "e2e-approver",
      model_id: null,
      prompt_version: null,
      source_id: evidence[prjEv]!.source_id,
      stream_type: "project",
      stream_id: "prj-kashime",
      title: "Kashime: stage Environmental assessment filed",
      summary: "The approver created this proposal. Another approver must decide.",
      events: [{ event_type: "ProjectStageChanged", stream_type: "project", stream_id: "prj-kashime", payload: { from_stage: "feasibility", to_stage: "eia_filed" }, evidence_ids: [prjEv], certainty: "stated" }],
      evidence_ids: [prjEv],
      tier: 0,
      created_at: iso(NOW - 5 * HOUR),
    },
  );

  // ---------- sources, known gaps, briefs, quarantine ----------
  const briefSources = [...(brief.sources.news ?? []), ...(brief.sources.early_signal ?? [])];
  const sources: SourceHealth[] = briefSources.map((s, i) => {
    const failed = i % 9 === 4;
    const never = i % 13 === 12;
    const runs = never ? 0 : 10;
    return {
      id: s.id,
      name: s.name,
      kind: s.type,
      section: i < (brief.sources.news?.length ?? 0) ? "news" : "early_signal",
      source_type: s.source_type ?? null,
      url: s.url,
      schedule: s.schedule,
      licence_code: s.licence_code,
      retention_policy: s.licence_code,
      last_success_at: never ? null : iso(NOW - (failed ? 3 : 0.5 + (i % 5)) * DAY),
      last_run_at: never ? null : iso(NOW - (0.2 + (i % 4) * 0.1) * DAY),
      last_status: never ? null : failed ? "failed" : "success",
      runs,
      error_rate: never ? null : failed ? 0.4 : i % 7 === 3 ? 0.1 : 0,
      documents_per_run: never ? null : round(2 + (i % 8) * 1.5),
      new_per_run: never ? null : round((i % 5) * 0.8),
      last_documents_found: never ? null : 3 + (i % 6),
      last_error: failed ? "HTTP 503 from the source" : null,
      last_error_at: failed ? iso(NOW - 0.3 * DAY) : null,
      next_run_at: iso(NOW + (1 + (i % 6)) * HOUR),
    };
  });
  const v2Yaml = briefYaml.replace(/^version: 1$/m, "version: 2").replace('name: "Zambia mining and industrials"', 'name: "Zambia mining and industrials (weekly sites daily)"');
  const briefs: BriefVersion[] = [
    { id: "brief-v1", version: 1, name: "Zambia mining and industrials", created_by: "bootstrap", created_at: iso(NOW - 10 * DAY), parent_version_id: null, change_note: "Built from the Argo brief", content_hash: "hash-v1", active: false, content: {}, yaml: briefYaml },
    { id: "brief-v2", version: 2, name: "Zambia mining and industrials (weekly sites daily)", created_by: "admin-1", created_at: iso(NOW - 2 * DAY), parent_version_id: "brief-v1", change_note: "Rename", content_hash: "hash-v2", active: true, content: {}, yaml: v2Yaml },
  ];
  const quarantine: QuarantineItem[] = [
    ["classifier", "taxonomy_code_unknown", { field: "sector", value: "oil_and_gas" }],
    ["extractor", "quote_not_in_source", { quote: "the mine will close in 2027" }],
    ["extractor", "evidence_span_mismatch", { char_start: 120, char_end: 180 }],
    ["summariser", "schema_invalid", { error: "summary must be a list" }],
    ["classifier", "instruction_in_document", { note: "The document text asked the model to ignore its rules. The output was quarantined." }],
    ["resolver", "merge_without_evidence", { candidates: ["zccm_ih", "zccm"] }],
  ].map(([agent, code, detail], i) => ({
    id: `q-${i + 1}`,
    source_id: `src-${i + 3}`,
    agent: agent as string,
    reason_code: code as string,
    detail: detail as Record<string, unknown>,
    output: { proposed: "fixture output", index: i },
    model_id: "fixture-model",
    prompt_version: `${agent as string}-v1`,
    created_at: iso(NOW - (i + 1) * 7 * HOUR),
  }));

  return {
    now: FIXTURE_NOW,
    stages,
    taxonomy,
    organisations,
    sites,
    signals,
    alerts,
    deliveries,
    drivers,
    projects,
    deals,
    relationships,
    engagement,
    events,
    proposals,
    evidence,
    sources,
    briefVersion: 2,
    knownGaps: brief.known_gaps,
    briefs,
    quarantine,
  };
}

// Run this file to write the small dataset: pnpm --filter @strata/web fixtures
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = join(dirname(fileURLToPath(import.meta.url)), "small-dataset.json");
  writeFileSync(out, `${JSON.stringify(buildDataset({ signals: 60, deals: 24 }), null, 1)}\n`);
  console.log(`dataset: wrote ${out}`);
}
