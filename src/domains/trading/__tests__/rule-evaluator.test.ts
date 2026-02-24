import { evaluateRuleGroup } from '../rule-evaluator';
import type { IndicatorSnapshot, RuleGroup } from '../types';

/**
 * Tests for the rule evaluator.
 * Verifies that single rules, AND/OR groups, and nested groups are
 * correctly evaluated against indicator snapshots.
 */
describe('evaluateRuleGroup', () => {
  /** Baseline indicator snapshot used across tests. */
  const indicators: IndicatorSnapshot = {
    price: 50000,
    volume_24h: 15000,
    price_change_pct: 2.5,
    rsi_14: 65,
    rsi_7: 70,
    macd_histogram: 150,
    macd_signal: 'above_signal',
    sma_20: 49500,
    sma_50: 48000,
    sma_200: 45000,
    ema_12: 49800,
    ema_20: 49600,
    ema_26: 49400,
    bb_upper: 51000,
    bb_lower: 48000,
    bb_position: 'between_bands',
  };

  /**
   * Tests for single numeric rules with all comparison operators.
   */
  describe('numeric operators', () => {
    /** Verifies the greater-than operator. */
    it('evaluates > operator correctly', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'price', operator: '>', value: '49000' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies the greater-than operator when condition is not met. */
    it('returns false for > when value is not greater', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'price', operator: '>', value: '51000' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies the less-than operator. */
    it('evaluates < operator correctly', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'rsi_14', operator: '<', value: '70' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies the less-than operator when condition is not met. */
    it('returns false for < when value is not less', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'rsi_14', operator: '<', value: '60' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies the greater-than-or-equal operator. */
    it('evaluates >= operator correctly', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'price', operator: '>=', value: '50000' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies >= returns false when value is less. */
    it('returns false for >= when value is less', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'price', operator: '>=', value: '50001' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies the less-than-or-equal operator. */
    it('evaluates <= operator correctly', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'rsi_7', operator: '<=', value: '70' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies <= returns false when value is greater. */
    it('returns false for <= when value is greater', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'rsi_7', operator: '<=', value: '69' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies the numeric equality operator. */
    it('evaluates = operator for numeric fields', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'price', operator: '=', value: '50000' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies = returns false when values differ. */
    it('returns false for = when values differ', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'price', operator: '=', value: '50001' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies the between operator with comma-separated range. */
    it('evaluates between operator correctly', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'rsi_14', operator: 'between', value: '60, 70' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies between returns false when value is outside range. */
    it('returns false for between when value is outside range', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'rsi_14', operator: 'between', value: '70, 80' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies between includes boundary values (inclusive range). */
    it('between is inclusive of boundary values', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'rsi_14', operator: 'between', value: '65, 65' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });
  });

  /**
   * Tests for string equality rules.
   */
  describe('string equality', () => {
    /** Verifies string equality for macd_signal. */
    it('matches macd_signal with = operator', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'macd_signal', operator: '=', value: 'above_signal' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies string equality returns false when values differ. */
    it('returns false when macd_signal does not match', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'macd_signal', operator: '=', value: 'below_signal' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies string equality for bb_position. */
    it('matches bb_position with = operator', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'bb_position', operator: '=', value: 'between_bands' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies string fields only support the = operator. */
    it('returns false for string fields with non-equality operators', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'macd_signal', operator: '>', value: 'above_signal' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });
  });

  /**
   * Tests for AND group combinator.
   */
  describe('AND groups', () => {
    /** Verifies AND group returns true when all rules match. */
    it('returns true when all rules in AND group match', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [
          { field: 'price', operator: '>', value: '49000' },
          { field: 'rsi_14', operator: '<', value: '70' },
          { field: 'macd_signal', operator: '=', value: 'above_signal' },
        ],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies AND group returns false when any rule fails. */
    it('returns false when any rule in AND group fails', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [
          { field: 'price', operator: '>', value: '49000' },
          { field: 'rsi_14', operator: '>', value: '80' }, // fails: 65 is not > 80
          { field: 'macd_signal', operator: '=', value: 'above_signal' },
        ],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });
  });

  /**
   * Tests for OR group combinator.
   */
  describe('OR groups', () => {
    /** Verifies OR group returns true when at least one rule matches. */
    it('returns true when at least one rule in OR group matches', () => {
      const group: RuleGroup = {
        combinator: 'or',
        rules: [
          { field: 'price', operator: '>', value: '60000' }, // fails
          { field: 'rsi_14', operator: '<', value: '70' },   // passes
        ],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies OR group returns false when no rules match. */
    it('returns false when no rules in OR group match', () => {
      const group: RuleGroup = {
        combinator: 'or',
        rules: [
          { field: 'price', operator: '>', value: '60000' },  // fails
          { field: 'rsi_14', operator: '>', value: '80' },     // fails
        ],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });
  });

  /**
   * Tests for nested groups.
   */
  describe('nested groups', () => {
    /** Verifies nested AND inside OR evaluates correctly. */
    it('evaluates nested AND inside OR', () => {
      const group: RuleGroup = {
        combinator: 'or',
        rules: [
          { field: 'price', operator: '>', value: '60000' }, // fails
          {
            combinator: 'and',
            rules: [
              { field: 'rsi_14', operator: '<', value: '70' },   // passes
              { field: 'sma_20', operator: '>', value: '49000' }, // passes
            ],
          },
        ],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies nested OR inside AND evaluates correctly. */
    it('evaluates nested OR inside AND', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [
          { field: 'price', operator: '>', value: '49000' }, // passes
          {
            combinator: 'or',
            rules: [
              { field: 'rsi_14', operator: '>', value: '80' },   // fails
              { field: 'rsi_7', operator: '>=', value: '70' },    // passes
            ],
          },
        ],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });

    /** Verifies deeply nested groups evaluate correctly. */
    it('evaluates deeply nested groups', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [
          {
            combinator: 'or',
            rules: [
              {
                combinator: 'and',
                rules: [
                  { field: 'price', operator: '>', value: '49000' },
                  { field: 'rsi_14', operator: '<', value: '70' },
                ],
              },
              { field: 'volume_24h', operator: '>', value: '100000' }, // fails
            ],
          },
        ],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(true);
    });
  });

  /**
   * Edge cases.
   */
  describe('edge cases', () => {
    /** Verifies an empty rule group returns false. */
    it('returns false for an empty rule group', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies an unknown field returns false. */
    it('returns false for an unknown field', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'unknown_field', operator: '>', value: '10' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies between with invalid format returns false. */
    it('returns false for between with invalid format', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'rsi_14', operator: 'between', value: 'invalid' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies between with non-numeric values returns false. */
    it('returns false for between with non-numeric values', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'rsi_14', operator: 'between', value: 'abc, def' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });

    /** Verifies an unknown operator returns false. */
    it('returns false for an unknown operator', () => {
      const group: RuleGroup = {
        combinator: 'and',
        rules: [{ field: 'price', operator: '!=', value: '50000' }],
      };

      expect(evaluateRuleGroup(group, indicators)).toBe(false);
    });
  });
});
