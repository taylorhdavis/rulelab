import type { YaralDiagnostic, YaralSourceRange, YaralToken } from "./types"

export type YaralDiagnosticProfile = "editor" | "strict"

export type YaralDiagnosticProfileOptions = {
  diagnosticProfile?: YaralDiagnosticProfile
  treatWarningsAsErrors?: boolean
}

export type CreateDiagnosticOptions = {
  allowEmptyRange?: boolean
  code?: string
  source?: YaralDiagnostic["source"]
}

export function createDiagnostic(
  range: YaralSourceRange,
  message: string,
  severity: YaralDiagnostic["severity"] = "error",
  options: CreateDiagnosticOptions = {}
): YaralDiagnostic {
  return {
    ...(options.code ? { code: options.code } : {}),
    column: range.column,
    endColumn: range.endLine === range.line && !options.allowEmptyRange
      ? Math.max(range.endColumn, range.column + 1)
      : range.endColumn,
    endLine: range.endLine,
    line: range.line,
    message,
    severity,
    ...(options.source ? { source: options.source } : {}),
  }
}

export function getYaralBlockingDiagnostics(
  diagnostics: YaralDiagnostic[],
  options: YaralDiagnosticProfileOptions = {}
) {
  return diagnostics.filter((diagnostic) => isYaralDiagnosticBlocking(diagnostic, options))
}

export function isYaralDiagnosticBlocking(
  diagnostic: YaralDiagnostic,
  options: YaralDiagnosticProfileOptions = {}
) {
  if (diagnostic.severity === "error") {
    return true
  }
  if (diagnostic.severity !== "warning") {
    return false
  }
  return options.diagnosticProfile === "strict" || options.treatWarningsAsErrors === true
}

export function firstSourceRange(): YaralSourceRange {
  return {
    column: 1,
    endColumn: 1,
    endLine: 1,
    line: 1,
  }
}

export function firstToken(): YaralToken {
  return {
    ...firstSourceRange(),
    kind: "eof",
    value: "",
  }
}
