import type { IndicatorSnapshot, Rule, RuleGroup } from '../shared/types';

/**
 * Evaluates a single rule against the indicator snapshot.
 *
 * @param rule - The rule to evaluate.
 * @param indicators - The current indicator values.
 * @returns Whether the rule condition is met.
 */
function evaluateRule(rule: Rule, indicators: IndicatorSnapshot): boolean {
  const fieldValue = indicators[rule.field as keyof IndicatorSnapshot];
  if (fieldValue === undefined) return false;

  // String comparison (macd_signal, bb_position)
  if (typeof fieldValue === 'string') {
    return rule.operator === '=' && fieldValue === rule.value;
  }

  const numericValue = fieldValue as number;
  const targetValue = parseFloat(rule.value);

  switch (rule.operator) {
    case '>':
      return numericValue > targetValue;
    case '<':
      return numericValue < targetValue;
    case '>=':
      return numericValue >= targetValue;
    case '<=':
      return numericValue <= targetValue;
    case '=':
      return numericValue === targetValue;
    case 'between': {
      const [low, high] = rule.value.split(',').map((v) => parseFloat(v.trim()));
      if (low === undefined || high === undefined || isNaN(low) || isNaN(high)) return false;
      return numericValue >= low && numericValue <= high;
    }
    default:
      return false;
  }
}

/**
 * Recursively evaluates a rule group tree against the indicator snapshot.
 *
 * AND groups require every child to match; OR groups require at least one.
 *
 * @param group - The root rule group to evaluate.
 * @param indicators - The current indicator values.
 * @returns Whether the entire rule group evaluates to true.
 */
export function evaluateRuleGroup(group: RuleGroup, indicators: IndicatorSnapshot): boolean {
  if (group.rules.length === 0) return false;

  const results = group.rules.map((child) => {
    if ('rules' in child) {
      return evaluateRuleGroup(child as RuleGroup, indicators);
    }
    return evaluateRule(child as Rule, indicators);
  });

  if (group.combinator === 'and') {
    return results.every(Boolean);
  }
  return results.some(Boolean);
}
