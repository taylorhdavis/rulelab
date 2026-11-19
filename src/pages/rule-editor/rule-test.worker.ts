import { runYaralRuleTest } from "../../domain/yaral/testing/run-rule-test"
import type {
  RuleTestRunInput,
  RuleTestRunResult,
} from "../../domain/yaral/testing/run-rule-test"

type RuleTestWorkerResponse =
  | {
      result: RuleTestRunResult
      type: "success"
    }
  | {
      message: string
      type: "error"
    }

self.addEventListener("message", (event: MessageEvent<RuleTestRunInput>) => {
  try {
    const result = runYaralRuleTest(event.data)
    self.postMessage({ result, type: "success" } satisfies RuleTestWorkerResponse)
  } catch (error) {
    self.postMessage({
      message: error instanceof Error ? error.message : "Rule test failed.",
      type: "error",
    } satisfies RuleTestWorkerResponse)
  }
})
