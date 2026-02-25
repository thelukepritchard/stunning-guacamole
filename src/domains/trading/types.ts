// ─── Bot Types ──────────────────────────────────────────────────

/** Bot lifecycle status. */
export type BotStatus = 'active' | 'paused' | 'draft';

/** Bot trade action. */
export type BotAction = 'buy' | 'sell';

/** Bot execution mode governing re-trigger behaviour. */
export type ExecutionMode = 'once_and_wait' | 'condition_cooldown';

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
  subscriptionArn?: string;
  /** Tracks the last action that fired (used by once_and_wait mode). */
  lastAction?: BotAction;
  /** Minimum minutes between trades per action (used by condition_cooldown mode). */
  cooldownMinutes?: number;
  /** ISO timestamp until which buy trades are locked (set by bot-executor after a buy trade). */
  buyCooldownUntil?: string;
  /** ISO timestamp until which sell trades are locked (set by bot-executor after a sell trade). */
  sellCooldownUntil?: string;
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
  subscriptionArn?: string;
}
