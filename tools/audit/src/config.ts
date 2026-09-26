import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface Viewport {
  width: number;
  height: number;
}

// The shape of config/audit.config.json. Only the fields that code reads are typed.
export interface AuditConfig {
  viewports: Viewport[];
  primaryViewport: Viewport;
  crawl: { maxRoutes: number; maxDepth: number; settleMs: number; navTimeoutMs: number; menuSettleMs: number };
  behaviour: {
    observeMs: number;
    tickerSampleMs: number;
    tickerHoverSampleMs: number;
    maxTabStops: number;
    keySettleMs: number;
    commandQueries: string[];
    safeKeys: string[];
    gChordLetters: string;
    pollingMinRepeats: number;
  };
  components: {
    maxInstancesPerComponent: number;
    screenshotPadding: number;
    loadingWatchMs: number;
    definitions: Record<string, string[]>;
    stateSelectors: Record<string, string[]>;
    emptyTextPatterns: string[];
    stateContainers: string[];
  };
  layout: {
    gridSelectors: string[];
    itemSelectors: string[];
    dragHandleSelectors: string[];
    resizeHandleSelectors: string[];
    placeholderSelectors: string[];
    candidateColumns: number[];
    rowHeightRange: [number, number];
    rowHeightGuessMin: number;
    dragSteps: number;
    interactionSettleMs: number;
    interactions: Record<string, string>;
  };
  safety: {
    allowedMethods: string[];
    denyPatterns: string[];
    logoutPatterns: string[];
    panelViewPatterns: string[];
    layoutClosePatterns: string[];
    layoutAddPatterns: string[];
    wsProtocolActions: string[];
    loginRequestPatterns: string[];
    logoutRequestPatterns: string[];
    wsActionKeys: string[];
  };
  sensitive: { urlPatterns: string[]; textPatterns: string[]; emailCountThreshold: number };
  tokens: {
    neutralSaturationMax: number;
    stateSaturationMin: number;
    stateLightnessRange: [number, number];
    surfaceLuminanceWindow: number;
    minTextShare: number;
    spaceKeys: number[];
    spaceUnitCandidates: number[];
    spaceUnitMinShare: number;
    spacingMaxPx: number;
    hueBuckets: Record<string, [number, number][]>;
    monoFamilyPattern: string;
    iconPrefixes: string[];
  };
  gitleaks: { image: string };
}

let cached: AuditConfig | undefined;

/** Load the audit configuration. AUDIT_CONFIG_OVERRIDES may hold a JSON object that is merged on top (tests use it). */
export function loadConfig(): AuditConfig {
  if (cached) return cached;
  const file = process.env.AUDIT_CONFIG_FILE ?? path.join(TOOL_ROOT, 'config', 'audit.config.json');
  const base = JSON.parse(fs.readFileSync(file, 'utf8')) as AuditConfig;
  const overrides = process.env.AUDIT_CONFIG_OVERRIDES ? JSON.parse(process.env.AUDIT_CONFIG_OVERRIDES) : {};
  cached = deepMerge(base, overrides) as AuditConfig;
  return cached;
}

function deepMerge(a: unknown, b: unknown): unknown {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b === undefined ? a : b;
  if (typeof a !== 'object' || a === null || Array.isArray(a)) return b;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = deepMerge(out[k], v);
  return out;
}

export interface Credentials {
  url: string;
  username: string;
  password: string;
}

/** Read the credentials from the environment only. Never log the return value. */
export function readCredentials(): Credentials | { missing: string[] } {
  const missing = ['INFORA_URL', 'INFORA_USERNAME', 'INFORA_PASSWORD'].filter((k) => !process.env[k]);
  if (missing.length) return { missing };
  return {
    url: process.env.INFORA_URL as string,
    username: process.env.INFORA_USERNAME as string,
    password: process.env.INFORA_PASSWORD as string,
  };
}

/** Find the repository root: the nearest parent directory with a .git entry. */
export function findRepoRoot(start = TOOL_ROOT): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(TOOL_ROOT, '..', '..');
    dir = parent;
  }
}

export function outputDir(): string {
  return path.resolve(process.env.AUDIT_OUT_DIR ?? path.join(findRepoRoot(), 'audit'));
}

export function viewportName(v: Viewport): string {
  return `${v.width}x${v.height}`;
}
