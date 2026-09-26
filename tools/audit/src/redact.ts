// Redaction of secrets and personal data before any text leaves the process.
// Every file writer and the logger call scrub(). Screenshots use masks instead (see mask.ts).

const registered = new Set<string>();

/** Register a secret value (for example the password). scrub() replaces it and its encoded forms. */
export function registerSecret(value: string | undefined): void {
  if (!value || value.length < 3) return;
  const forms = new Set<string>([value]);
  forms.add(encodeURIComponent(value));
  forms.add(JSON.stringify(value).slice(1, -1));
  forms.add(Buffer.from(value, 'utf8').toString('base64').replace(/=+$/, ''));
  for (const f of forms) if (f.length >= 3) registered.add(f);
}

export function registeredSecretCount(): number {
  return registered.size;
}

export function clearSecrets(): void {
  registered.clear();
}

const PATTERNS: [RegExp, string][] = [
  // Private key blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED:private-key]'],
  // JSON Web Tokens
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED:jwt]'],
  // Mapbox style tokens
  [/\b(?:pk|sk|tk)\.eyJ[A-Za-z0-9_.-]{10,}/g, '[REDACTED:map-token]'],
  // Well known key formats
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED:google-key]'],
  [/\bxox[abprs]-[0-9A-Za-z-]{10,}/g, '[REDACTED:slack-token]'],
  [/\bgh[pousr]_[0-9A-Za-z]{30,}\b/g, '[REDACTED:github-token]'],
  [/\b(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{10,}\b/g, '[REDACTED:stripe-key]'],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED:api-key]'],
  // Credentials inside URLs, for example Sentry DSNs
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@"']+(?::[^\s/@"']*)?@/gi, '$1[REDACTED]@'],
  // Authorization header values
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [REDACTED]'],
  // key=value or "key": "value" assignments with secret-like names
  [
    /((?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth|authorization|access[_-]?key|client[_-]?secret|session[_-]?id|dsn)["']?\s*[:=]\s*["']?)([^"'\s,&;}{]{6,})/gi,
    '$1[REDACTED]',
  ],
  // E-mail addresses (personal data)
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
];

export function scrub(text: string): string {
  let out = text;
  // Longest first, so that a value that contains another value is replaced whole.
  for (const s of [...registered].sort((a, b) => b.length - a.length)) {
    out = out.split(s).join('[REDACTED]');
  }
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Scrub every string (keys and values) in a JSON-like value. */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrub(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[scrub(k)] = scrubDeep(v);
    return out as T;
  }
  return value;
}

/**
 * Make a URL safe to record: drop user info and fragment secrets, keep query parameter names only.
 * Hash routes (#/path) are kept because single page applications use them for views.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    const names = [...new Set([...u.searchParams.keys()])];
    u.search = '';
    let hash = u.hash;
    if (hash && !hash.startsWith('#/')) hash = '';
    if (hash.includes('?')) hash = hash.slice(0, hash.indexOf('?'));
    const base = `${u.origin}${u.pathname}`;
    const query = names.length ? `?${names.map((n) => `${n}=…`).join('&')}` : '';
    return scrub(`${base}${query}${hash}`);
  } catch {
    return scrub(raw.split('?')[0] ?? '');
  }
}

/** Path with numeric and id-like segments replaced, for grouping similar requests. */
export function endpointPattern(raw: string): string {
  try {
    const u = new URL(raw);
    const p = u.pathname
      .split('/')
      .map((seg) =>
        /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{24,}$/.test(seg)
          ? ':id'
          : seg,
      )
      .join('/');
    return scrub(`${u.origin}${p}`);
  } catch {
    return scrub(raw);
  }
}
