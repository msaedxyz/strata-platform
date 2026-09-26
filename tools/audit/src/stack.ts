// Frontend stack and versions (docs/01-audit.md, "Stack").
// Evidence: runtime globals and DOM markers, script URLs, bundle contents and licence banners,
// public source maps (package names and pnpm versions), and response headers.

import type { Page } from '@playwright/test';
import type { Gaps } from './gaps.js';
import type { NetworkGuard } from './guard.js';
import { redactUrl } from './redact.js';
import { errorText, inPage, mdTable, type Output } from './util.js';

interface Signature {
  area: string;
  name: string;
  detect: RegExp;
  version?: RegExp[];
}

const SIGNATURES: Signature[] = [
  { area: 'Framework', name: 'react-dom', detect: /react-dom|__reactFiber|reconcilerVersion|rendererPackageName/, version: [/reconcilerVersion:\s*"(\d+\.\d+\.\d+[^"]*)"/, /version:\s*"(\d+\.\d+\.\d+[^"]*)",\s*rendererPackageName:\s*"react-dom"/] },
  { area: 'Framework', name: 'react', detect: /react\.(?:production|development)|__SECRET_INTERNALS|react\.element|react\.transitional\.element/, version: [/\.version\s*=\s*"(1[6-9]\.\d+\.\d+[^"]*)"/] },
  { area: 'Framework', name: 'vue', detect: /__VUE__|createApp\(|vue\.runtime/, version: [/version:\s*"(3\.\d+\.\d+)"/] },
  { area: 'Framework', name: 'svelte', detect: /svelte\/internal|__svelte/, version: [/__svelte[^;]{0,40}\.add\("(\d+)"\)/] },
  { area: 'Framework', name: 'angular', detect: /@angular\/core|ng-version/, version: [/new Version\("(\d+\.\d+\.\d+)"\)/] },
  { area: 'Framework', name: 'next.js', detect: /__NEXT_DATA__|next\/dist|_next\/static/ },
  { area: 'Framework', name: 'solid-js', detect: /solid-js|createSignal/ },
  { area: 'State', name: 'zustand', detect: /zustand|\[DEPRECATED\] Default export is deprecated\. Instead use `import \{ create \}/ },
  { area: 'State', name: 'redux', detect: /@@redux\/INIT|__REDUX_DEVTOOLS_EXTENSION/ },
  { area: 'State', name: 'redux-toolkit', detect: /@reduxjs\/toolkit|serializableCheck|immutableCheck/ },
  { area: 'State', name: 'jotai', detect: /jotai|atomWithStorage|useAtomValue/ },
  { area: 'State', name: 'mobx', detect: /\bmobx\b|makeAutoObservable/ },
  { area: 'State', name: 'valtio', detect: /valtio/ },
  { area: 'Data fetching', name: '@tanstack/react-query', detect: /@tanstack\/query|QueryClientProvider|queryCache|refetchOnWindowFocus/ },
  { area: 'Data fetching', name: 'swr', detect: /\bswr\b|useSWR/ },
  { area: 'Data fetching', name: 'apollo', detect: /ApolloClient|@apollo\/client/ },
  { area: 'Data fetching', name: 'urql', detect: /urql/ },
  { area: 'Data grid', name: '@tanstack/table', detect: /getCoreRowModel|@tanstack\/table|getSortedRowModel/ },
  { area: 'Data grid', name: 'ag-grid', detect: /ag-grid|AG Grid|agGrid/, version: [/AG Grid[^"]{0,20}v?(\d+\.\d+\.\d+)/, /ag-grid-community[^"]{0,40}?(\d+\.\d+\.\d+)/] },
  { area: 'Data grid', name: 'react-virtual / virtuoso', detect: /react-virtuoso|useVirtualizer|@tanstack\/virtual/ },
  { area: 'Charts', name: 'echarts', detect: /echarts|_echarts_instance_/, version: [/echarts[^]{0,80}?version\s*[:=]\s*"(\d+\.\d+\.\d+)"/] },
  { area: 'Charts', name: 'lightweight-charts', detect: /lightweight-charts|Lightweight Charts|tv-lightweight-charts/, version: [/Lightweight Charts(?:™)? v(\d+\.\d+\.\d+)/] },
  { area: 'Charts', name: 'recharts', detect: /recharts/ },
  { area: 'Charts', name: 'highcharts', detect: /Highcharts/, version: [/Highcharts JS v(\d+\.\d+\.\d+)/] },
  { area: 'Charts', name: 'chart.js', detect: /Chart\.js|chartjs/, version: [/Chart\.js v(\d+\.\d+\.\d+)/] },
  { area: 'Charts', name: 'd3', detect: /\bd3-(?:scale|selection|shape|array)\b|d3\.v\d/, version: [/d3[^]{0,20}version\s*=\s*"(\d+\.\d+\.\d+)"/] },
  { area: 'Charts', name: 'visx', detect: /@visx/ },
  { area: 'Charts', name: 'uplot', detect: /uPlot/ },
  { area: 'Maps', name: 'maplibre-gl', detect: /maplibre/i, version: [/maplibre-gl[^"]{0,40}?(\d+\.\d+\.\d+)/i, /version:\s*"(\d+\.\d+\.\d+)"[^]{0,60}maplibre/i] },
  { area: 'Maps', name: 'mapbox-gl', detect: /mapbox-gl|mapboxgl/, version: [/mapbox-gl[^"]{0,40}?v?(\d+\.\d+\.\d+)/] },
  { area: 'Maps', name: 'leaflet', detect: /Leaflet|leaflet-container/, version: [/Leaflet (\d+\.\d+\.\d+)/, /version\s*=\s*"(1\.\d+\.\d+)"[^]{0,40}Leaflet/] },
  { area: 'Maps', name: 'deck.gl', detect: /deck\.gl|@deck\.gl/ },
  { area: 'Maps', name: 'openlayers', detect: /\bol\/|OpenLayers/ },
  { area: 'Grid layout', name: 'react-grid-layout', detect: /react-grid-layout|react-grid-item|react-grid-placeholder/ },
  { area: 'Grid layout', name: 'gridstack', detect: /gridstack/i },
  { area: 'Grid layout', name: 'react-mosaic', detect: /react-mosaic|mosaic-window/ },
  { area: 'Grid layout', name: 'golden-layout / flexlayout', detect: /golden-layout|flexlayout-react|FlexLayout/ },
  { area: 'Live updates', name: 'socket.io', detect: /socket\.io|engine\.io|EIO=/, version: [/socket\.io[^"]{0,30}?(\d+\.\d+\.\d+)/] },
  { area: 'Live updates', name: 'EventSource (SSE)', detect: /new EventSource\(/ },
  { area: 'Live updates', name: 'WebSocket', detect: /new WebSocket\(/ },
  { area: 'Live updates', name: 'graphql-ws', detect: /graphql-ws|connection_init/ },
  { area: 'Live updates', name: 'centrifuge / pusher / ably', detect: /centrifuge|Pusher|ably/i },
  { area: 'Command input', name: 'cmdk', detect: /cmdk-item|cmdk-root|\bcmdk\b/ },
  { area: 'Keyboard', name: 'react-hotkeys-hook / tinykeys / mousetrap', detect: /useHotkeys|tinykeys|Mousetrap/ },
  { area: 'UI kit', name: 'radix-ui', detect: /@radix-ui|data-radix/ },
  { area: 'UI kit', name: 'headless-ui', detect: /headlessui/ },
  { area: 'UI kit', name: 'mui', detect: /@mui\/|MuiButton/ },
  { area: 'UI kit', name: 'mantine', detect: /@mantine|mantine-/ },
  { area: 'Styling', name: 'tailwindcss', detect: /tailwindcss|--tw-/, version: [/tailwindcss v(\d+\.\d+\.\d+)/] },
  { area: 'Styling', name: 'styled-components', detect: /styled-components|data-styled/ },
  { area: 'Styling', name: 'emotion', detect: /@emotion|data-emotion/ },
  { area: 'Icons', name: 'lucide', detect: /lucide/, version: [/lucide[^"]{0,30}v(\d+\.\d+\.\d+)/] },
  { area: 'Icons', name: 'tabler', detect: /tabler-icon|@tabler\/icons/ },
  { area: 'Icons', name: 'phosphor', detect: /phosphor/i },
  { area: 'Build', name: 'vite', detect: /\/@vite\/|__vite__|vite\/modulepreload-polyfill|import\.meta\.env/ },
  { area: 'Build', name: 'webpack', detect: /__webpack_require__|webpackChunk/ },
  { area: 'Build', name: 'turbopack', detect: /TURBOPACK/ },
  { area: 'Monitoring', name: 'sentry', detect: /@sentry\/|__SENTRY__|sentry-trace/ },
  { area: 'Monitoring', name: 'posthog / segment / mixpanel', detect: /posthog|analytics\.js|mixpanel/i },
];

export interface StackReport {
  runtime: Record<string, unknown>;
  detections: { area: string; name: string; evidence: string[]; versions: string[] }[];
  licenceBanners: string[];
  sourceMapPackages: { name: string; versions: string[] }[];
  scripts: string[];
  headers: Record<string, Record<string, string>>;
  cspHosts: string[];
  liveProtocols: string[];
}

export async function auditStack(page: Page, guard: NetworkGuard, gaps: Gaps, liveProtocols: string[]): Promise<StackReport> {
  let runtime: Record<string, unknown> = {};
  try {
    runtime = await inPage<Record<string, unknown>>(page, 'stack-runtime', {});
  } catch (e) {
    gaps.add('stack', 'runtime detection', errorText(e));
  }
  const detections: StackReport['detections'] = [];
  const bodies = [...guard.scriptBodies.entries()];
  for (const sig of SIGNATURES) {
    const evidence: string[] = [];
    const versions = new Set<string>();
    for (const [url, body] of bodies) {
      if (sig.detect.test(body) || sig.detect.test(url)) {
        evidence.push(`bundle ${redactUrl(url).split('/').pop()}`);
        for (const v of sig.version ?? []) {
          const m = body.match(v);
          if (m?.[1]) versions.add(m[1]);
        }
      }
    }
    if (evidence.length) detections.push({ area: sig.area, name: sig.name, evidence: [...new Set(evidence)].slice(0, 4), versions: [...versions] });
  }
  const renderers = (runtime.renderers as { version?: string; pkg?: string }[] | undefined) ?? [];
  for (const r of renderers) {
    const d = detections.find((x) => x.name === (r.pkg ?? 'react-dom'));
    if (d) {
      d.evidence.push('React DevTools hook');
      if (r.version && !d.versions.includes(r.version)) d.versions.unshift(r.version);
    } else detections.push({ area: 'Framework', name: r.pkg ?? 'react renderer', evidence: ['React DevTools hook'], versions: r.version ? [r.version] : [] });
  }
  const globals = (runtime.globals as Record<string, string> | undefined) ?? {};
  for (const [g, v] of Object.entries(globals)) detections.push({ area: 'Runtime global', name: g, evidence: ['window global'], versions: v === 'present' ? [] : [v] });

  // Licence banners: /*! name vX.Y.Z */ or @license name vX.Y.Z
  const banners = new Set<string>();
  for (const [, body] of bodies) {
    for (const m of body.matchAll(/\/\*[!*]?\s*(?:@license\s+)?([@A-Za-z][\w@/.\- ]{1,60}?)\s+v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/g)) {
      if (banners.size < 80) banners.add(`${m[1]?.trim()} ${m[2]}`);
    }
    for (const m of body.matchAll(/@license ([^\n*]{1,80})/g)) if (banners.size < 80) banners.add(m[1]!.trim());
  }

  // Public source maps: package names, and versions from pnpm paths.
  const pkgs = new Map<string, Set<string>>();
  for (const [url, body] of bodies.slice(0, 30)) {
    const sm = body.match(/\/\/# sourceMappingURL=([^\s'"]+)\s*$/);
    if (!sm || sm[1]!.startsWith('data:')) continue;
    try {
      const mapUrl = new URL(sm[1]!, url).href;
      const res = await page.request.get(mapUrl, { timeout: 15000 });
      if (!res.ok()) continue;
      const text = await res.text();
      if (text.length > 60 * 1024 * 1024) continue;
      const map = JSON.parse(text) as { sources?: string[] };
      for (const src of map.sources ?? []) {
        const pn = src.match(/\.pnpm\/((?:@[^/+]+\+)?[^/@]+)@(\d+\.\d+\.\d+[^/_]*)/);
        if (pn) {
          const name = pn[1]!.replace('+', '/');
          if (!pkgs.has(name)) pkgs.set(name, new Set());
          pkgs.get(name)!.add(pn[2]!);
          continue;
        }
        const nm = src.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
        if (nm && !pkgs.has(nm[1]!)) pkgs.set(nm[1]!, new Set());
      }
    } catch {
      // No public source map.
    }
  }

  const cspHosts = new Set<string>();
  for (const h of guard.responseHeaders.values()) {
    const csp = h['content-security-policy'];
    if (!csp) continue;
    for (const m of csp.matchAll(/(?:https?|wss?):\/\/[^\s;]+/g)) cspHosts.add(m[0]);
  }
  const headerKeys = /^(server|x-powered-by|via|x-served-by|x-cache|cf-ray|cf-cache-status|x-vercel-id|x-vercel-cache|x-amz-cf-id|x-amz-cf-pop|x-nf-request-id|fly-request-id|x-render-origin-server|alt-svc|strict-transport-security|x-frame-options|content-security-policy|x-content-type-options|referrer-policy|permissions-policy|x-envoy-upstream-service-time|x-kong-proxy-latency)$/i;
  const headers: Record<string, Record<string, string>> = {};
  for (const [url, h] of [...guard.responseHeaders.entries()].slice(0, 5)) {
    headers[url] = Object.fromEntries(Object.entries(h).filter(([k]) => headerKeys.test(k)).map(([k, v]) => [k, k === 'content-security-policy' ? `${v.slice(0, 200)}…` : v]));
  }
  const scripts = [...new Set([...guard.scriptBodies.keys()].map((u) => redactUrl(u)))];
  return {
    runtime,
    detections,
    licenceBanners: [...banners],
    sourceMapPackages: [...pkgs.entries()].map(([name, v]) => ({ name, versions: [...v] })).sort((a, b) => a.name.localeCompare(b.name)),
    scripts,
    headers,
    cspHosts: [...cspHosts],
    liveProtocols,
  };
}

export function writeStack(out: Output, r: StackReport): void {
  const lines = ['# Frontend stack', '', 'Evidence comes from runtime globals, DOM markers, script bundles, source maps and response headers. A detection from a bundle string is a strong hint, not a proof.', ''];
  const areas = ['Framework', 'State', 'Data fetching', 'Charts', 'Maps', 'Grid layout', 'Data grid', 'Live updates', 'Command input', 'Keyboard', 'UI kit', 'Styling', 'Icons', 'Build', 'Monitoring', 'Runtime global'];
  lines.push('## Summary', '');
  lines.push(
    mdTable(
      ['Area', 'Library', 'Version', 'Evidence'],
      areas.flatMap((a) => r.detections.filter((d) => d.area === a).map((d) => [a, d.name, d.versions.join(', ') || 'not visible', d.evidence.join('; ')])),
    ),
  );
  lines.push(`Live update protocol seen in the network log: ${r.liveProtocols.length ? r.liveProtocols.join(', ') : 'none seen'}.`, '');
  lines.push('## DOM markers', '', Object.keys((r.runtime.markers as Record<string, boolean>) ?? {}).map((k) => `- ${k}`).join('\n') || 'None.', '');
  if (r.sourceMapPackages.length) {
    lines.push('## Packages from public source maps', '', mdTable(['Package', 'Versions'], r.sourceMapPackages.map((p) => [p.name, p.versions.join(', ') || 'not visible'])));
  }
  if (r.licenceBanners.length) lines.push('## Licence and version banners in the bundles', '', ...r.licenceBanners.map((b) => `- ${b}`), '');
  lines.push('## Scripts', '', ...r.scripts.slice(0, 60).map((s) => `- ${s}`), '');
  lines.push('## Response headers (documents)', '');
  for (const [u, h] of Object.entries(r.headers)) {
    lines.push(`### ${u}`, '', mdTable(['Header', 'Value'], Object.entries(h)));
  }
  if (r.cspHosts.length) lines.push('## Hosts in the Content-Security-Policy', '', ...r.cspHosts.map((h) => `- ${h}`), '');
  out.writeText('stack.md', lines.join('\n'));
  out.writeJson('stack.json', r);
}
