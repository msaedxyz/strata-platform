import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Fake credentials for the mock site. They are made at run time, so no credential-like value is in a file.
 * The values are long and unique, so that a search of the outputs for them is reliable.
 */
export function fakeCredentials(): { username: string; password: string } {
  return { username: `mockuser${randomUUID().replace(/-/g, '').slice(0, 12)}`, password: `mockpass-${randomUUID()}` };
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/** Every encoded form of a secret that could appear in a file. */
export function secretForms(secret: string): string[] {
  return [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64').replace(/=+$/, '')];
}
