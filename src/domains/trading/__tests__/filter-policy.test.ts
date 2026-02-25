import { generateFilterPolicy } from '../filter-policy';
import type { RuleGroup } from '../types';

/**
 * Tests for the SNS filter policy generator.
 * Verifies that rule groups are correctly mapped to SNS message attribute
 * filter policies for efficient subscription filtering.
 */
describe('generateFilterPolicy', () => {
  /** Verifies the pair attribute is always present. */
  it('always includes the pair attribute', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.pair).toEqual(['BTC/USDT']);
  });

  /** Verifies the greater-than operator is mapped to a numeric condition. */
  it('maps > operator to numeric condition', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [{ field: 'price', operator: '>', value: '50000' }],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.price).toEqual([{ numeric: ['>', 50000] }]);
  });

  /** Verifies the less-than operator is mapped correctly. */
  it('maps < operator to numeric condition', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [{ field: 'rsi_14', operator: '<', value: '30' }],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.rsi_14).toEqual([{ numeric: ['<', 30] }]);
  });

  /** Verifies the >= operator is mapped correctly. */
  it('maps >= operator to numeric condition', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [{ field: 'volume_24h', operator: '>=', value: '1000' }],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.volume_24h).toEqual([{ numeric: ['>=', 1000] }]);
  });

  /** Verifies the <= operator is mapped correctly. */
  it('maps <= operator to numeric condition', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [{ field: 'ema_12', operator: '<=', value: '49000' }],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.ema_12).toEqual([{ numeric: ['<=', 49000] }]);
  });

  /** Verifies the = operator is mapped correctly for numeric fields. */
  it('maps = operator to numeric condition for numeric fields', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [{ field: 'price', operator: '=', value: '50000' }],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.price).toEqual([{ numeric: ['=', 50000] }]);
  });

  /** Verifies the between operator is mapped to a range condition. */
  it('maps between operator to numeric range condition', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [{ field: 'rsi_14', operator: 'between', value: '30, 70' }],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.rsi_14).toEqual([{ numeric: ['>=', 30, '<=', 70] }]);
  });

  /** Verifies string equality for macd_signal is mapped correctly. */
  it('maps string equality for macd_signal', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [{ field: 'macd_signal', operator: '=', value: 'bullish_crossover' }],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.macd_signal).toEqual(['bullish_crossover']);
  });

  /** Verifies string equality for bb_position is mapped correctly. */
  it('maps string equality for bb_position', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [{ field: 'bb_position', operator: '=', value: 'above_upper' }],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.bb_position).toEqual(['above_upper']);
  });

  /** Verifies nested OR groups are skipped in the filter policy. */
  it('skips nested OR groups', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [
        { field: 'price', operator: '>', value: '50000' },
        {
          combinator: 'or',
          rules: [
            { field: 'rsi_14', operator: '<', value: '30' },
            { field: 'rsi_14', operator: '>', value: '70' },
          ],
        },
      ],
    };

    const policy = generateFilterPolicy('ETH/USDT', query);

    expect(policy.pair).toEqual(['ETH/USDT']);
    expect(policy.price).toEqual([{ numeric: ['>', 50000] }]);
    // The nested OR group should be skipped
    expect(policy.rsi_14).toBeUndefined();
  });

  /** Verifies only pair is returned when root combinator is OR. */
  it('returns only pair for non-AND root combinator', () => {
    const query: RuleGroup = {
      combinator: 'or',
      rules: [
        { field: 'price', operator: '>', value: '50000' },
        { field: 'rsi_14', operator: '<', value: '30' },
      ],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy).toEqual({ pair: ['BTC/USDT'] });
  });

  /** Verifies an empty query produces only the pair attribute. */
  it('returns only pair for empty query', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy).toEqual({ pair: ['BTC/USDT'] });
  });

  /** Verifies multiple rules are all included in the policy. */
  it('includes multiple rules in the filter policy', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [
        { field: 'price', operator: '>', value: '40000' },
        { field: 'rsi_14', operator: '<', value: '70' },
        { field: 'macd_signal', operator: '=', value: 'above_signal' },
      ],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.pair).toEqual(['BTC/USDT']);
    expect(policy.price).toEqual([{ numeric: ['>', 40000] }]);
    expect(policy.rsi_14).toEqual([{ numeric: ['<', 70] }]);
    expect(policy.macd_signal).toEqual(['above_signal']);
  });

  /** Verifies string fields with non-equality operators are not included. */
  it('ignores string fields with non-equality operators', () => {
    const query: RuleGroup = {
      combinator: 'and',
      rules: [{ field: 'macd_signal', operator: '>', value: 'above_signal' }],
    };

    const policy = generateFilterPolicy('BTC/USDT', query);

    expect(policy.macd_signal).toBeUndefined();
  });

  /** Verifies pair-only filter when no query is provided. */
  it('returns pair-only filter when no query is provided', () => {
    const policy = generateFilterPolicy('BTC/USDT');

    expect(policy).toEqual({ pair: ['BTC/USDT'] });
  });
});
