// Runtime evidence of the frontend stack: globals, DOM markers and the React renderer version.
function (arg) {
  const w = window;
  const out = { globals: {}, markers: {}, renderers: w.__saRenderers || [], scripts: [], meta: {} };
  function ver(o, k) { try { return o && o[k] ? String(o[k]) : null; } catch (e) { return null; } }
  const g = {
    React: ver(w.React, 'version'),
    Vue: w.__VUE__ ? 'present' : ver(w.Vue, 'version'),
    svelte: w.__svelte && w.__svelte.v ? Array.from(w.__svelte.v).join(',') : null,
    angular: (document.querySelector('[ng-version]') || { getAttribute: function () { return null; } }).getAttribute('ng-version'),
    jQuery: w.jQuery && w.jQuery.fn ? ver(w.jQuery.fn, 'jquery') : null,
    echarts: ver(w.echarts, 'version'),
    Highcharts: ver(w.Highcharts, 'version'),
    d3: ver(w.d3, 'version'),
    Chart: ver(w.Chart, 'version'),
    L: ver(w.L, 'version'),
    maplibregl: ver(w.maplibregl, 'version'),
    mapboxgl: ver(w.mapboxgl, 'version'),
    io: w.io ? (ver(w.io, 'protocol') || 'present') : null,
    agGrid: w.agGrid ? 'present' : null,
    LightweightCharts: w.LightweightCharts ? (ver(w.LightweightCharts, 'version') || 'present') : null,
    next: w.__NEXT_DATA__ ? 'present' : null,
    nuxt: w.__NUXT__ ? 'present' : null,
    remix: w.__remixContext ? 'present' : null,
    sentry: w.__SENTRY__ ? 'present' : null
  };
  for (const k of Object.keys(g)) if (g[k]) out.globals[k] = g[k];
  const markers = {
    'react-root': !!(document.querySelector('[data-reactroot]') || Array.from(document.querySelectorAll('body > *')).some(function (e) { return Object.keys(e).some(function (k) { return k.indexOf('__reactContainer') === 0 || k.indexOf('_reactRootContainer') === 0; }); })),
    'vue-scoped': !!document.querySelector('[data-v-app], [class*="v-"][data-v-]'),
    'svelte-class': !!document.querySelector('[class*="svelte-"]'),
    'react-grid-layout': !!document.querySelector('.react-grid-layout'),
    'react-resizable': !!document.querySelector('.react-resizable-handle'),
    'ag-grid': !!document.querySelector('.ag-root, .ag-theme-alpine, [class*="ag-theme"]'),
    'tanstack-table': !!document.querySelector('[data-tanstack], [class*="tanstack"]'),
    'recharts': !!document.querySelector('.recharts-wrapper'),
    'echarts': !!document.querySelector('[_echarts_instance_]'),
    'lightweight-charts': !!document.querySelector('.tv-lightweight-charts'),
    'highcharts': !!document.querySelector('.highcharts-container'),
    'chartjs': !!document.querySelector('canvas[role="img"][aria-label]'),
    'd3-svg': !!document.querySelector('svg g.tick, svg .domain'),
    'maplibre': !!document.querySelector('.maplibregl-map'),
    'mapbox': !!document.querySelector('.mapboxgl-map'),
    'leaflet': !!document.querySelector('.leaflet-container'),
    'tailwind-like-classes': !!document.querySelector('[class*="px-"][class*="py-"], [class*="flex "][class*="items-center"]'),
    'radix': !!document.querySelector('[data-radix-popper-content-wrapper], [data-radix-collection-item], [data-state][data-orientation]'),
    'headlessui': !!document.querySelector('[id^="headlessui-"]'),
    'mui': !!document.querySelector('[class*="MuiButton"], [class*="Mui"]'),
    'antd': !!document.querySelector('[class*="ant-"]'),
    'chakra': !!document.querySelector('[class*="chakra-"]'),
    'mantine': !!document.querySelector('[class*="mantine-"]'),
    'cmdk': !!document.querySelector('[cmdk-root]'),
    'styled-components': !!document.querySelector('style[data-styled]'),
    'emotion': !!document.querySelector('style[data-emotion]')
  };
  for (const k of Object.keys(markers)) if (markers[k]) out.markers[k] = true;
  out.scripts = Array.from(document.scripts).map(function (s) { return { src: s.src || 'inline', type: s.type || '', module: s.type === 'module', length: s.src ? 0 : (s.textContent || '').length }; }).slice(0, 60);
  document.querySelectorAll('meta[name="generator"], meta[name="framework"], meta[name="version"], meta[name="application-name"]').forEach(function (m) { out.meta[m.getAttribute('name')] = m.getAttribute('content'); });
  return out;
}
