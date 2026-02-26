import type { IndicatorSnapshot } from '../shared/types';

/**
 * Calculates Simple Moving Average for the given period.
 *
 * @param closes - Array of closing prices (oldest first).
 * @param period - Number of periods to average.
 * @returns The SMA value, or 0 if insufficient data.
 */
export function calculateSMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Calculates Exponential Moving Average for the given period.
 *
 * @param closes - Array of closing prices (oldest first).
 * @param period - Number of periods.
 * @returns The EMA value, or 0 if insufficient data.
 */
export function calculateEMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Calculates the Relative Strength Index for the given period.
 *
 * @param closes - Array of closing prices (oldest first).
 * @param period - RSI period (typically 7 or 14).
 * @returns The RSI value (0-100), or 50 if insufficient data.
 */
export function calculateRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed RSI using Wilder's method
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Calculates MACD (12, 26, 9) with histogram and signal classification.
 *
 * @param closes - Array of closing prices (oldest first).
 * @returns Object with `histogram` (number) and `signal` (string classification).
 */
export function calculateMACD(closes: number[]): { histogram: number; signal: string } {
  if (closes.length < 26) return { histogram: 0, signal: 'below_signal' };

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12 - ema26;

  // Calculate MACD line series for signal line
  const macdSeries: number[] = [];
  const k12 = 2 / 13;
  const k26 = 2 / 27;
  let runEma12 = closes.slice(0, 12).reduce((s, v) => s + v, 0) / 12;
  let runEma26 = closes.slice(0, 26).reduce((s, v) => s + v, 0) / 26;

  for (let i = 12; i < 26; i++) {
    runEma12 = closes[i]! * k12 + runEma12 * (1 - k12);
  }

  for (let i = 26; i < closes.length; i++) {
    runEma12 = closes[i]! * k12 + runEma12 * (1 - k12);
    runEma26 = closes[i]! * k26 + runEma26 * (1 - k26);
    macdSeries.push(runEma12 - runEma26);
  }

  // Signal line is 9-period EMA of MACD series
  let signalLine = 0;
  if (macdSeries.length >= 9) {
    signalLine = macdSeries.slice(0, 9).reduce((s, v) => s + v, 0) / 9;
    const kSig = 2 / 10;
    for (let i = 9; i < macdSeries.length; i++) {
      signalLine = macdSeries[i]! * kSig + signalLine * (1 - kSig);
    }
  }

  const histogram = macdLine - signalLine;

  // Previous MACD for crossover detection
  const prevMacd = macdSeries.length >= 2 ? macdSeries[macdSeries.length - 2]! : macdLine;

  let signal: string;
  if (prevMacd <= signalLine && macdLine > signalLine) {
    signal = 'bullish_crossover';
  } else if (prevMacd >= signalLine && macdLine < signalLine) {
    signal = 'bearish_crossover';
  } else if (macdLine > signalLine) {
    signal = 'above_signal';
  } else {
    signal = 'below_signal';
  }

  return { histogram, signal };
}

/**
 * Calculates Bollinger Bands (20, 2) with position classification.
 *
 * @param closes - Array of closing prices (oldest first).
 * @returns Object with `upper`, `lower` band values and `position` classification.
 */
export function calculateBollingerBands(closes: number[]): {
  upper: number;
  lower: number;
  position: string;
} {
  if (closes.length < 20) return { upper: 0, lower: 0, position: 'between_bands' };

  const period = 20;
  const slice = closes.slice(-period);
  const sma = slice.reduce((sum, v) => sum + v, 0) / period;

  const variance = slice.reduce((sum, v) => sum + (v - sma) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = sma + 2 * stdDev;
  const lower = sma - 2 * stdDev;
  const currentPrice = closes[closes.length - 1]!;
  const bandWidth = upper - lower;

  let position: string;
  if (currentPrice > upper) {
    position = 'above_upper';
  } else if (currentPrice < lower) {
    position = 'below_lower';
  } else if (currentPrice > upper - bandWidth * 0.1) {
    position = 'near_upper';
  } else if (currentPrice < lower + bandWidth * 0.1) {
    position = 'near_lower';
  } else {
    position = 'between_bands';
  }

  return { upper, lower, position };
}

/** Kline (candlestick) data from Binance API. */
export interface KlineData {
  /** Array of kline arrays: [openTime, open, high, low, close, volume, ...] */
  candles: (string | number)[][];
}

/** 24h ticker data from Binance API. */
export interface Ticker24h {
  volume: string;
  priceChangePercent: string;
  lastPrice: string;
}

/**
 * Master orchestrator that calculates all 16 indicator values from raw market data.
 *
 * @param klines - Kline candlestick data from Binance.
 * @param ticker24h - 24h ticker data from Binance.
 * @returns A complete IndicatorSnapshot.
 */
export function calculateAllIndicators(klines: KlineData, ticker24h: Ticker24h): IndicatorSnapshot {
  const closes = klines.candles.map((c) => parseFloat(String(c[4])));
  const currentPrice = parseFloat(ticker24h.lastPrice);

  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes);

  return {
    price: currentPrice,
    volume_24h: parseFloat(ticker24h.volume),
    price_change_pct: parseFloat(ticker24h.priceChangePercent),
    rsi_14: calculateRSI(closes, 14),
    rsi_7: calculateRSI(closes, 7),
    macd_histogram: macd.histogram,
    macd_signal: macd.signal,
    sma_20: calculateSMA(closes, 20),
    sma_50: calculateSMA(closes, 50),
    sma_200: calculateSMA(closes, 200),
    ema_12: calculateEMA(closes, 12),
    ema_20: calculateEMA(closes, 20),
    ema_26: calculateEMA(closes, 26),
    bb_upper: bb.upper,
    bb_lower: bb.lower,
    bb_position: bb.position,
  };
}
