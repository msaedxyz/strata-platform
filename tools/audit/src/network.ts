// network.md: each request that is not GET, with endpoint and purpose, and the criterion 6 assertion.

import type { NetworkGuard, RequestEntry } from './guard.js';
import { countBy, mdTable, type Output } from './util.js';

export function purposeGuess(e: RequestEntry): string {
  const p = e.endpoint.toLowerCase();
  if (e.outcome === 'allowed-login') return 'Guess: login (sends the credentials or completes the sign-in)';
  if (e.outcome === 'allowed-logout') return 'Guess: log out at the end of the audit session';
  const hints: [RegExp, string][] = [
    [/telemetry|analytics|track|collect|events?\b|beacon|metrics|rum|log/, 'telemetry or analytics'],
    [/layout|workspace|dashboard|panel|widget/, 'save a layout or workspace'],
    [/pref|setting|config/, 'save a preference or setting'],
    [/graphql/, 'GraphQL operation (can be a read)'],
    [/search|query/, 'search (a read sent with POST)'],
    [/save|update|create|delete|remove/, 'change data'],
    [/sentry|bugsnag|error/, 'error reporting'],
  ];
  for (const [re, label] of hints) if (re.test(p)) return `Guess: ${label}`;
  return 'Guess: unknown';
}

export function writeNetwork(out: Output, guard: NetworkGuard): { pass: boolean; offending: RequestEntry[] } {
  const c6 = guard.criterion6();
  const nonGet = guard.nonGet();
  const lines = [
    '# Network',
    '',
    'The audit blocks each request that is not GET or HEAD in the browser, except the login request(s) and the final log out.',
    'Each such request is listed below. Blocked requests did not reach the server.',
    'Request bodies are never logged. Query values are removed from URLs.',
    '',
    `## Criterion 6: ${c6.pass ? 'PASS' : 'FAIL'}`,
    '',
    c6.pass
      ? 'No request that changes data reached the server, other than the login request(s) and the final log out.'
      : `These requests reached the server and are not login or log out requests: ${c6.offending.map((e) => `${e.method} ${e.endpoint}`).join('; ')}`,
    '',
    '## Requests that are not GET',
    '',
  ];
  if (!nonGet.length) lines.push('None.', '');
  else {
    lines.push(
      mdTable(
        ['Time (ms)', 'Phase', 'Activity', 'Method', 'Endpoint', 'Type', 'Outcome', 'Status', 'Purpose'],
        nonGet.map((e) => [Math.round(e.t), e.phase, e.activity, e.method, e.endpoint, e.resourceType, e.outcome, e.status ?? e.failure ?? '', purposeGuess(e)]),
      ),
    );
  }
  lines.push('## WebSocket connections', '');
  if (!guard.websockets.length) lines.push('None.', '');
  else {
    lines.push(
      mdTable(
        ['URL', 'Opened during', 'Frames sent', 'Frames received', 'Frames blocked', 'Sent frame shapes'],
        guard.websockets.map((w) => [w.url, w.activity, w.sent, w.received, w.blockedSent.length, Object.entries(w.sentActions).map(([k, n]) => `${k} x${n}`).join('; ')]),
      ),
    );
    const blocked = guard.websockets.flatMap((w) => w.blockedSent.map((b) => `${w.url}: ${b.reason}`));
    if (blocked.length) lines.push('Blocked frames:', '', ...blocked.slice(0, 50).map((b) => `- ${b}`), '');
  }
  lines.push('## All requests by type', '');
  const byType = countBy(guard.entries, (e) => `${e.method} ${e.resourceType}`);
  lines.push(mdTable(['Method and type', 'Count'], Object.entries(byType).sort((a, b) => b[1] - a[1])));
  const hosts = countBy(guard.entries, (e) => {
    try {
      return new URL(e.url).host;
    } catch {
      return 'unknown';
    }
  });
  lines.push('## Hosts', '', mdTable(['Host', 'Requests'], Object.entries(hosts).sort((a, b) => b[1] - a[1])));
  out.writeText('network.md', lines.join('\n'));
  out.writeJson('network.json', {
    criterion6: { pass: c6.pass, offending: c6.offending.map((e) => `${e.method} ${e.endpoint}`) },
    nonGet: nonGet.map((e) => ({ ...e, purpose: purposeGuess(e) })),
    websockets: guard.websockets.map((w) => ({ url: w.url, sent: w.sent, received: w.received, blocked: w.blockedSent.length })),
    requestCount: guard.entries.length,
  });
  return { pass: c6.pass, offending: c6.offending };
}
