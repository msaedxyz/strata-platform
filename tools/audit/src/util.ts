import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { scrub, scrubDeep } from './redact.js';

/** All audit output goes through this class, so that every text file is scrubbed. */
export class Output {
  constructor(readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  path(rel: string): string {
    const p = path.resolve(this.root, rel);
    if (!p.startsWith(path.resolve(this.root))) throw new Error(`Output path escapes the audit directory: ${rel}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
  }

  writeText(rel: string, text: string): string {
    const p = this.path(rel);
    fs.writeFileSync(p, scrub(text));
    return p;
  }

  writeJson(rel: string, value: unknown): string {
    const p = this.path(rel);
    fs.writeFileSync(p, `${JSON.stringify(scrubDeep(value), null, 2)}\n`);
    return p;
  }

  readJson<T>(rel: string): T | undefined {
    const p = path.resolve(this.root, rel);
    if (!fs.existsSync(p)) return undefined;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  }

  exists(rel: string): boolean {
    return fs.existsSync(path.resolve(this.root, rel));
  }

  remove(rel: string): void {
    fs.rmSync(path.resolve(this.root, rel), { recursive: true, force: true });
  }

  /** Relative path for links inside Markdown files at the audit root. */
  rel(p: string): string {
    return path.relative(this.root, p).split(path.sep).join('/');
  }
}

export function log(...parts: unknown[]): void {
  const text = parts.map((p) => (p instanceof Error ? p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  process.stdout.write(`${scrub(text)}\n`);
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Playwright call logs can be long. Keep the first lines only.
  return scrub(msg.split('\n').slice(0, 3).join(' ').slice(0, 400));
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'root';
}

export function mdEscape(s: unknown): string {
  return String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

export function mdTable(headers: string[], rows: unknown[][]): string {
  const head = `| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|\n`;
  return head + rows.map((r) => `| ${r.map(mdEscape).join(' | ')} |`).join('\n') + (rows.length ? '\n' : '');
}

export function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    const k = key(i);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

const INPAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'inpage');
const inpageCache = new Map<string, string>();

/**
 * Run a plain JavaScript function from src/inpage/<name>.js in the page.
 * The in-page code is plain JavaScript so that no transpiler helper leaks into the browser.
 */
export async function inPage<T>(page: Page, name: string, arg: unknown = {}): Promise<T> {
  let src = inpageCache.get(name);
  if (!src) {
    src = fs.readFileSync(path.join(INPAGE_DIR, `${name}.js`), 'utf8').trim().replace(/;\s*$/, '');
    inpageCache.set(name, src);
  }
  return (await page.evaluate(`(${src})(${JSON.stringify(arg)})`)) as T;
}
