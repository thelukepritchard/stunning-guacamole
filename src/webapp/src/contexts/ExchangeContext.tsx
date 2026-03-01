import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useApi } from '../hooks/useApi';

/** Supported exchange identifiers. */
type ExchangeId = 'demo' | 'swyftx' | 'coinspot' | 'coinjar' | 'kraken_pro' | 'binance';

/** Exchange connection returned by the API. */
interface ExchangeConnection {
  exchangeId: ExchangeId;
  baseCurrency: string;
  maskedApiKey: string;
  createdAt: string;
  updatedAt: string;
}

/** Active exchange response from the API. */
interface ActiveExchangeResponse {
  exchangeId: ExchangeId;
  baseCurrency: string;
}

/** Context value shape for exchange state. */
interface ExchangeContextValue {
  /** Currently active exchange identifier. */
  activeExchange: ExchangeId;
  /** Base currency of the active exchange. */
  baseCurrency: string;
  /** All configured exchange connections. */
  connections: ExchangeConnection[];
  /** Whether data is still loading. */
  loading: boolean;
  /** Sets the active exchange and persists the preference. */
  setActiveExchange: (exchangeId: ExchangeId) => Promise<void>;
  /** Re-fetches connections and active exchange from the API. */
  refreshConnections: () => Promise<void>;
}

const ExchangeContext = createContext<ExchangeContextValue | undefined>(undefined);

/**
 * Provider component that manages global active exchange state.
 * Fetches exchange connections and active exchange on mount, and
 * exposes methods to switch the active exchange and refresh data.
 */
export function ExchangeProvider({ children }: { children: ReactNode }) {
  const [activeExchange, setActiveExchangeState] = useState<ExchangeId>('demo');
  const [baseCurrency, setBaseCurrency] = useState('AUD');
  const [connections, setConnections] = useState<ExchangeConnection[]>([]);
  const [loading, setLoading] = useState(true);

  const { request } = useApi();

  /** Fetches connections and active exchange in parallel. */
  const refreshConnections = useCallback(async () => {
    setLoading(true);
    try {
      const [connectionsRes, activeRes] = await Promise.allSettled([
        request<{ connections: ExchangeConnection[] }>('GET', '/exchange/connections'),
        request<ActiveExchangeResponse>('GET', '/exchange/active'),
      ]);

      if (connectionsRes.status === 'fulfilled') {
        setConnections(connectionsRes.value.connections);
      }

      if (activeRes.status === 'fulfilled') {
        setActiveExchangeState(activeRes.value.exchangeId);
        setBaseCurrency(activeRes.value.baseCurrency);
      }
    } catch {
      // Keep current state on failure
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    refreshConnections();
  }, [refreshConnections]);

  /** Sets the active exchange by calling the API and updating local state. */
  const setActiveExchange = useCallback(async (exchangeId: ExchangeId) => {
    const result = await request<ActiveExchangeResponse>('PUT', '/exchange/active', { exchangeId });
    setActiveExchangeState(result.exchangeId);
    setBaseCurrency(result.baseCurrency);
  }, [request]);

  return (
    <ExchangeContext.Provider value={{
      activeExchange,
      baseCurrency,
      connections,
      loading,
      setActiveExchange,
      refreshConnections,
    }}>
      {children}
    </ExchangeContext.Provider>
  );
}

/**
 * Hook to consume the exchange context.
 *
 * @returns The exchange context value.
 * @throws If used outside of an ExchangeProvider.
 */
export function useExchange(): ExchangeContextValue {
  const context = useContext(ExchangeContext);
  if (!context) {
    throw new Error('useExchange must be used within an ExchangeProvider');
  }
  return context;
}
