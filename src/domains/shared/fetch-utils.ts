/**
 * Wrapper around fetch that adds a timeout via AbortController.
 *
 * @param url - The URL to fetch.
 * @param init - Standard RequestInit options.
 * @param timeoutMs - Timeout in milliseconds (default: 15 000).
 * @returns The fetch Response.
 * @throws If the request times out or fails.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Cached Binance BTC price entry. */
interface PriceCache {
  price: number;
  expiresAt: number;
}

/** Module-level price cache. */
let btcPriceCache: PriceCache | undefined;

/** Cache TTL in milliseconds (60 seconds). */
const PRICE_CACHE_TTL_MS = 60_000;

/** Binance ticker URL (BTCUSDT). */
const BINANCE_TICKER = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';

/**
 * Fetches the current BTC price from Binance with caching and timeout.
 * Returns the cached value if still fresh (60-second TTL). Falls back
 * to the last-known price if Binance is unreachable and the cache has
 * an expired entry.
 *
 * @returns The BTC price in USD.
 * @throws If Binance is unreachable and no cached price exists.
 */
export async function fetchBtcPrice(): Promise<number> {
  if (btcPriceCache && btcPriceCache.expiresAt > Date.now()) {
    return btcPriceCache.price;
  }

  try {
    const res = await fetchWithTimeout(BINANCE_TICKER);
    if (!res.ok) {
      throw new Error(`Binance ticker returned ${res.status}`);
    }
    const data = (await res.json()) as { price: string };
    const price = parseFloat(data.price);
    if (isNaN(price)) {
      throw new Error('Invalid price returned from Binance');
    }

    btcPriceCache = { price, expiresAt: Date.now() + PRICE_CACHE_TTL_MS };
    return price;
  } catch (err) {
    // Fall back to stale cache if available
    if (btcPriceCache) {
      console.warn('Binance unreachable, using stale BTC price:', err);
      return btcPriceCache.price;
    }
    throw err;
  }
}
