import type { NextRequest } from 'next/server';

export function codespaceOrigin(port = process.env.PORT || '3000'): string | null {
  const name = process.env.CODESPACE_NAME, domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (process.env.CODESPACES !== 'true' || !name || !domain || !/^[a-z0-9-]+$/.test(name) || !/^[a-z0-9.-]+$/.test(domain) || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) return null;
  return `https://${name}-${port}.${domain}`;
}

/** Origin is browser supplied; proxy headers never expand the trusted origin set. */
export function trustedRequestOrigin(request: NextRequest): string | null {
  const supplied = request.headers.get('origin');
  if (!supplied || supplied === 'null') return null;
  let origin: URL;
  try { origin = new URL(supplied); } catch { return null; }
  if (origin.origin !== supplied || !['http:', 'https:'].includes(origin.protocol)) return null;
  const host = request.headers.get('host') || request.nextUrl.host;
  // Explicit public origin for a reverse proxy whose upstream URL uses the bind address.
  // Forwarded headers never add trusted hosts.
  if (process.env.APP_ORIGIN) {
    try {
      const pinned = new URL(process.env.APP_ORIGIN);
      if (pinned.protocol !== 'https:' || pinned.origin !== process.env.APP_ORIGIN) return null;
      return supplied === pinned.origin && host === pinned.host ? supplied : null;
    } catch { return null; }
  }
  const port = request.nextUrl.port;
  const localHosts = ['localhost', '127.0.0.1', '[::1]'].map(name => name + (port ? `:${port}` : ''));
  // Next.js constructs this URL from the bind address, which can be 0.0.0.0.
  // The actual Host still has to match a loopback host or the pinned Codespaces host.
  const localRequest = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(request.nextUrl.hostname);
  const forwardedOrigin = codespaceOrigin();
  if (forwardedOrigin) {
    const publicHost = new URL(forwardedOrigin).host;
    const localTarget = localRequest && localHosts.includes(host) && (port || '80') === (process.env.PORT || '3000');
    if (supplied === forwardedOrigin) return host === publicHost || localTarget ? forwardedOrigin : null;
    // Codespaces rewrites a same-origin browser Origin to its loopback target.
    // Restore only the external host pinned by server environment, never an arbitrary header.
    if (localTarget && request.headers.get('x-forwarded-host') === publicHost && origin.host === host) return forwardedOrigin;
  }
  if (localRequest) {
    // A production reverse proxy terminates HTTPS and preserves the public Host,
    // while next start constructs its internal URL from the loopback bind address.
    // Compare the browser Origin to that actual Host, never to forwarded headers.
    if (process.env.NODE_ENV === 'production' && !localHosts.includes(host) &&
        origin.protocol === 'https:' && origin.host === host) return supplied;
    return localHosts.includes(host) && supplied === `${request.nextUrl.protocol}//${host}` ? supplied : null;
  }
  // Preserve direct production same-origin requests, but do not accept unrelated Codespaces hosts.
  if (process.env.CODESPACES === 'true') return null;
  return host === request.nextUrl.host && supplied === request.nextUrl.origin ? supplied : null;
}
