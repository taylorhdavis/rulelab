import { Worker } from "node:worker_threads"

import { localTestWorkerSource } from "./generated/local-test-worker"

import {
  type RuleTestRunInput,
  type RuleTestRunResult,
} from "../domain/yaral/testing/run-rule-test"

type LocalTestWorkerMessage =
  | { result: RuleTestRunResult; type: "success" }
  | { message: string; type: "error" }

export class PublicApiLocalTestTimeoutError extends Error {
  constructor() {
    super("Public API local test exceeded the request budget.")
    this.name = "PublicApiLocalTestTimeoutError"
  }
}

export class PublicApiLocalTestWorkerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PublicApiLocalTestWorkerError"
  }
}

export async function runPublicApiLocalTest(
  input: RuleTestRunInput,
  options: { timeoutMs: number }
): Promise<RuleTestRunResult> {
  return runPublicApiLocalTestWorker(input, options)
}

async function runPublicApiLocalTestWorker(
  input: RuleTestRunInput,
  { timeoutMs }: { timeoutMs: number }
): Promise<RuleTestRunResult> {
  const worker = new Worker(localTestWorkerSource, {
    eval: true,
    workerData: input,
  })

  return new Promise<RuleTestRunResult>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      callback()
    }

    const timeout = setTimeout(() => {
      finish(() => {
        void worker.terminate()
        reject(new PublicApiLocalTestTimeoutError())
      })
    }, timeoutMs)

    worker.once("message", (message: LocalTestWorkerMessage) => {
      finish(() => {
        if (message.type === "success") {
          resolve(message.result)
          return
        }
        reject(new PublicApiLocalTestWorkerError(message.message))
      })
    })

    worker.once("error", (error) => {
      finish(() => {
        reject(new PublicApiLocalTestWorkerError(error.message))
      })
    })

    worker.once("exit", (code) => {
      if (code === 0 || settled) {
        return
      }
      finish(() => {
        reject(new PublicApiLocalTestWorkerError(`Local test worker exited with code ${code}.`))
      })
    })
  })
}
