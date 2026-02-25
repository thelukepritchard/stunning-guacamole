// ─── Bot Types ──────────────────────────────────────────────────

/** Bot lifecycle status. */
export type BotStatus = 'active' | 'paused' | 'draft';

/** Bot trade action. */
export type BotAction = 'buy' | 'sell';

/** Bot execution mode governing re-trigger behaviour. */
export type ExecutionMode = 'once_and_wait' | 'condition_cooldown';

/** What triggered a trade signal. */
export type TradeTrigger = 'rule' | 'stop_loss' | 'take_profit';

/** Position sizing configuration for buy or sell actions. */
export interface SizingConfig {
  /** 'fixed' = absolute amount in base currency; 'percentage' = percentage of portfolio. */
  type: 'fixed' | 'percentage';
  /** The sizing value — dollars for fixed, 0–100 for percentage. */
  value: number;
}

/** Stop-loss configuration. Percentage-based, evaluated against entryPrice. */
export interface StopLossConfig {
  /** Percentage drop from entry price that triggers a sell (0–100). */
  percentage: number;
}

/** Take-profit configuration. Percentage-based, evaluated against entryPrice. */
export interface TakeProfitConfig {
  /** Percentage rise from entry price that triggers a sell (0–100). */
  percentage: number;
}

/** A single rule — structurally compatible with react-querybuilder's RuleType. */
export interface Rule {
  field: string;
  operator: string;
  value: string;
}

/** A group of rules — structurally compatible with react-querybuilder's RuleGroupType. */
export interface RuleGroup {
  combinator: 'and' | 'or';
  rules: (Rule | RuleGroup)[];
}

/** DynamoDB bot item. */
export interface BotRecord {
  sub: string;
  botId: string;
  name: string;
  pair: string;
  status: BotStatus;
  executionMode: ExecutionMode;
  buyQuery?: RuleGroup;
  sellQuery?: RuleGroup;
  /** SNS subscription ARN for the buy rule (managed by bot-lifecycle-handler). */
  buySubscriptionArn?: string;
  /** SNS subscription ARN for the sell rule (managed by bot-lifecycle-handler). */
  sellSubscriptionArn?: string;
  /** Tracks the last action that fired (used by once_and_wait mode). */
  lastAction?: BotAction;
  /** Minimum minutes between trades per action (used by condition_cooldown mode). */
  cooldownMinutes?: number;
  /** ISO timestamp until which buy trades are locked (set by bot-executor after a buy trade). */
  buyCooldownUntil?: string;
  /** ISO timestamp until which sell trades are locked (set by bot-executor after a sell trade). */
  sellCooldownUntil?: string;
  /** Position sizing for buy actions. */
  buySizing?: SizingConfig;
  /** Position sizing for sell actions. */
  sellSizing?: SizingConfig;
  /** Stop-loss configuration — triggers a sell when price drops below threshold. */
  stopLoss?: StopLossConfig;
  /** Take-profit configuration — triggers a sell when price rises above threshold. */
  takeProfit?: TakeProfitConfig;
  /** Entry price set when a buy trade fires — used for SL/TP evaluation. */
  entryPrice?: number;
  createdAt: string;
  updatedAt: string;
}

/** DynamoDB trade item. */
export interface TradeRecord {
  botId: string;
  timestamp: string;
  sub: string;
  pair: string;
  action: BotAction;
  price: number;
  /** What triggered this trade — rule evaluation, stop-loss, or take-profit. */
  trigger: TradeTrigger;
  /** Position size used for this trade (if configured). */
  sizing?: SizingConfig;
  indicators: IndicatorSnapshot;
  createdAt: string;
}

// ─── Indicator Types ────────────────────────────────────────────

/** All 16 indicator values calculated from market data. */
export interface IndicatorSnapshot {
  price: number;
  volume_24h: number;
  price_change_pct: number;
  rsi_14: number;
  rsi_7: number;
  macd_histogram: number;
  macd_signal: string;
  sma_20: number;
  sma_50: number;
  sma_200: number;
  ema_12: number;
  ema_20: number;
  ema_26: number;
  bb_upper: number;
  bb_lower: number;
  bb_position: string;
}

/** Numeric indicator field names. */
export const NUMERIC_INDICATOR_FIELDS = [
  'price',
  'volume_24h',
  'price_change_pct',
  'rsi_14',
  'rsi_7',
  'macd_histogram',
  'sma_20',
  'sma_50',
  'sma_200',
  'ema_12',
  'ema_20',
  'ema_26',
  'bb_upper',
  'bb_lower',
] as const;

/** String indicator field names. */
export const STRING_INDICATOR_FIELDS = [
  'macd_signal',
  'bb_position',
] as const;

// ─── Price History Types ────────────────────────────────────────

/** DynamoDB price history item — one record per minute per pair. */
export interface PriceHistoryRecord {
  pair: string;
  timestamp: string;
  price: number;
  volume_24h: number;
  price_change_pct: number;
  indicators: IndicatorSnapshot;
  /** Epoch seconds for DynamoDB TTL (auto-expire after 30 days). */
  ttl: number;
}

// ─── Bot Performance Types ──────────────────────────────────────

/** DynamoDB bot performance snapshot — one record per 5-minute interval per bot. */
export interface BotPerformanceRecord {
  botId: string;
  timestamp: string;
  sub: string;
  pair: string;
  currentPrice: number;
  totalBuys: number;
  totalSells: number;
  totalBuyValue: number;
  totalSellValue: number;
  realisedPnl: number;
  unrealisedPnl: number;
  netPnl: number;
  netPosition: number;
  /** Percentage of sells where sell price exceeded average buy cost (0–100). */
  winRate: number;
  /** Epoch seconds for DynamoDB TTL (auto-expire after 90 days). */
  ttl: number;
}

// ─── Trading Settings Types ─────────────────────────────────────

/** Supported exchange identifiers. 'demo' is the default — trades are simulated, no real exchange connection. */
export type ExchangeId = 'demo' | 'swyftx' | 'coinspot' | 'coinjar' | 'kraken_pro' | 'binance';

/** The default exchange for new users — simulated trading with no real exchange connection. */
export const DEFAULT_EXCHANGE: ExchangeId = 'demo';

/** Human-readable exchange names and phase. Phase 0 = always available (demo). */
export const EXCHANGES: Record<ExchangeId, { name: string; phase: 0 | 1 | 2; description: string }> = {
  demo: { name: 'Demo', phase: 0, description: 'Simulated trading — no real orders are placed' },
  swyftx: { name: 'Swyftx', phase: 1, description: 'Australian cryptocurrency exchange' },
  coinspot: { name: 'CoinSpot', phase: 1, description: 'Australian cryptocurrency exchange' },
  coinjar: { name: 'CoinJar', phase: 1, description: 'Australian multi-currency exchange' },
  kraken_pro: { name: 'Kraken Pro', phase: 2, description: 'Advanced international exchange' },
  binance: { name: 'Binance', phase: 2, description: 'Global cryptocurrency exchange' },
};

/** Supported base currencies per exchange. Demo supports all common currencies. */
export const EXCHANGE_BASE_CURRENCIES: Record<ExchangeId, string[]> = {
  demo: ['USD', 'AUD', 'USDT'],
  swyftx: ['AUD', 'USD'],
  coinspot: ['AUD'],
  coinjar: ['AUD', 'USD', 'GBP', 'EUR', 'BTC', 'USDT', 'USDC'],
  kraken_pro: ['USD', 'EUR', 'BTC', 'ETH', 'USDT'],
  binance: ['USDT', 'BTC', 'ETH', 'BNB', 'FDUSD'],
};

/** Selectable exchange identifiers — real exchanges the user can configure. Demo is not included; it is the implicit default. */
export const SUPPORTED_EXCHANGES: ExchangeId[] = ['swyftx', 'coinspot', 'coinjar', 'kraken_pro', 'binance'];

/** DynamoDB trading settings item — one record per user storing exchange, base currency, and encrypted API credentials. Only created when a user configures a real exchange. */
export interface TradingSettingsRecord {
  sub: string;
  exchange: ExchangeId;
  baseCurrency: string;
  /** Base64-encoded KMS-encrypted API key. */
  encryptedApiKey: string;
  /** Base64-encoded KMS-encrypted API secret. */
  encryptedApiSecret: string;
  /** Masked API key for display (last 4 characters). */
  maskedApiKey: string;
  updatedAt: string;
}

/** Response shape returned to clients — never includes encrypted secrets. */
export interface TradingSettingsResponse {
  exchange: ExchangeId;
  baseCurrency: string;
  /** Masked API key — only present when a real exchange is configured (not for demo default). */
  maskedApiKey?: string;
  updatedAt: string;
}

/** Response shape for exchange options — returns valid base currencies per exchange. Only includes real (non-demo) exchanges. */
export interface ExchangeOption {
  exchangeId: ExchangeId;
  name: string;
  description: string;
  baseCurrencies: string[];
  phase: 1 | 2;
}

// ─── EventBridge Event Types ────────────────────────────────────

/** EventBridge event source for the trading domain. */
export const TRADING_EVENT_SOURCE = 'signalr.trading';

/** Detail payload for BotCreated events. */
export interface BotCreatedDetail {
  bot: BotRecord;
}

/** Detail payload for BotUpdated events. */
export interface BotUpdatedDetail {
  bot: BotRecord;
  previousStatus: BotStatus;
  queriesChanged: boolean;
}

/** Detail payload for BotDeleted events. */
export interface BotDeletedDetail {
  sub: string;
  botId: string;
  buySubscriptionArn?: string;
  sellSubscriptionArn?: string;
}
