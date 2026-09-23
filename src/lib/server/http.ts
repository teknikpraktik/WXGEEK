import "server-only";

export const USER_AGENT = "Vaderlek/0.1 (+https://github.com/teknikpraktik/vaderlek)";

export class UpstreamError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

type FetchOpts = {
  /** Sekunder i Next.js data cache. 0 = ingen cache. */
  revalidate?: number;
  timeoutMs?: number;
};

/**
 * Hämtar JSON från en extern källa med timeout och identifierande User-Agent.
 * Returnerar `null` vid 204/404 (ingen data), kastar UpstreamError vid övriga fel.
 */
export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  const { revalidate = 300, timeoutMs = 8000 } = opts;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" as const }),
    });
  } catch (e) {
    throw new UpstreamError(`Nätverksfel mot ${new URL(url).host}: ${(e as Error).message}`);
  }
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new UpstreamError(`${new URL(url).host} svarade ${res.status}`, res.status);
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(`Ogiltig JSON från ${new URL(url).host}`);
  }
}

/**
 * Enkel minnescache per serverinstans. Används för stora svar (SMHI:s stationslistor
 * ~800 kB) som är för stora för Next.js data cache (max 2 MB per post) och som vi ändå
 * komprimerar innan lagring. Parallella anrop delar samma promise.
 */
const memo = new Map<string, { expires: number; value: Promise<unknown> }>();

export function memoize<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const value = fn();
  memo.set(key, { expires: now + ttlMs, value });
  // Cacha inte fel.
  value.catch(() => memo.delete(key));
  return value;
}
