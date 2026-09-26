import type { Output } from './util.js';
import { mdTable } from './util.js';

export type GapCategory =
  | 'view-sensitive'
  | 'view-needs-write'
  | 'view-error'
  | 'component-state'
  | 'component-missing'
  | 'layout-interaction'
  | 'behaviour'
  | 'tokens'
  | 'stack'
  | 'a11y'
  | 'tool';

export interface Gap {
  category: GapCategory;
  name: string;
  reason: string;
}

/** Views, states and outputs that the audit could not capture. For sensitive pages, the name only. */
export class Gaps {
  readonly items: Gap[] = [];

  add(category: GapCategory, name: string, reason: string): void {
    if (this.items.some((g) => g.category === category && g.name === name && g.reason === reason)) return;
    this.items.push({ category, name, reason });
  }

  has(category: GapCategory, name: string): boolean {
    return this.items.some((g) => g.category === category && g.name === name);
  }

  write(out: Output): void {
    const lines = [
      '# Audit gaps',
      '',
      'This file lists the views, states and outputs that the audit did not capture, with the reason.',
      'For a page that can show credentials, API keys, billing data or personal data, the file gives the page name only.',
      '',
    ];
    if (!this.items.length) lines.push('No gaps.', '');
    else lines.push(mdTable(['Category', 'Name', 'Reason'], this.items.map((g) => [g.category, g.name, g.reason])));
    out.writeText('gaps.md', lines.join('\n'));
    out.writeJson('gaps.json', this.items);
  }
}
