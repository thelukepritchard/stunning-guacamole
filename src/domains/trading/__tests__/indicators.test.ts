import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateAllIndicators,
} from '../indicators';
import type { KlineData, Ticker24h } from '../indicators';

/**
 * Tests for technical indicator calculations.
 * Each indicator function is tested with known data to verify correctness,
 * and with insufficient data to verify fallback behaviour.
 */
describe('indicators', () => {
  /**
   * Tests for calculateSMA (Simple Moving Average).
   */
  describe('calculateSMA', () => {
    /** Verifies SMA with a known data set and period. */
    it('calculates the correct SMA for a given period', () => {
      const closes = [10, 20, 30, 40, 50];
      const result = calculateSMA(closes, 3);

      // SMA of last 3 values: (30 + 40 + 50) / 3 = 40
      expect(result).toBe(40);
    });

    /** Verifies SMA equals the average when period equals data length. */
    it('calculates SMA when period equals data length', () => {
      const closes = [2, 4, 6, 8, 10];
      const result = calculateSMA(closes, 5);

      // (2 + 4 + 6 + 8 + 10) / 5 = 6
      expect(result).toBe(6);
    });

    /** Verifies SMA returns 0 when there is insufficient data. */
    it('returns 0 when there is insufficient data', () => {
      const closes = [10, 20];
      const result = calculateSMA(closes, 5);

      expect(result).toBe(0);
    });

    /** Verifies SMA returns 0 when the array is empty. */
    it('returns 0 for an empty array', () => {
      const result = calculateSMA([], 5);

      expect(result).toBe(0);
    });
  });

  /**
   * Tests for calculateEMA (Exponential Moving Average).
   */
  describe('calculateEMA', () => {
    /** Verifies EMA with known data produces a reasonable value. */
    it('calculates the correct EMA for a given period', () => {
      const closes = [22, 22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29, 22.15];
      const result = calculateEMA(closes, 10);

      // EMA should be a valid number close to the recent closing prices
      expect(result).toBeGreaterThan(22);
      expect(result).toBeLessThan(23);
    });

    /** Verifies that when data length exactly matches period, EMA equals SMA. */
    it('returns SMA when data length equals period', () => {
      const closes = [10, 20, 30, 40, 50];
      const result = calculateEMA(closes, 5);

      // When data length equals period, EMA = SMA = (10+20+30+40+50)/5 = 30
      expect(result).toBe(30);
    });

    /** Verifies EMA returns 0 when there is insufficient data. */
    it('returns 0 when there is insufficient data', () => {
      const closes = [10, 20, 30];
      const result = calculateEMA(closes, 5);

      expect(result).toBe(0);
    });

    /** Verifies EMA returns 0 for an empty array. */
    it('returns 0 for an empty array', () => {
      const result = calculateEMA([], 12);

      expect(result).toBe(0);
    });
  });

  /**
   * Tests for calculateRSI (Relative Strength Index).
   */
  describe('calculateRSI', () => {
    /** Verifies RSI with known data produces a value between 0 and 100. */
    it('calculates RSI within valid range for known data', () => {
      // Generate a reasonable price series
      const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
        46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00];
      const result = calculateRSI(closes, 14);

      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    /** Verifies RSI is 100 when all price changes are gains. */
    it('returns 100 when all changes are gains', () => {
      const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
      const result = calculateRSI(closes, 14);

      expect(result).toBe(100);
    });

    /** Verifies RSI is 0 when all price changes are losses. */
    it('returns 0 when all changes are losses', () => {
      const closes = [25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10];
      const result = calculateRSI(closes, 14);

      expect(result).toBe(0);
    });

    /** Verifies RSI returns 50 (neutral) when there is insufficient data. */
    it('returns 50 when there is insufficient data', () => {
      const closes = [10, 20, 30];
      const result = calculateRSI(closes, 14);

      expect(result).toBe(50);
    });

    /** Verifies RSI works with a 7-period as well. */
    it('calculates RSI with a 7-period', () => {
      const closes = [10, 11, 12, 11, 13, 14, 12, 15, 16];
      const result = calculateRSI(closes, 7);

      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });
  });

  /**
   * Tests for calculateMACD (Moving Average Convergence Divergence).
   */
  describe('calculateMACD', () => {
    /** Verifies MACD with sufficient data returns a histogram and signal. */
    it('calculates MACD with sufficient data', () => {
      // Generate 50 data points
      const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 10);
      const result = calculateMACD(closes);

      expect(typeof result.histogram).toBe('number');
      expect(['bullish_crossover', 'bearish_crossover', 'above_signal', 'below_signal']).toContain(result.signal);
    });

    /** Verifies MACD returns defaults when data is insufficient (< 26). */
    it('returns defaults when data is insufficient', () => {
      const closes = [10, 20, 30, 40, 50];
      const result = calculateMACD(closes);

      expect(result.histogram).toBe(0);
      expect(result.signal).toBe('below_signal');
    });

    /** Verifies MACD works with exactly 26 data points. */
    it('works with exactly 26 data points', () => {
      const closes = Array.from({ length: 26 }, (_, i) => 100 + i);
      const result = calculateMACD(closes);

      expect(typeof result.histogram).toBe('number');
      expect(typeof result.signal).toBe('string');
    });

    /** Verifies MACD produces a non-zero histogram for consistently rising prices. */
    it('produces non-zero histogram for consistently rising prices', () => {
      const closes = Array.from({ length: 50 }, (_, i) => 100 + i * 2);
      const result = calculateMACD(closes);

      expect(result.histogram).not.toBe(0);
      expect(typeof result.signal).toBe('string');
    });
  });

  /**
   * Tests for calculateBollingerBands.
   */
  describe('calculateBollingerBands', () => {
    /** Verifies Bollinger Bands with known data produces valid upper/lower values. */
    it('calculates bands with known data', () => {
      // 20 prices around 100 with some variation
      const closes = [98, 99, 100, 101, 102, 101, 100, 99, 98, 99,
        100, 101, 102, 103, 102, 101, 100, 99, 100, 101];
      const result = calculateBollingerBands(closes);

      expect(result.upper).toBeGreaterThan(result.lower);
      expect(typeof result.position).toBe('string');
      expect(['above_upper', 'below_lower', 'near_upper', 'near_lower', 'between_bands']).toContain(result.position);
    });

    /** Verifies upper band is above the SMA and lower band is below. */
    it('upper band is above SMA and lower band is below', () => {
      const closes = Array.from({ length: 25 }, (_, i) => 50 + (i % 5));
      const result = calculateBollingerBands(closes);
      const sma = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;

      expect(result.upper).toBeGreaterThan(sma);
      expect(result.lower).toBeLessThan(sma);
    });

    /** Verifies Bollinger Bands return defaults when data is insufficient. */
    it('returns defaults when data is insufficient', () => {
      const closes = [10, 20, 30];
      const result = calculateBollingerBands(closes);

      expect(result.upper).toBe(0);
      expect(result.lower).toBe(0);
      expect(result.position).toBe('between_bands');
    });

    /** Verifies above_upper classification when price is above the upper band. */
    it('classifies position as above_upper when price exceeds upper band', () => {
      // All stable values except last one is very high
      const closes = Array.from({ length: 19 }, () => 100);
      closes.push(200);
      const result = calculateBollingerBands(closes);

      expect(result.position).toBe('above_upper');
    });

    /** Verifies below_lower classification when price is below the lower band. */
    it('classifies position as below_lower when price is below lower band', () => {
      // All stable values except last one is very low
      const closes = Array.from({ length: 19 }, () => 100);
      closes.push(1);
      const result = calculateBollingerBands(closes);

      expect(result.position).toBe('below_lower');
    });
  });

  /**
   * Integration test for calculateAllIndicators.
   * Verifies that all 16 indicator fields are populated from mock market data.
   */
  describe('calculateAllIndicators', () => {
    /** Verifies all indicator fields are calculated from klines and ticker data. */
    it('produces a full IndicatorSnapshot from mock data', () => {
      // Build 200 mock kline candles: [openTime, open, high, low, close, volume, ...]
      const candles = Array.from({ length: 200 }, (_, i) => {
        const close = 50000 + Math.sin(i / 10) * 1000;
        return [i * 60000, String(close - 50), String(close + 50), String(close - 100), String(close), '100'];
      });
      const klines: KlineData = { candles };

      const ticker24h: Ticker24h = {
        volume: '15000.5',
        priceChangePercent: '2.35',
        lastPrice: '50500',
      };

      const result = calculateAllIndicators(klines, ticker24h);

      expect(result.price).toBe(50500);
      expect(result.volume_24h).toBe(15000.5);
      expect(result.price_change_pct).toBe(2.35);
      expect(typeof result.rsi_14).toBe('number');
      expect(typeof result.rsi_7).toBe('number');
      expect(typeof result.macd_histogram).toBe('number');
      expect(typeof result.macd_signal).toBe('string');
      expect(typeof result.sma_20).toBe('number');
      expect(typeof result.sma_50).toBe('number');
      expect(typeof result.sma_200).toBe('number');
      expect(typeof result.ema_12).toBe('number');
      expect(typeof result.ema_20).toBe('number');
      expect(typeof result.ema_26).toBe('number');
      expect(typeof result.bb_upper).toBe('number');
      expect(typeof result.bb_lower).toBe('number');
      expect(typeof result.bb_position).toBe('string');
    });

    /** Verifies that SMA-200 is non-zero when given 200 candles. */
    it('calculates SMA-200 when given 200 candles', () => {
      const candles = Array.from({ length: 200 }, (_, i) => {
        const close = 40000 + i * 10;
        return [i * 60000, '0', '0', '0', String(close), '50'];
      });
      const klines: KlineData = { candles };
      const ticker24h: Ticker24h = { volume: '1000', priceChangePercent: '1.0', lastPrice: '41990' };

      const result = calculateAllIndicators(klines, ticker24h);

      expect(result.sma_200).toBeGreaterThan(0);
    });
  });
});
