// Reads the Infora audit component list (audit/components.md) and the screenshots (audit/components/<component>/<state>.png).
// The visual parity test (docs/07 criterion 2) uses this list. It does not use the Strata inventory.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const AUDIT_DIR = join(REPO_ROOT, "audit");
export const COMPONENTS_MD = join(AUDIT_DIR, "components.md");
export const COMPONENTS_DIR = join(AUDIT_DIR, "components");
export const BLOCKED_MESSAGE = "blocked: no Infora audit (beta.infora.io unreachable)";

export interface AuditState {
  component: string;
  state: string;
  /** The Storybook story id, for example "button--hover". */
  storyId: string;
  /** Screenshot path for a viewport, or the general screenshot. */
  screenshot: (viewport: string) => string | null;
  /** Optional mask rectangles from the audit: audit/components/<component>/<state>.mask.json. */
  maskFile: string;
}

export const slug = (s: string) =>
  s
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

/** Parse components.md. It accepts headings with a "States:" line, or a table with a Component and a States column. */
export function parseComponentsMarkdown(text: string): Array<{ component: string; states: string[] }> {
  const out: Array<{ component: string; states: string[] }> = [];
  const lines = text.split(/\r?\n/);
  let current: string | null = null;
  let tableCols: { component: number; states: number } | null = null;
  const split = (s: string) =>
    s
      .split(/[,;]/)
      .map((x) => x.replace(/[`*_]/g, "").trim())
      .filter(Boolean);

  for (const line of lines) {
    const heading = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1]!.replace(/[`*_]/g, "").trim();
      tableCols = null;
      continue;
    }
    const statesLine = /^\s*[-*]?\s*\**states\**\s*:\s*(.+)$/i.exec(line);
    if (statesLine && current) {
      out.push({ component: current, states: split(statesLine[1]!) });
      continue;
    }
    if (line.trim().startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (!tableCols) {
        const lower = cells.map((c) => c.toLowerCase());
        const component = lower.findIndex((c) => c === "component" || c === "name");
        const states = lower.findIndex((c) => c.startsWith("state"));
        if (component >= 0 && states >= 0) tableCols = { component, states };
        continue;
      }
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      const component = cells[tableCols.component]?.replace(/[`*_]/g, "").trim();
      const states = cells[tableCols.states];
      if (component && states) out.push({ component, states: split(states) });
    } else if (tableCols && line.trim() === "") {
      tableCols = null;
    }
  }
  return out;
}

function componentMap(): Record<string, string> {
  const file = join(dirname(fileURLToPath(import.meta.url)), "component-map.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).map as Record<string, string>) : {};
}

function screenshotFinder(component: string, state: string) {
  const dirs = [join(COMPONENTS_DIR, component), join(COMPONENTS_DIR, slug(component))];
  const names = [state, slug(state)];
  return (viewport: string): string | null => {
    for (const d of dirs) {
      for (const n of names) {
        for (const f of [`${n}@${viewport}.png`, join(viewport, `${n}.png`), `${n}.png`]) {
          const p = join(d, f);
          if (existsSync(p)) return p;
        }
      }
    }
    return null;
  };
}

export function readAudit(): { available: false; reason: string } | { available: true; states: AuditState[] } {
  if (!existsSync(COMPONENTS_MD) && !existsSync(COMPONENTS_DIR)) return { available: false, reason: BLOCKED_MESSAGE };
  let entries: Array<{ component: string; states: string[] }> = [];
  if (existsSync(COMPONENTS_MD)) entries = parseComponentsMarkdown(readFileSync(COMPONENTS_MD, "utf8"));
  if (entries.length === 0 && existsSync(COMPONENTS_DIR)) {
    entries = readdirSync(COMPONENTS_DIR)
      .filter((d) => statSync(join(COMPONENTS_DIR, d)).isDirectory())
      .map((d) => ({
        component: d,
        states: readdirSync(join(COMPONENTS_DIR, d))
          .filter((f) => f.endsWith(".png"))
          .map((f) => f.replace(/(@\d+x\d+)?\.png$/, "")),
      }));
  }
  if (entries.length === 0) return { available: false, reason: `${BLOCKED_MESSAGE}: audit/components.md lists no component` };
  const map = componentMap();
  const states: AuditState[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    for (const state of e.states) {
      const key = `${e.component}/${state}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const title = map[e.component] ?? e.component;
      states.push({
        component: e.component,
        state,
        storyId: `${slug(title)}--${slug(state)}`,
        screenshot: screenshotFinder(e.component, state),
        maskFile: join(COMPONENTS_DIR, slug(e.component), `${slug(state)}.mask.json`),
      });
    }
  }
  return { available: true, states };
}
