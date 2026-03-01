import type { ExchangeId } from '../../shared/types';
import type { ExchangeAdapter } from './types';
import { swyftxAdapter } from './swyftx';
import { coinspotAdapter } from './coinspot';

/** Registry mapping exchange identifiers to their adapter implementations. */
const adapters: Partial<Record<ExchangeId, ExchangeAdapter>> = {
  swyftx: swyftxAdapter,
  coinspot: coinspotAdapter,
};

/**
 * Returns the exchange adapter for the given exchange identifier.
 *
 * @param exchangeId - The exchange to get an adapter for.
 * @returns The exchange adapter.
 * @throws If no adapter is registered for the given exchange.
 */
export function getAdapter(exchangeId: ExchangeId): ExchangeAdapter {
  const adapter = adapters[exchangeId];
  if (!adapter) {
    throw new Error(`No adapter registered for exchange: ${exchangeId}`);
  }
  return adapter;
}
