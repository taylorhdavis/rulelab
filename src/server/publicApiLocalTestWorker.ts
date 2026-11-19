import { parentPort, workerData } from "node:worker_threads"

import { runYaralRuleTest, type RuleTestRunInput } from "../domain/yaral/testing/run-rule-test"

try {
  const result = runYaralRuleTest(workerData as RuleTestRunInput)
  parentPort?.postMessage({ result, type: "success" })
} catch (error) {
  parentPort?.postMessage({
    message: error instanceof Error ? error.message : "Local test worker failed.",
    type: "error",
  })
}
