import { createDiagnostic, firstToken } from "./diagnostics"
import { getYaralDurationBoundsMessage } from "./duration"
import type {
  YaralDiagnostic,
  YaralMatchAst,
  YaralSourceRange,
  YaralToken,
  YaralVariableExpression,
} from "./types"

export type ParseMatchOptions = {
  allowDirectFields?: boolean
  requireRulePlaceholders?: boolean
}

export function parseMatchAst(tokens: YaralToken[], options: ParseMatchOptions = {}) {
  const diagnostics: YaralDiagnostic[] = []
  const meaningfulTokens = tokens.filter((token) => token.kind !== "newline" && token.kind !== "eof")
  const first = meaningfulTokens[0] ?? firstPosition()
  const last = meaningfulTokens.at(-1) ?? first
  const windowIndex = meaningfulTokens.findIndex((token) =>
    token.kind === "identifier" && ["over", "by"].includes(token.value.toLowerCase())
  )
  const variables: YaralVariableExpression[] = []

  if (meaningfulTokens.length === 0) {
    diagnostics.push(diag(first, "`match:` must define variables and a time window."))
    return { diagnostics, match: null }
  }

  if (windowIndex === -1) {
    diagnostics.push(diag(first, "`match:` must include `over <duration>` or `by <duration>`."))
  }

  const variableTokens =
    windowIndex === -1 ? meaningfulTokens : meaningfulTokens.slice(0, windowIndex)
  const variableNames = new Set<string>()

  for (const token of variableTokens) {
    if (token.kind === "comma") {
      continue
    }
    if (token.kind !== "variable" && !(options.allowDirectFields && isDirectFieldToken(token))) {
      diagnostics.push(diag(token, "`match:` can only list variables before the window keyword."))
      continue
    }
    const variable =
      token.kind === "variable"
        ? parseSimpleVariable(token)
        : parseDirectFieldToken(token)
    if (!variable) {
      diagnostics.push(
        diag(
          token,
          options.requireRulePlaceholders
            ? "`match:` variables must be simple placeholders like `$user`."
            : "`match:` variables must be simple variables or direct UDM fields."
        )
      )
      continue
    }
    if (variableNames.has(variable.name)) {
      diagnostics.push(diag(token, `Duplicate match variable $${variable.name}.`))
    }
    variableNames.add(variable.name)
    variables.push(variable)
  }

  if (variableTokens.length === 0 || variableTokens.every((token) => token.kind === "comma")) {
    diagnostics.push(
      diag(
        variableTokens[0] ?? meaningfulTokens[windowIndex] ?? first,
        options.requireRulePlaceholders
          ? "`match:` must list at least one placeholder before the window keyword."
          : "`match:` must list at least one variable or direct UDM field before the window keyword."
      )
    )
  } else if (variableTokens.at(-1)?.kind === "comma") {
    diagnostics.push(diag(variableTokens.at(-1) ?? first, "`match:` variable list must not end with a comma."))
  }

  const windowToken = windowIndex === -1 ? null : meaningfulTokens[windowIndex]
  const duration = windowIndex === -1 ? null : meaningfulTokens[windowIndex + 1] ?? null
  if (windowToken && duration?.kind !== "duration") {
    diagnostics.push(diag(duration ?? windowToken, `\`${windowToken.value}\` must be followed by a duration.`))
  } else if (windowToken && duration) {
    const maxMinutes = windowToken.value.toLowerCase() === "by" ? 72 * 60 : 48 * 60
    validateMatchDuration(duration, diagnostics, maxMinutes)
  }

  let pivot: YaralVariableExpression | null = null
  let windowDirection: YaralMatchAst["windowDirection"] = null
  let windowKind: YaralMatchAst["windowKind"] | null = null

  if (windowToken?.value.toLowerCase() === "by") {
    windowKind = "tumbling"
    if (meaningfulTokens[windowIndex + 2]) {
      diagnostics.push(diag(meaningfulTokens[windowIndex + 2], "Unexpected token after tumbling window duration."))
    }
  } else if (windowToken?.value.toLowerCase() === "over") {
    const direction = meaningfulTokens[windowIndex + 2]
    if (!direction) {
      windowKind = "hop"
    } else if (isIdentifier(direction, "before") || isIdentifier(direction, "after")) {
      windowDirection = direction.value.toLowerCase() as "after" | "before"
      const pivotToken = meaningfulTokens[windowIndex + 3]
      const parsedPivot = pivotToken?.kind === "variable" ? parseSimpleVariable(pivotToken) : null
      if (!parsedPivot) {
        diagnostics.push(diag(pivotToken ?? direction, "Sliding windows must name a simple pivot event variable."))
      } else {
        pivot = parsedPivot
      }
      if (meaningfulTokens[windowIndex + 4]) {
        diagnostics.push(diag(meaningfulTokens[windowIndex + 4], "Unexpected token after sliding window pivot."))
      }
      windowKind = "sliding"
    } else {
      diagnostics.push(diag(direction, "Sliding windows must use `before $event` or `after $event` after the duration."))
      windowKind = "hop"
    }
  }

  const match: YaralMatchAst = {
    duration: duration?.kind === "duration" ? duration : null,
    kind: "match",
    pivot,
    range: mergeRanges(first, last),
    variables,
    windowDirection,
    windowKind,
    windowToken,
  }

  return { diagnostics, match }
}

function validateMatchDuration(
  token: YaralToken,
  diagnostics: YaralDiagnostic[],
  maxMinutes: number
) {
  const message = getYaralDurationBoundsMessage(token.value, maxMinutes)
  if (message) {
    diagnostics.push(diag(token, message))
  }
}

function parseSimpleVariable(token: YaralToken): YaralVariableExpression | null {
  const match = token.value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/)
  if (!match) {
    return null
  }
  return {
    kind: "variable",
    name: match[1],
    path: "",
    range: token,
  }
}

function parseDirectFieldToken(token: YaralToken): YaralVariableExpression | null {
  if (!isDirectFieldToken(token)) {
    return null
  }
  return {
    kind: "variable",
    name: "",
    path: token.value,
    range: token,
  }
}

function isDirectFieldToken(token: YaralToken | null | undefined) {
  return token?.kind === "identifier" && token.value.includes(".")
}

function isIdentifier(token: YaralToken | null | undefined, value: string) {
  return token?.kind === "identifier" && token.value.toLowerCase() === value
}

function mergeRanges(left: YaralSourceRange, right: YaralSourceRange): YaralSourceRange {
  return {
    column: left.column,
    endColumn: right.endColumn,
    endLine: right.endLine,
    line: left.line,
  }
}

function diag(token: YaralToken, message: string): YaralDiagnostic {
  return createDiagnostic(token, message)
}

function firstPosition(): YaralToken {
  return firstToken()
}
