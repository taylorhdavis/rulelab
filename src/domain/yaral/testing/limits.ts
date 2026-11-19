import type { RuleTestRunInput } from "./run-rule-test"

export const YARAL_TEST_LIMITS = {
  inlineDataTableMaxRows: 2_000,
  localTestMaxDurationMs: 5_000,
  ruleSourceMaxLength: 250_000,
  testMaxEvents: 1_000,
} as const

export type YaralRuleTestLimitViolation = {
  code: "data_table_rows" | "events" | "source"
  message: string
}

export function getYaralRuleTestLimitViolation(
  input: Pick<RuleTestRunInput, "dataTables" | "events" | "ruleText">
): YaralRuleTestLimitViolation | null {
  if (input.ruleText.length > YARAL_TEST_LIMITS.ruleSourceMaxLength) {
    return {
      code: "source",
      message: `Rule source must be ${YARAL_TEST_LIMITS.ruleSourceMaxLength.toLocaleString()} characters or fewer.`,
    }
  }
  if (input.events.length > YARAL_TEST_LIMITS.testMaxEvents) {
    return {
      code: "events",
      message: `Local tests can contain at most ${YARAL_TEST_LIMITS.testMaxEvents.toLocaleString()} events.`,
    }
  }
  const oversizedDataTable = input.dataTables?.find(
    (table) => table.rows.length > YARAL_TEST_LIMITS.inlineDataTableMaxRows
  )
  if (oversizedDataTable) {
    return {
      code: "data_table_rows",
      message: `Inline data tables can contain at most ${YARAL_TEST_LIMITS.inlineDataTableMaxRows.toLocaleString()} rows.`,
    }
  }
  return null
}
