// ─── Portfolio Types ────────────────────────────────────────────

/** DynamoDB portfolio item — one record per user, created on Cognito sign-up. */
export interface PortfolioRecord {
  /** Cognito user ID (partition key). */
  sub: string;
  /** User email captured at sign-up. */
  email: string;
  /** ISO timestamp of account creation. */
  createdAt: string;
}

// ─── Portfolio Performance Types ────────────────────────────────

/** DynamoDB portfolio performance snapshot — one record per 5-minute interval per user. */
export interface PortfolioPerformanceRecord {
  /** Cognito user ID (partition key). */
  sub: string;
  /** ISO timestamp of the snapshot (sort key). */
  timestamp: string;
  /** Number of active bots at snapshot time. */
  activeBots: number;
  /** Aggregate net P&L across all bots. */
  totalNetPnl: number;
  /** Aggregate realised P&L across all bots. */
  totalRealisedPnl: number;
  /** Aggregate unrealised P&L across all bots. */
  totalUnrealisedPnl: number;
  /** Change in net P&L over the last 24 hours. */
  pnl24h: number;
  /** Epoch seconds for DynamoDB TTL (auto-expire after 90 days). */
  ttl: number;
}
