import { compileYaralFile, evaluateYaralRule } from "../compiler"
import { createDiagnostic, firstSourceRange } from "../compiler/diagnostics"
import type {
  YaralDiagnostic,
  YaralEvaluationDataTable,
  YaralEvaluationOptions,
  YaralEvaluationResult,
} from "../compiler"

export type RuleTestRunResult = {
  diagnostics: YaralDiagnostic[]
  rules: Array<{
    diagnostics: YaralDiagnostic[]
    result: YaralEvaluationResult
    ruleName: string
  }>
}

export type RuleTestRunMode = "all" | "first" | "target"

export type RuleTestRunInput = {
  dataTables?: YaralEvaluationDataTable[]
  events: Record<string, unknown>[]
  evaluationOptions?: Pick<YaralEvaluationOptions, "evaluationRange" | "matchKeyUniverse" | "nowMs" | "random">
  ruleText: string
  runMode?: RuleTestRunMode
  targetRuleName?: string | null
}

export function runYaralRuleTest({
  dataTables = [],
  events,
  evaluationOptions = {},
  ruleText,
  runMode,
  targetRuleName,
}: RuleTestRunInput): RuleTestRunResult {
  const compiled = compileYaralFile(ruleText, { dataTables })
  const selectedRunMode = runMode ?? (targetRuleName ? "target" : "first")

  let rulesToRun: typeof compiled.rules
  if (selectedRunMode === "all") {
    rulesToRun = compiled.rules
  } else if (selectedRunMode === "target") {
    const selectedRules = targetRuleName
      ? compiled.rules.filter((rule) => {
          const ruleName = rule.summary.ruleName ?? rule.ast?.name
          return ruleName === targetRuleName
        })
      : []

    if (!targetRuleName) {
      return {
        diagnostics: [
          ...compiled.diagnostics,
          createDiagnostic(firstSourceRange(), "`targetRuleName` is required when runMode is `target`."),
        ],
        rules: [],
      }
    }

    if (selectedRules.length === 0) {
      return {
        diagnostics: [
          ...compiled.diagnostics,
          createDiagnostic(
            firstSourceRange(),
            `Rule \`${targetRuleName}\` was not found in the current editor buffer.`
          ),
        ],
        rules: [],
      }
    }

    rulesToRun = selectedRules
  } else {
    rulesToRun = compiled.rules.slice(0, 1)
  }

  return {
    diagnostics: compiled.diagnostics,
    rules: rulesToRun.map((rule, index) => ({
      diagnostics: rule.diagnostics,
      result: evaluateYaralRule(rule, events, { ...evaluationOptions, dataTables }),
      ruleName: rule.summary.ruleName ?? rule.ast?.name ?? targetRuleName ?? `rule_${index + 1}`,
    })),
  }
}
