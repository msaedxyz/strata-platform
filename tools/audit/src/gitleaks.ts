// Criterion 5: a gitleaks scan of the audit directory gives zero findings.
// Uses GITLEAKS_BIN or a gitleaks binary on PATH. If there is none, it uses the Docker image from the configuration.
// The report is redacted (--redact) and only the rule ids and file names are kept.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { loadConfig } from './config.js';

export interface GitleaksResult {
  status: 'pass' | 'fail' | 'not-run';
  findings: { rule: string; file: string; line: number }[];
  tool: string;
  detail: string;
}

function parse(stdout: string, root: string): GitleaksResult['findings'] {
  const text = stdout.trim();
  if (!text) return [];
  const start = text.indexOf('[');
  const json = JSON.parse(start >= 0 ? text.slice(start) : text) as { RuleID: string; File: string; StartLine: number }[];
  return json.map((f) => ({ rule: f.RuleID, file: path.relative(root, f.File.replace(/^\/tmp\/scan\/?/, `${root}/`)) || f.File, line: f.StartLine }));
}

function hasBinary(bin: string): boolean {
  const r = spawnSync(bin, ['version'], { encoding: 'utf8' });
  return r.status === 0;
}

export function runGitleaks(dir: string): GitleaksResult {
  const cfg = loadConfig();
  const args = ['--no-banner', '--redact', '--report-format', 'json', '--report-path', '-', '--exit-code', '0', '--log-level', 'error'];
  const bin = process.env.GITLEAKS_BIN ?? 'gitleaks';
  if (process.env.AUDIT_GITLEAKS !== 'docker' && hasBinary(bin)) {
    let r = spawnSync(bin, ['dir', dir, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0 && /unknown command/i.test(r.stderr ?? '')) {
      r = spawnSync(bin, ['detect', '--no-git', '--source', dir, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    }
    if (r.status !== 0) return { status: 'not-run', findings: [], tool: bin, detail: `gitleaks exited with ${r.status}: ${(r.stderr ?? '').slice(0, 300)}` };
    const findings = parse(r.stdout, dir);
    return { status: findings.length ? 'fail' : 'pass', findings, tool: `${bin} (binary)`, detail: '' };
  }
  if (process.env.AUDIT_GITLEAKS === 'off') return { status: 'not-run', findings: [], tool: 'none', detail: 'AUDIT_GITLEAKS=off' };
  const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (docker.status !== 0) return { status: 'not-run', findings: [], tool: 'none', detail: 'no gitleaks binary and no Docker daemon' };
  const tar = spawnSync('tar', ['-C', dir, '-cf', '-', '.'], { maxBuffer: 2 * 1024 * 1024 * 1024 });
  if (tar.status !== 0) return { status: 'not-run', findings: [], tool: 'docker', detail: 'tar failed' };
  const script = `mkdir -p /tmp/scan && tar -xf - -C /tmp/scan && gitleaks dir /tmp/scan ${args.join(' ')}`;
  const r = spawnSync('docker', ['run', '-i', '--rm', '--network', 'none', '--entrypoint', 'sh', cfg.gitleaks.image, '-c', script], {
    input: tar.stdout,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) return { status: 'not-run', findings: [], tool: `docker ${cfg.gitleaks.image}`, detail: `exit ${r.status}: ${r.stderr.toString().slice(0, 300)}` };
  const findings = parse(r.stdout.toString(), dir);
  return { status: findings.length ? 'fail' : 'pass', findings, tool: `docker ${cfg.gitleaks.image}`, detail: '' };
}
