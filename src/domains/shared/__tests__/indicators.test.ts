import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateAllIndicators,
} from '../indicators';

// ─── calculateSMA ──────────────────────────────────────────────────────────────

describe('calculateSMA', () => {
  /**
   * Returns 0 when closes array has fewer elements than the requested period.
   */
  it('should return 0 when insufficient data', () => {
    expect(calculateSMA([1, 2], 5)).toBe(0);
    expect(calculateSMA([], 1)).toBe(0);
  });

  /**
   * Averages the last `period` values when there is exactly enough data.
   */
  it('should calculate SMA from exactly period-length data', () => {
    expect(calculateSMA([10, 20, 30], 3)).toBeCloseTo(20);
  });

  /**
   * Uses only the last `period` values when there is more data than period.
   */
  it('should use the last N values when data exceeds period', () => {
    // Last 3 of [1, 2, 3, 4, 5] = [3, 4, 5] → avg = 4
    expect(calculateSMA([1, 2, 3, 4, 5], 3)).toBeCloseTo(4);
  });

  /**
   * SMA with period=1 should return the last value.
   */
  it('should return the last value when period is 1', () => {
    expect(calculateSMA([10, 20, 30], 1)).toBeCloseTo(30);
  });
});

// ─── calculateEMA ──────────────────────────────────────────────────────────────

describe('calculateEMA', () => {
  /**
   * Returns 0 when closes array has fewer elements than the requested period.
   */
  it('should return 0 when insufficient data', () => {
    expect(calculateEMA([1, 2], 5)).toBe(0);
    expect(calculateEMA([], 1)).toBe(0);
  });

  /**
   * When there is exactly period-length data, EMA equals SMA (no smoothing iterations).
   */
  it('should equal SMA when data length equals period', () => {
    const closes = [10, 20, 30];
    expect(calculateEMA(closes, 3)).toBeCloseTo(20);
  });

  /**
   * EMA applies exponential weighting to values after the initial SMA seed.
   */
  it('should weight recent values more heavily than SMA', () => {
    const closes = [10, 10, 10, 10, 20]; // period=4, then 20 comes in
    const sma = calculateSMA(closes, 4); // (10+10+10+20)/4 = 12.5
    const ema = calculateEMA(closes, 4);
    // EMA seed = avg(first 4) = 10, then EMA = 20*(2/5) + 10*(3/5) = 8 + 6 = 14
    expect(ema).toBeCloseTo(14);
    expect(ema).not.toBe(sma); // EMA and SMA diverge
  });
});

// ─── calculateRSI ──────────────────────────────────────────────────────────────

describe('calculateRSI', () => {
  /**
   * Returns 50 (neutral) when insufficient data (< period + 1 values needed).
   */
  it('should return 50 when insufficient data', () => {
    expect(calculateRSI([10, 20], 14)).toBe(50);
    expect(calculateRSI([], 7)).toBe(50);
  });

  /**
   * When prices only go up, RSI should be 100.
   */
  it('should return 100 when all changes are gains', () => {
    // 15 values with monotonic increase (14 positive changes)
    const closes = Array.from({ length: 15 }, (_, i) => 100 + i);
    expect(calculateRSI(closes, 14)).toBe(100);
  });

  /**
   * When prices only go down, RSI should be 0.
   */
  it('should return 0 when all changes are losses', () => {
    const closes = Array.from({ length: 15 }, (_, i) => 100 - i);
    expect(calculateRSI(closes, 14)).toBeCloseTo(0);
  });

  /**
   * When gains and losses are equal, RSI should be near 50.
   */
  it('should return approximately 50 when gains and losses are equal', () => {
    // Alternating +1 and -1 changes
    const closes = [100];
    for (let i = 1; i <= 14; i++) {
      closes.push(closes[i - 1]! + (i % 2 === 1 ? 1 : -1));
    }
    const rsi = calculateRSI(closes, 14);
    expect(rsi).toBeGreaterThan(40);
    expect(rsi).toBeLessThan(60);
  });

  /**
   * RSI should always be between 0 and 100.
   */
  it('should always be bounded between 0 and 100', () => {
    const randomCloses = [100, 105, 95, 110, 85, 120, 90, 130, 80, 140, 70, 150, 60, 160, 50, 170];
    const rsi = calculateRSI(randomCloses, 7);
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });
});

// ─── calculateMACD ─────────────────────────────────────────────────────────────

describe('calculateMACD', () => {
  /**
   * Returns default values when there are fewer than 26 closing prices.
   */
  it('should return defaults when insufficient data', () => {
    const result = calculateMACD(Array.from({ length: 25 }, () => 100));
    expect(result.histogram).toBe(0);
    expect(result.signal).toBe('below_signal');
  });

  /**
   * With constant prices, MACD histogram should be near zero (EMA12 ≈ EMA26).
   */
  it('should return near-zero histogram for constant prices', () => {
    const closes = Array.from({ length: 50 }, () => 100);
    const result = calculateMACD(closes);
    expect(Math.abs(result.histogram)).toBeLessThan(0.01);
  });

  /**
   * With an accelerating uptrend, MACD should be above signal (bullish).
   * Using exponential growth so EMA12 pulls away from EMA26 convincingly.
   */
  it('should signal above_signal or bullish_crossover in accelerating uptrend', () => {
    // Flat period followed by accelerating rise — creates clear MACD divergence
    const closes = [
      ...Array.from({ length: 30 }, () => 100),
      ...Array.from({ length: 20 }, (_, i) => 100 + (i + 1) ** 1.5),
    ];
    const result = calculateMACD(closes);
    expect(result.histogram).toBeGreaterThan(0);
    expect(['above_signal', 'bullish_crossover']).toContain(result.signal);
  });

  /**
   * With an accelerating downtrend, MACD should be below signal (bearish).
   */
  it('should signal below_signal or bearish_crossover in accelerating downtrend', () => {
    const closes = [
      ...Array.from({ length: 30 }, () => 200),
      ...Array.from({ length: 20 }, (_, i) => 200 - (i + 1) ** 1.5),
    ];
    const result = calculateMACD(closes);
    expect(result.histogram).toBeLessThan(0);
    expect(['below_signal', 'bearish_crossover']).toContain(result.signal);
  });

  /**
   * MACD signal should be a valid string classification.
   */
  it('should return a valid signal classification', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 10);
    const result = calculateMACD(closes);
    expect(['bullish_crossover', 'bearish_crossover', 'above_signal', 'below_signal']).toContain(result.signal);
  });
});

// ─── calculateBollingerBands ───────────────────────────────────────────────────

describe('calculateBollingerBands', () => {
  /**
   * Returns defaults when there are fewer than 20 closing prices.
   */
  it('should return defaults when insufficient data', () => {
    const result = calculateBollingerBands(Array.from({ length: 19 }, () => 100));
    expect(result.upper).toBe(0);
    expect(result.lower).toBe(0);
    expect(result.position).toBe('between_bands');
  });

  /**
   * With constant prices, bands collapse to the price (stddev = 0).
   */
  it('should have upper = lower = price for constant prices', () => {
    const closes = Array.from({ length: 20 }, () => 100);
    const result = calculateBollingerBands(closes);
    expect(result.upper).toBeCloseTo(100);
    expect(result.lower).toBeCloseTo(100);
  });

  /**
   * Upper band should always be above lower band when there is volatility.
   */
  it('should have upper > lower with volatile prices', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5));
    const result = calculateBollingerBands(closes);
    expect(result.upper).toBeGreaterThan(result.lower);
  });

  /**
   * When price is well above upper band, position should be 'above_upper'.
   */
  it('should classify above_upper when price exceeds upper band', () => {
    // 19 values at 100, then a spike to 200
    const closes = Array.from({ length: 19 }, () => 100);
    closes.push(200);
    const result = calculateBollingerBands(closes);
    expect(result.position).toBe('above_upper');
  });

  /**
   * When price is well below lower band, position should be 'below_lower'.
   */
  it('should classify below_lower when price is below lower band', () => {
    // 19 values at 100, then a drop to 1
    const closes = Array.from({ length: 19 }, () => 100);
    closes.push(1);
    const result = calculateBollingerBands(closes);
    expect(result.position).toBe('below_lower');
  });

  /**
   * When price is between the bands, position should be 'between_bands',
   * 'near_upper', or 'near_lower'.
   */
  it('should classify between_bands for price near the middle', () => {
    const closes = Array.from({ length: 20 }, () => 100);
    const result = calculateBollingerBands(closes);
    // Constant prices → bands collapse → position depends on exact price vs band edges
    expect(['between_bands', 'near_upper', 'near_lower']).toContain(result.position);
  });
});

// ─── calculateAllIndicators ────────────────────────────────────────────────────

describe('calculateAllIndicators', () => {
  const klines = {
    candles: Array.from({ length: 200 }, (_, i) => [
      Date.now() + i * 60_000, // openTime
      '50000',                 // open
      '50500',                 // high
      '49500',                 // low
      String(50_000 + (i % 10) * 100), // close — slight variation
      '100',                   // volume
    ]),
  };

  const ticker24h = {
    volume: '25000.5',
    priceChangePercent: '2.35',
    lastPrice: '50900',
  };

  /**
   * Should return all 16 indicator fields.
   */
  it('should return a complete IndicatorSnapshot with all fields', () => {
    const result = calculateAllIndicators(klines, ticker24h);

    expect(result.price).toBe(50_900);
    expect(result.volume_24h).toBe(25_000.5);
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

  /**
   * Price should come from the ticker24h lastPrice, not from klines.
   */
  it('should use ticker24h lastPrice for the price field', () => {
    const result = calculateAllIndicators(klines, { ...ticker24h, lastPrice: '99999' });
    expect(result.price).toBe(99_999);
  });

  /**
   * With minimal kline data (< 26 candles), MACD and BB should return defaults.
   */
  it('should handle minimal kline data gracefully', () => {
    const minKlines = {
      candles: Array.from({ length: 5 }, () => [0, '100', '101', '99', '100', '10']),
    };
    const result = calculateAllIndicators(minKlines, ticker24h);
    expect(result.macd_histogram).toBe(0);
    expect(result.bb_upper).toBe(0);
    expect(result.bb_lower).toBe(0);
  });
});
