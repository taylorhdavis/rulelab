import { getYaralRuleTestLimitViolation } from "../../domain/yaral/testing/limits"
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

let activeWorker: Worker | null = null
let rejectActiveRun: ((error: Error) => void) | null = null

async function runYaralRuleTestFallback(input: RuleTestRunInput) {
  const { runYaralRuleTest } = await import("../../domain/yaral/testing/run-rule-test")
  return runYaralRuleTest(input)
}

export function cancelRunningYaralRuleTest() {
  activeWorker?.terminate()
  activeWorker = null
  rejectActiveRun?.(new Error("Rule test cancelled."))
  rejectActiveRun = null
}

export function runYaralRuleTestInBrowser(input: RuleTestRunInput): Promise<RuleTestRunResult> {
  const limitViolation = getYaralRuleTestLimitViolation(input)
  if (limitViolation) {
    return Promise.reject(new Error(limitViolation.message))
  }

  if (typeof Worker === "undefined") {
    return runYaralRuleTestFallback(input)
  }

  cancelRunningYaralRuleTest()

  let worker: Worker
  try {
    worker = new Worker(new URL("./rule-test.worker.ts", import.meta.url), {
      type: "module",
    })
  } catch {
    return runYaralRuleTestFallback(input)
  }

  activeWorker = worker

  return new Promise((resolve, reject) => {
    rejectActiveRun = reject

    function finish(callback: () => void) {
      if (activeWorker === worker) {
        activeWorker = null
      }
      if (rejectActiveRun === reject) {
        rejectActiveRun = null
      }
      worker.terminate()
      callback()
    }

    worker.onmessage = (event: MessageEvent<RuleTestWorkerResponse>) => {
      const message = event.data
      finish(() => {
        if (message.type === "success") {
          resolve(message.result)
        } else {
          reject(new Error(message.message))
        }
      })
    }

    worker.onerror = () => {
      finish(() => {
        void runYaralRuleTestFallback(input).then(resolve, reject)
      })
    }

    worker.postMessage(input)
  })
}
