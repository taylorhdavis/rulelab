import { createDiagnostic } from "./diagnostics"
import type { YaralDiagnostic, YaralToken, YaralTokenKind } from "./types"

type InternalToken = YaralToken & { __index?: number }

export function lexYaral(source: string) {
  const diagnostics: YaralDiagnostic[] = []
  const tokens: YaralToken[] = []
  let index = 0
  let line = 1
  let column = 1

  function make(
    kind: YaralTokenKind,
    value: string,
    startLine = line,
    startColumn = column
  ): YaralToken {
    return {
      column: startColumn,
      endColumn: startColumn + value.length,
      endLine: startLine,
      kind,
      line: startLine,
      value,
    }
  }

  function advance(value: string) {
    for (const char of value) {
      index += 1
      if (char === "\n") {
        line += 1
        column = 1
      } else {
        column += 1
      }
    }
  }

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === " " || char === "\t" || char === "\r") {
      advance(char)
      continue
    }
    if (char === "\n") {
      tokens.push(make("newline", "\n"))
      advance(char)
      continue
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        advance(source[index] ?? "")
      }
      continue
    }
    if (char === "/" && next === "*") {
      const startLine = line
      const startColumn = column
      advance("/*")
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        advance(source[index] ?? "")
      }
      if (index >= source.length) {
        diagnostics.push({
          column: startColumn,
          endColumn: column,
          endLine: line,
          line: startLine,
          message: "Unterminated block comment.",
          severity: "error",
        })
      } else {
        advance("*/")
      }
      continue
    }
    if (char === '"') {
      const token = readQuoted(
        source,
        '"',
        "string",
        line,
        column,
        () => index,
        () => ({ column, line }),
        advance,
        diagnostics
      )
      index = token.__index ?? index
      delete token.__index
      tokens.push(token)
      continue
    }
    if (char === "`") {
      const token = readQuoted(
        source,
        "`",
        "regex",
        line,
        column,
        () => index,
        () => ({ column, line }),
        advance,
        diagnostics
      )
      index = token.__index ?? index
      delete token.__index
      tokens.push(token)
      continue
    }
    if (char === "/" && shouldReadSlashRegex(tokens)) {
      const regexToken = readSlashRegex(
        source,
        line,
        column,
        () => index,
        () => ({ column, line }),
        advance,
        diagnostics
      )
      tokens.push(regexToken)
      index = regexToken.__index ?? index
      delete regexToken.__index
      continue
    }
    if (char === "$" || char === "#") {
      const startLine = line
      const startColumn = column
      const prefix = char
      let value = char
      let bracketDepth = 0
      let quote: string | null = null
      advance(char)
      while (index < source.length) {
        const pathChar = source[index] ?? ""
        if (!quote && bracketDepth === 0 && !isVariablePathChar(pathChar, false)) {
          break
        }
        if (!quote && bracketDepth > 0 && !isVariablePathChar(pathChar, true)) {
          break
        }
        value += pathChar
        advance(pathChar)
        if (quote) {
          if (pathChar === "\\") {
            const escaped = source[index] ?? ""
            value += escaped
            advance(escaped)
            continue
          }
          if (pathChar === quote) {
            quote = null
          }
          continue
        }
        if (pathChar === '"' || pathChar === "'") {
          quote = pathChar
        } else if (pathChar === "[") {
          bracketDepth += 1
        } else if (pathChar === "]") {
          bracketDepth = Math.max(0, bracketDepth - 1)
        }
      }
      const token = {
        column: startColumn,
        endColumn: column,
        endLine: startLine,
        kind: prefix === "$" ? "variable" : "countVariable",
        line: startLine,
        value,
      } satisfies YaralToken
      tokens.push(token)
      if (hasNegativeArrayIndex(value)) {
        diagnostics.push(
          diag(
            token,
            "YARA-L does not support negative array indexes. Use an expression like `0-1` instead."
          )
        )
      }
      continue
    }
    if (char === "%" && /[A-Za-z0-9_.-]/.test(next ?? "")) {
      const startLine = line
      const startColumn = column
      let value = "%"
      advance(char)
      while (/[A-Za-z0-9_.-]/.test(source[index] ?? "")) {
        value += source[index]
        advance(source[index] ?? "")
      }
      tokens.push({
        column: startColumn,
        endColumn: column,
        endLine: startLine,
        kind: "referenceList",
        line: startLine,
        value,
      })
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      const startLine = line
      const startColumn = column
      let value = ""
      while (/[A-Za-z0-9_.]/.test(source[index] ?? "")) {
        value += source[index]
        advance(source[index] ?? "")
      }
      tokens.push({
        column: startColumn,
        endColumn: column,
        endLine: startLine,
        kind: "identifier",
        line: startLine,
        value,
      })
      continue
    }
    if (/[0-9]/.test(char)) {
      const startLine = line
      const startColumn = column
      let value = ""
      while (/[0-9.]/.test(source[index] ?? "")) {
        value += source[index]
        advance(source[index] ?? "")
      }
      if (/[smhd]/i.test(source[index] ?? "")) {
        value += source[index]
        advance(source[index] ?? "")
        tokens.push({
          column: startColumn,
          endColumn: column,
          endLine: startLine,
          kind: "duration",
          line: startLine,
          value,
        })
      } else {
        tokens.push({
          column: startColumn,
          endColumn: column,
          endLine: startLine,
          kind: "number",
          line: startLine,
          value,
        })
      }
      continue
    }
    if (char === "," || char === ":" || "{}()[]".includes(char)) {
      const kind: YaralTokenKind =
        char === ","
          ? "comma"
          : char === ":"
            ? "colon"
            : "{}".includes(char)
              ? "brace"
              : "()".includes(char)
                ? "paren"
                : "bracket"
      tokens.push(make(kind, char))
      advance(char)
      continue
    }

    const twoChar = char + (next ?? "")
    if (["!=", "<=", ">=", "=="].includes(twoChar)) {
      tokens.push(make("operator", twoChar))
      advance(twoChar)
      continue
    }
    if ("=<>+-*/!%".includes(char)) {
      tokens.push(make("operator", char))
      advance(char)
      continue
    }

    const token = make("unknown", char)
    tokens.push(token)
    diagnostics.push(diag(token, `Unexpected character \`${char}\`.`))
    advance(char)
  }

  tokens.push({ column, endColumn: column, endLine: line, kind: "eof", line, value: "<eof>" })
  return { diagnostics, tokens }
}

function readQuoted(
  source: string,
  quote: '"' | "`",
  kind: YaralTokenKind,
  startLine: number,
  startColumn: number,
  getIndex: () => number,
  getPosition: () => { column: number; line: number },
  advance: (value: string) => void,
  diagnostics: YaralDiagnostic[]
): InternalToken {
  let index = getIndex()
  let value = quote
  advance(quote)
  index += 1
  while (index < source.length) {
    const char = source[index] ?? ""
    value += char
    advance(char)
    index += 1
    if (char === "\\") {
      const escaped = source[index] ?? ""
      value += escaped
      advance(escaped)
      index += 1
      continue
    }
    if (char === quote) {
      const position = getPosition()
      return {
        column: startColumn,
        endColumn: position.column,
        endLine: position.line,
        kind,
        line: startLine,
        value,
        __index: index,
      }
    }
    if (char === "\n") {
      break
    }
  }
  const position = getPosition()
  const token: InternalToken = {
    column: startColumn,
    endColumn: position.column,
    endLine: position.line,
    kind,
    line: startLine,
    value,
    __index: index,
  }
  diagnostics.push(diag(token, `Unterminated ${kind === "string" ? "string" : "regular expression"}.`))
  return token
}

function readSlashRegex(
  source: string,
  startLine: number,
  startColumn: number,
  getIndex: () => number,
  getPosition: () => { column: number; line: number },
  advance: (value: string) => void,
  diagnostics: YaralDiagnostic[]
): InternalToken {
  let index = getIndex()
  let value = "/"
  advance("/")
  index += 1
  while (index < source.length) {
    const char = source[index] ?? ""
    value += char
    advance(char)
    index += 1
    if (char === "\\") {
      const escaped = source[index] ?? ""
      value += escaped
      advance(escaped)
      index += 1
      continue
    }
    if (char === "/") {
      while (/[a-z]/i.test(source[index] ?? "")) {
        value += source[index]
        advance(source[index] ?? "")
        index += 1
      }
      const position = getPosition()
      const token: InternalToken = {
        column: startColumn,
        endColumn: position.column,
        endLine: position.line,
        kind: "regex",
        line: startLine,
        value,
        __index: index,
      }
      const flags = value.slice(value.lastIndexOf("/") + 1)
      if (flags) {
        diagnostics.push(
          diag(
            token,
            "YARA-L regex literals do not use trailing flags. Use `nocase` after the expression or `(?i)` inside the pattern."
          )
        )
      }
      return token
    }
    if (char === "\n") {
      break
    }
  }
  const position = getPosition()
  const token: InternalToken = {
    column: startColumn,
    endColumn: position.column,
    endLine: position.line,
    kind: "regex",
    line: startLine,
    value,
    __index: index,
  }
  diagnostics.push(diag(token, "Unterminated regular expression."))
  return token
}

function isVariablePathChar(char: string, insideBracket: boolean) {
  if (!char) {
    return false
  }
  if (char === "]") {
    return insideBracket
  }
  if (insideBracket) {
    return !/[\r\n]/.test(char)
  }
  return !/[\s,(){}<>=!+\-*%/]/.test(char)
}

function hasNegativeArrayIndex(value: string) {
  return /\[\s*-\d+\s*\]/.test(value)
}

function shouldReadSlashRegex(tokens: YaralToken[]) {
  const previous = [...tokens].reverse().find((token) => token.kind !== "newline")
  if (!previous) {
    return true
  }
  if (previous.kind === "identifier" && previous.value.toLowerCase() !== "regex") {
    return false
  }
  return ![
    "variable",
    "countVariable",
    "string",
    "number",
    "duration",
    "regex",
    "referenceList",
  ].includes(previous.kind) && ![")", "]"].includes(previous.value)
}

function diag(token: YaralToken, message: string): YaralDiagnostic {
  return createDiagnostic(token, message, "error", { allowEmptyRange: token.kind === "eof" })
}
