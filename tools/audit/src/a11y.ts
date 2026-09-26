// Accessibility baseline: axe on each audited view (docs/01-audit.md, "Accessibility baseline").
// a11y.json is the baseline that docs/07-frontend.md, quality floor 3, compares against.

import { AxeBuilder } from '@axe-core/playwright';
import { gotoView, type View } from './crawl.js';
import type { Gaps } from './gaps.js';
import type { Session } from './login.js';
import { errorText, mdTable, type Output } from './util.js';

export interface A11yView {
  view: string;
  url: string;
  violations: { id: string; impact: string | null; help: string; helpUrl: string; nodes: number; targets: string[] }[];
  incomplete: number;
  passes: number;
  axeVersion: string;
}

export async function auditA11y(s: Session, gaps: Gaps, views: View[]): Promise<A11yView[]> {
  const results: A11yView[] = [];
  for (const v of views) {
    try {
      s.guard.setActivity(`a11y ${v.name}`);
      await gotoView(s.page, v.url);
      const r = await new AxeBuilder({ page: s.page }).exclude('[data-sa-ignore]').analyze();
      results.push({
        view: v.name,
        url: v.displayUrl,
        violations: r.violations.map((x) => ({
          id: x.id,
          impact: x.impact ?? null,
          help: x.help,
          helpUrl: x.helpUrl,
          nodes: x.nodes.length,
          // Targets are CSS selectors. The HTML of the nodes is not kept, because it can hold live data.
          targets: x.nodes.slice(0, 5).map((n) => n.target.join(' ')),
        })),
        incomplete: r.incomplete.length,
        passes: r.passes.length,
        axeVersion: r.testEngine.version,
      });
    } catch (e) {
      gaps.add('a11y', v.name, `axe failed: ${errorText(e)}`);
    }
  }
  return results;
}

export function writeA11y(out: Output, results: A11yView[]): void {
  out.writeJson('a11y.json', { generated: new Date().toISOString(), views: results });
  const lines = ['# Accessibility baseline (axe)', '', 'Strata must not add an issue that this baseline does not have (docs/07-frontend.md, quality floor 3).', ''];
  lines.push(
    mdTable(
      ['View', 'Violations', 'Critical', 'Serious', 'Moderate', 'Minor', 'Incomplete', 'Passes'],
      results.map((r) => {
        const by = (i: string) => r.violations.filter((v) => v.impact === i).length;
        return [r.view, r.violations.length, by('critical'), by('serious'), by('moderate'), by('minor'), r.incomplete, r.passes];
      }),
    ),
  );
  for (const r of results) {
    lines.push(`## ${r.view}`, '');
    if (!r.violations.length) lines.push('No violations.', '');
    else lines.push(mdTable(['Rule', 'Impact', 'Nodes', 'Help', 'Example targets'], r.violations.map((v) => [v.id, v.impact ?? '', v.nodes, `[${v.help}](${v.helpUrl})`, v.targets.slice(0, 3).join(' ; ')])));
  }
  out.writeText('a11y.md', lines.join('\n'));
}
