// Decides which authority the client connects to. Rules, first match wins:
//   1. ?offline                          -> null (local Web Worker authority)
//   2. ?server=ws(s)://host:port[/path]  -> that URL
//   3. ?online, or the page was served by the production server (server/prod.ts injects
//      <meta name="cvc-ws" content="/ws">)  -> ws(s)://<page host><path>  (wss when the page is https)
//   4. otherwise                         -> null (offline worker; the Vite dev server never injects the meta)
// In cases 2 and 3, ?room=<name> is forwarded as the `room` query parameter (separate Room per name).

import { sanitizeRoomName } from '../../host/guard';

export { sanitizeRoomName };

export interface PageLocation {
  protocol: string;
  host: string;
  search: string;
}

function withRoom(url: string, room: string | null): string {
  if (!room) return url;
  const u = new URL(url);
  u.searchParams.set('room', sanitizeRoomName(room));
  return u.toString();
}

/** Pure rule (testable): `metaWsPath` is the content of <meta name="cvc-ws"> if present. */
export function resolveServerUrl(loc: PageLocation, metaWsPath: string | null): string | null {
  const params = new URLSearchParams(loc.search);
  if (params.has('offline')) return null;
  const room = params.get('room');
  const explicit = params.get('server');
  if (explicit && /^wss?:\/\//i.test(explicit)) return withRoom(explicit, room);
  if (params.has('online') || metaWsPath) {
    const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
    const path = metaWsPath && metaWsPath.startsWith('/') ? metaWsPath : '/ws';
    return withRoom(`${scheme}://${loc.host}${path}`, room);
  }
  return null;
}

/** Browser helper: apply the rule to the current page. */
export function serverUrlForPage(): string | null {
  const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="cvc-ws"]')?.getAttribute('content') ?? null : null;
  return resolveServerUrl(location, meta);
}
