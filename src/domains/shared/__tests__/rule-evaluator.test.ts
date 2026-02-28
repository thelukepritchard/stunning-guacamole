import { evaluateRuleGroup } from '../rule-evaluator';
import type { IndicatorSnapshot, RuleGroup, Rule } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A baseline indicator snapshot for testing. */
const INDICATORS: IndicatorSnapshot = {
  price: 50_000,
  volume_24h: 1_000_000,
  price_change_pct: 2.5,
  rsi_14: 55,
  rsi_7: 60,
  macd_histogram: 0.5,
  macd_signal: 'above_signal',
  sma_20: 49_000,
  sma_50: 48_000,
  sma_200: 45_000,
  ema_12: 50_100,
  ema_20: 49_500,
  ema_26: 49_000,
  bb_upper: 52_000,
  bb_lower: 48_000,
  bb_position: 'between_bands',
};

/** Helper to build a single-rule group. */
function singleRule(field: string, operator: string, value: string, combinator: 'and' | 'or' = 'and'): RuleGroup {
  return { combinator, rules: [{ field, operator, value }] };
}

// ─── empty rule group ─────────────────────────────────────────────────────────

describe('evaluateRuleGroup — empty group', () => {
  /**
   * An empty rule group should evaluate to false regardless of combinator.
   */
  it('should return false for an AND group with no rules', () => {
    expect(evaluateRuleGroup({ combinator: 'and', rules: [] }, INDICATORS)).toBe(false);
  });

  it('should return false for an OR group with no rules', () => {
    expect(evaluateRuleGroup({ combinator: 'or', rules: [] }, INDICATORS)).toBe(false);
  });
});

// ─── numeric operators ─────────────────────────────────────────────────────────

describe('evaluateRuleGroup — numeric operators', () => {
  /**
   * Greater-than operator: price (50,000) > 40,000 → true.
   */
  it('should evaluate > correctly (true case)', () => {
    expect(evaluateRuleGroup(singleRule('price', '>', '40000'), INDICATORS)).toBe(true);
  });

  it('should evaluate > correctly (false case)', () => {
    expect(evaluateRuleGroup(singleRule('price', '>', '60000'), INDICATORS)).toBe(false);
  });

  it('should evaluate > correctly (equal case is false)', () => {
    expect(evaluateRuleGroup(singleRule('price', '>', '50000'), INDICATORS)).toBe(false);
  });

  /**
   * Less-than operator: rsi_14 (55) < 70 → true.
   */
  it('should evaluate < correctly (true case)', () => {
    expect(evaluateRuleGroup(singleRule('rsi_14', '<', '70'), INDICATORS)).toBe(true);
  });

  it('should evaluate < correctly (false case)', () => {
    expect(evaluateRuleGroup(singleRule('rsi_14', '<', '50'), INDICATORS)).toBe(false);
  });

  /**
   * Greater-than-or-equal: price (50,000) >= 50,000 → true.
   */
  it('should evaluate >= correctly (equal case is true)', () => {
    expect(evaluateRuleGroup(singleRule('price', '>=', '50000'), INDICATORS)).toBe(true);
  });

  it('should evaluate >= correctly (greater case is true)', () => {
    expect(evaluateRuleGroup(singleRule('price', '>=', '49999'), INDICATORS)).toBe(true);
  });

  it('should evaluate >= correctly (less case is false)', () => {
    expect(evaluateRuleGroup(singleRule('price', '>=', '50001'), INDICATORS)).toBe(false);
  });

  /**
   * Less-than-or-equal: rsi_7 (60) <= 60 → true.
   */
  it('should evaluate <= correctly (equal case is true)', () => {
    expect(evaluateRuleGroup(singleRule('rsi_7', '<=', '60'), INDICATORS)).toBe(true);
  });

  it('should evaluate <= correctly (false case)', () => {
    expect(evaluateRuleGroup(singleRule('rsi_7', '<=', '59'), INDICATORS)).toBe(false);
  });

  /**
   * Numeric equals: price (50,000) = 50,000 → true.
   */
  it('should evaluate numeric = correctly (true case)', () => {
    expect(evaluateRuleGroup(singleRule('price', '=', '50000'), INDICATORS)).toBe(true);
  });

  it('should evaluate numeric = correctly (false case)', () => {
    expect(evaluateRuleGroup(singleRule('price', '=', '50001'), INDICATORS)).toBe(false);
  });

  /**
   * Between operator: rsi_14 (55) between 30,70 → true.
   */
  it('should evaluate between correctly (value within range)', () => {
    expect(evaluateRuleGroup(singleRule('rsi_14', 'between', '30,70'), INDICATORS)).toBe(true);
  });

  it('should evaluate between correctly (value at lower bound)', () => {
    expect(evaluateRuleGroup(singleRule('rsi_14', 'between', '55,70'), INDICATORS)).toBe(true);
  });

  it('should evaluate between correctly (value at upper bound)', () => {
    expect(evaluateRuleGroup(singleRule('rsi_14', 'between', '30,55'), INDICATORS)).toBe(true);
  });

  it('should evaluate between correctly (value outside range)', () => {
    expect(evaluateRuleGroup(singleRule('rsi_14', 'between', '60,70'), INDICATORS)).toBe(false);
  });

  /**
   * Between with invalid values should return false.
   */
  it('should return false for between with non-numeric values', () => {
    expect(evaluateRuleGroup(singleRule('rsi_14', 'between', 'abc,def'), INDICATORS)).toBe(false);
  });

  it('should return false for between with missing second value', () => {
    expect(evaluateRuleGroup(singleRule('rsi_14', 'between', '30'), INDICATORS)).toBe(false);
  });
});

// ─── string operators ──────────────────────────────────────────────────────────

describe('evaluateRuleGroup — string operators', () => {
  /**
   * String fields (macd_signal, bb_position) use = for comparison.
   */
  it('should match string field with = operator', () => {
    expect(evaluateRuleGroup(singleRule('macd_signal', '=', 'above_signal'), INDICATORS)).toBe(true);
  });

  it('should not match string field with wrong value', () => {
    expect(evaluateRuleGroup(singleRule('macd_signal', '=', 'below_signal'), INDICATORS)).toBe(false);
  });

  it('should match bb_position string field', () => {
    expect(evaluateRuleGroup(singleRule('bb_position', '=', 'between_bands'), INDICATORS)).toBe(true);
  });
});

// ─── unknown field / operator ──────────────────────────────────────────────────

describe('evaluateRuleGroup — edge cases', () => {
  /**
   * Unknown field should return false (evaluateRule returns false for undefined).
   */
  it('should return false for an unknown indicator field', () => {
    expect(evaluateRuleGroup(singleRule('nonexistent_field', '>', '0'), INDICATORS)).toBe(false);
  });

  /**
   * Unknown operator should return false.
   */
  it('should return false for an unknown operator', () => {
    expect(evaluateRuleGroup(singleRule('price', '!=', '50000'), INDICATORS)).toBe(false);
  });
});

// ─── AND combinator ────────────────────────────────────────────────────────────

describe('evaluateRuleGroup — AND combinator', () => {
  /**
   * AND: all rules true → true.
   */
  it('should return true when all rules in AND group match', () => {
    const group: RuleGroup = {
      combinator: 'and',
      rules: [
        { field: 'price', operator: '>', value: '40000' },
        { field: 'rsi_14', operator: '<', value: '70' },
      ],
    };
    expect(evaluateRuleGroup(group, INDICATORS)).toBe(true);
  });

  /**
   * AND: one rule false → false.
   */
  it('should return false when any rule in AND group does not match', () => {
    const group: RuleGroup = {
      combinator: 'and',
      rules: [
        { field: 'price', operator: '>', value: '40000' },
        { field: 'rsi_14', operator: '<', value: '50' }, // 55 < 50 is false
      ],
    };
    expect(evaluateRuleGroup(group, INDICATORS)).toBe(false);
  });
});

// ─── OR combinator ─────────────────────────────────────────────────────────────

describe('evaluateRuleGroup — OR combinator', () => {
  /**
   * OR: at least one rule true → true.
   */
  it('should return true when at least one rule in OR group matches', () => {
    const group: RuleGroup = {
      combinator: 'or',
      rules: [
        { field: 'price', operator: '>', value: '60000' }, // false
        { field: 'rsi_14', operator: '<', value: '70' },   // true
      ],
    };
    expect(evaluateRuleGroup(group, INDICATORS)).toBe(true);
  });

  /**
   * OR: all rules false → false.
   */
  it('should return false when no rules in OR group match', () => {
    const group: RuleGroup = {
      combinator: 'or',
      rules: [
        { field: 'price', operator: '>', value: '60000' }, // false
        { field: 'rsi_14', operator: '<', value: '50' },   // false
      ],
    };
    expect(evaluateRuleGroup(group, INDICATORS)).toBe(false);
  });
});

// ─── nested rule groups ────────────────────────────────────────────────────────

describe('evaluateRuleGroup — nested groups', () => {
  /**
   * AND( OR(true, false), true ) → AND(true, true) → true.
   */
  it('should evaluate nested OR inside AND correctly', () => {
    const group: RuleGroup = {
      combinator: 'and',
      rules: [
        {
          combinator: 'or',
          rules: [
            { field: 'price', operator: '>', value: '60000' },  // false
            { field: 'rsi_14', operator: '<', value: '70' },     // true
          ],
        } as RuleGroup,
        { field: 'volume_24h', operator: '>', value: '500000' }, // true
      ],
    };
    expect(evaluateRuleGroup(group, INDICATORS)).toBe(true);
  });

  /**
   * OR( AND(false, true), AND(true, true) ) → OR(false, true) → true.
   */
  it('should evaluate nested AND inside OR correctly', () => {
    const group: RuleGroup = {
      combinator: 'or',
      rules: [
        {
          combinator: 'and',
          rules: [
            { field: 'price', operator: '>', value: '60000' },  // false
            { field: 'rsi_14', operator: '<', value: '70' },     // true
          ],
        } as RuleGroup,
        {
          combinator: 'and',
          rules: [
            { field: 'price', operator: '>', value: '40000' },  // true
            { field: 'rsi_14', operator: '<', value: '70' },     // true
          ],
        } as RuleGroup,
      ],
    };
    expect(evaluateRuleGroup(group, INDICATORS)).toBe(true);
  });

  /**
   * Deeply nested: AND(AND(AND(true))) → true.
   */
  it('should evaluate deeply nested groups', () => {
    const deepGroup: RuleGroup = {
      combinator: 'and',
      rules: [{
        combinator: 'and',
        rules: [{
          combinator: 'and',
          rules: [{ field: 'price', operator: '>', value: '0' }],
        }],
      }],
    };
    expect(evaluateRuleGroup(deepGroup, INDICATORS)).toBe(true);
  });
});
