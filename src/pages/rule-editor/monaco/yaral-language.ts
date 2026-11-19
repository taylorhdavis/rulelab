import type { BeforeMount } from "@monaco-editor/react"
import type { editor, Position } from "monaco-editor"

import { getUdmFieldAllowedValues } from "../../../domain/udm/field-values"
import {
  getUdmChildFieldNames,
  getUdmFieldLiteralKind,
  isKnownUdmFieldPath,
  isKnownUdmFieldPrefix,
} from "../../../domain/udm/fields"
import {
  compileYaral,
  lexYaral,
  type YaralSourceRange,
  type YaralSymbol,
  type YaralToken,
} from "../../../domain/yaral/compiler"
import { getYaralFunctionSignatures } from "../../../domain/yaral/functions"

export type YaralDataTableCompletionItem = {
  columns: string[]
  description: string | null
  name: string
  rowCount: number
}

type YaralDataTableCompletionContext =
  | {
      kind: "table"
      matchLength: number
    }
  | {
      columnPrefix: string
      kind: "column"
      matchLength: number
      tableName: string
    }

type YaralUdmFieldCompletionContext = {
  matchLength: number
  parentPath: string
}

type YaralFunctionCompletionContext = {
  matchLength: number
}

type YaralValueCompletionContext = {
  fieldPath: string
  matchLength: number
  quoteOpen: boolean
}

type YaralSectionCompletionContext = {
  missingSections: YaralSectionCompletion[]
  matchLength: number
}

type YaralSectionCompletion = {
  detail: string
  insertText: string
  label: string
}

export type YaralCompilerMonacoToken = {
  scopes: string
  startIndex: number
  value: string
}

export type YaralCompilerReferencePosition = {
  column: number
  lineNumber: number
}

export type YaralCompilerReferenceRange = YaralSourceRange

type YaralLineTokenizationResult = {
  endInBlockComment: boolean
  tokens: YaralCompilerMonacoToken[]
}

class YaralCompilerTokenState {
  constructor(readonly inBlockComment = false) {}

  clone() {
    return new YaralCompilerTokenState(this.inBlockComment)
  }

  equals(other: YaralCompilerTokenState) {
    return other instanceof YaralCompilerTokenState && other.inBlockComment === this.inBlockComment
  }
}

let dataTableCompletionItems: YaralDataTableCompletionItem[] = []
const YARAL_FUNCTION_SIGNATURES = getYaralFunctionSignatures()
const YARAL_FUNCTION_COMPLETIONS = YARAL_FUNCTION_SIGNATURES.map(({ name, signature }) => ({
  detail: `${formatYaralFunctionArity(signature.min, signature.max)} -> ${signature.returnType}`,
  insertText: `${name}($0)`,
  label: name,
}))
const YARAL_FUNCTION_NAMES = new Set(YARAL_FUNCTION_SIGNATURES.map(({ name }) => name.toLowerCase()))
const YARAL_SECTION_NAMES = new Set(["meta", "events", "match", "outcome", "condition", "options"])
const YARAL_LANGUAGE_KEYWORDS = new Set([
  "all",
  "and",
  "any",
  "after",
  "before",
  "by",
  "false",
  "in",
  "is",
  "nocase",
  "not",
  "null",
  "of",
  "or",
  "over",
  "regex",
  "today",
  "true",
  "window_end",
  "window_start",
])
const YARAL_SECTION_COMPLETIONS: YaralSectionCompletion[] = [
  {
    detail: "Rule metadata",
    insertText: "meta:\n  ${1:author} = \"${2:admin}\"",
    label: "meta:",
  },
  {
    detail: "Event predicates",
    insertText: "events:\n  $e.metadata.event_type = \"${1:USER_LOGIN}\"",
    label: "events:",
  },
  {
    detail: "Match variables and time window",
    insertText: "match:\n  ${1:$placeholder} over ${2:5m}",
    label: "match:",
  },
  {
    detail: "Outcome assignments",
    insertText: "outcome:\n  ${1:$risk_score} = ${2:50}",
    label: "outcome:",
  },
  {
    detail: "Rule condition",
    insertText: "condition:\n  ${1:$e}",
    label: "condition:",
  },
  {
    detail: "Rule options",
    insertText: "options:\n  ${1:allow_zero_values} = ${2:false}",
    label: "options:",
  },
]

export function setYaralDataTableCompletions(items: YaralDataTableCompletionItem[]) {
  dataTableCompletionItems = items
}

export function getYaralCompilerMonacoTokens(source: string): YaralCompilerMonacoToken[] {
  const meaningfulTokens = lexYaral(source).tokens.filter(
    (token) => token.kind !== "newline" && token.kind !== "eof"
  )

  return meaningfulTokens.flatMap((token, index) =>
    getYaralMonacoTokensForCompilerToken(
      source,
      token,
      meaningfulTokens[index + 1] ?? null
    )
  )
}

export function getYaralCompilerMonacoLineTokens(
  line: string,
  inBlockComment = false
): YaralLineTokenizationResult {
  const tokens: YaralCompilerMonacoToken[] = []
  let index = 0
  let isInBlockComment = inBlockComment

  while (index < line.length) {
    if (isInBlockComment) {
      const closeIndex = line.indexOf("*/", index)
      const endIndex = closeIndex === -1 ? line.length : closeIndex + 2
      tokens.push({
        scopes: "comment.block.yara-l",
        startIndex: index,
        value: line.slice(index, endIndex),
      })
      index = endIndex
      isInBlockComment = closeIndex === -1
      continue
    }

    const lineCommentIndex = line.indexOf("//", index)
    const blockCommentIndex = line.indexOf("/*", index)
    const nextCommentIndex =
      lineCommentIndex === -1
        ? blockCommentIndex
        : blockCommentIndex === -1
          ? lineCommentIndex
          : Math.min(lineCommentIndex, blockCommentIndex)

    const codeEndIndex = nextCommentIndex === -1 ? line.length : nextCommentIndex
    if (codeEndIndex > index) {
      tokens.push(...getYaralCompilerMonacoTokens(line.slice(index, codeEndIndex)).map((token) => ({
        ...token,
        startIndex: token.startIndex + index,
      })))
      index = codeEndIndex
      continue
    }

    if (lineCommentIndex === index) {
      tokens.push({
        scopes: "comment.line.yara-l",
        startIndex: index,
        value: line.slice(index),
      })
      index = line.length
      continue
    }

    const closeIndex = line.indexOf("*/", index + 2)
    const endIndex = closeIndex === -1 ? line.length : closeIndex + 2
    tokens.push({
      scopes: "comment.block.yara-l",
      startIndex: index,
      value: line.slice(index, endIndex),
    })
    index = endIndex
    isInBlockComment = closeIndex === -1
  }

  return {
    endInBlockComment: isInBlockComment,
    tokens,
  }
}

export function getYaralCompilerReferenceRanges(
  source: string,
  position: YaralCompilerReferencePosition
): YaralCompilerReferenceRange[] {
  const selectedSymbol = getYaralCompilerSymbolAtPosition(source, position)

  return selectedSymbol?.references ?? []
}

export function getYaralCompilerDefinitionRange(
  source: string,
  position: YaralCompilerReferencePosition
): YaralCompilerReferenceRange | null {
  return getYaralCompilerSymbolAtPosition(source, position)?.references[0] ?? null
}

export function getYaralDataTableCompletionContext(
  linePrefix: string
): YaralDataTableCompletionContext | null {
  const referenceMatch = linePrefix.match(
    /%([A-Za-z_][A-Za-z0-9_-]*)(?:\.([A-Za-z_][A-Za-z0-9_-]*)?)?$/
  )
  if (referenceMatch) {
    const [, tableName, columnPrefix] = referenceMatch
    if (linePrefix.endsWith(".") || columnPrefix !== undefined) {
      return {
        columnPrefix: columnPrefix ?? "",
        kind: "column",
        matchLength: columnPrefix?.length ?? 0,
        tableName,
      }
    }
    return {
      kind: "table",
      matchLength: referenceMatch[0].length,
    }
  }

  if (linePrefix.endsWith("%")) {
    return {
      kind: "table",
      matchLength: 1,
    }
  }

  return null
}

export function getYaralUdmFieldCompletionContext(
  linePrefix: string
): YaralUdmFieldCompletionContext | null {
  const fieldMatch = linePrefix.match(
    /\$[A-Za-z_][A-Za-z0-9_]*(?:\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)?)?\.?$/
  )
  if (!fieldMatch || !fieldMatch[0].includes(".")) {
    return null
  }

  const referenceText = fieldMatch[0]
  const pathText = referenceText.slice(referenceText.indexOf(".") + 1)
  const isAfterDot = referenceText.endsWith(".")
  const segments = pathText.split(".").filter(Boolean)
  const parentSegments = isAfterDot ? segments : segments.slice(0, -1)
  const typedSegment = isAfterDot ? "" : segments.at(-1) ?? ""
  const parentPath = parentSegments.join(".")

  if (parentPath && !isKnownUdmFieldPath(parentPath) && !isKnownUdmFieldPrefix(parentPath)) {
    return null
  }

  return {
    matchLength: typedSegment.length,
    parentPath,
  }
}

export function getYaralFunctionCompletionContext(
  linePrefix: string
): YaralFunctionCompletionContext | null {
  const functionMatch = linePrefix.match(
    /(?:^|[^\w.$%])([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.?)$/
  )
  if (!functionMatch) {
    return null
  }

  const typedFunction = functionMatch[1]
  if (!typedFunction || typedFunction.startsWith("$") || typedFunction.startsWith("%")) {
    return null
  }

  return {
    matchLength: typedFunction.length,
  }
}

export function getYaralValueCompletionContext(
  linePrefix: string
): YaralValueCompletionContext | null {
  const valueMatch = linePrefix.match(
    /\$[A-Za-z_][A-Za-z0-9_]*\.([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])?)*)\s*(?:=|==|!=)\s*("?)([A-Za-z0-9_]*)$/
  )
  if (!valueMatch) {
    return null
  }

  const [, fieldPath, quote, typedValue] = valueMatch
  if (getUdmFieldAllowedValues(fieldPath).length === 0) {
    return null
  }

  return {
    fieldPath,
    matchLength: typedValue.length,
    quoteOpen: quote === "\"",
  }
}

export function getYaralSectionCompletionContext(
  source: string,
  linePrefix: string
): YaralSectionCompletionContext | null {
  const sectionLineMatch = linePrefix.match(/^\s*([A-Za-z]*)$/)
  if (!sectionLineMatch) {
    return null
  }

  const typedSection = sectionLineMatch[1].toLowerCase()
  const presentSections = getPresentYaralSections(source)
  const missingSections = YARAL_SECTION_COMPLETIONS.filter((section) => {
    const sectionName = section.label.slice(0, -1)
    return !presentSections.has(sectionName) && sectionName.startsWith(typedSection)
  })

  if (missingSections.length === 0) {
    return null
  }

  return {
    matchLength: typedSection.length,
    missingSections,
  }
}

export const configureYaralLanguage: BeforeMount = (monaco) => {
  const languagesWithYaralState = monaco.languages as typeof monaco.languages & {
    __yaralCompletionProviderRegistered?: boolean
  }
  const hasYaralLanguage = monaco.languages
    .getLanguages()
    .some((language: { id: string }) => language.id === "yaral")

  if (!hasYaralLanguage) {
    monaco.languages.register({
      id: "yaral",
      extensions: [".yaral"],
      aliases: ["YARA-L", "yaral"],
    })

    monaco.languages.setTokensProvider("yaral", {
      getInitialState: () => new YaralCompilerTokenState(),
      tokenize: (line: string, state: YaralCompilerTokenState) => {
        const result = getYaralCompilerMonacoLineTokens(line, state.inBlockComment)
        return {
          endState: new YaralCompilerTokenState(result.endInBlockComment),
          tokens: result.tokens.map((token) => ({
            scopes: token.scopes,
            startIndex: token.startIndex,
          })),
        }
      },
    })

    monaco.languages.setLanguageConfiguration("yaral", {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "/", close: "/" },
        { open: "`", close: "`" },
      ],
    })

    monaco.editor.defineTheme("yaral-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment.line.yara-l", foreground: "698a55" },
        { token: "comment.block.yara-l", foreground: "698a55" },
        { token: "entity.name.tag.yara-l", foreground: "679ad1" },
        { token: "entity.name.type.yara-l", foreground: "4ec9b0" },
        { token: "keyword.control.yara-l", foreground: "679ad1" },
        { token: "string.quoted.double.yara-l", foreground: "c5947c" },
        { token: "string.regexp.yara-l", foreground: "d3772e" },
        { token: "variable.name.yara-l", foreground: "C586C0" },
        { token: "variable.field.yara-l", foreground: "FFFFFF" },
        { token: "variable.other.reference.yara-l", foreground: "C586C0" },
        { token: "variable.parameter.yara-l", foreground: "679ad1" },
        { token: "constant.numeric.yara-l", foreground: "b8cba9" },
        { token: "constant.language.today.yara-l", foreground: "b8cba9" },
        { token: "constant.language.yara-l", foreground: "679ad1" },
        { token: "support.function.yara-l", foreground: "569cd6" },
        { token: "support.function.statistical.yara-l", foreground: "679ad1" },
        { token: "keyword.operator.assignment.yara-l", foreground: "d4d4d4" },
        { token: "keyword.operator.comparison.yara-l", foreground: "d4d4d4" },
        { token: "keyword.operator.numeric.yara-l", foreground: "d4d4d4" },
        { token: "brackets.yara-l", foreground: "ffd700" },
      ],
      colors: { "editor.background": "#1e1e1e" },
    })
  }

  if (languagesWithYaralState.__yaralCompletionProviderRegistered) {
    return
  }

  monaco.languages.registerCompletionItemProvider("yaral", {
    triggerCharacters: ["%", ".", "=", "\""],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const linePrefix = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1)
      const sectionContext = getYaralSectionCompletionContext(model.getValue(), linePrefix)

      if (sectionContext) {
        const range = new monaco.Range(
          position.lineNumber,
          position.column - sectionContext.matchLength,
          position.lineNumber,
          position.column
        )
        return {
          suggestions: sectionContext.missingSections.map((section, index) => ({
            detail: section.detail,
            documentation: "Insert missing YARA-L section",
            insertText: section.insertText,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            kind: monaco.languages.CompletionItemKind.Snippet,
            label: section.label,
            range,
            sortText: `0-${index.toString().padStart(3, "0")}-${section.label}`,
          })),
        }
      }

      const context = getYaralDataTableCompletionContext(linePrefix)

      if (context) {
        if (dataTableCompletionItems.length === 0) {
          return { suggestions: [] }
        }

        if (context.kind === "column") {
          const table = dataTableCompletionItems.find(
            (item) => item.name.toLowerCase() === context.tableName.toLowerCase()
          )
          if (!table) {
            return { suggestions: [] }
          }
          const range = new monaco.Range(
            position.lineNumber,
            position.column - context.matchLength,
            position.lineNumber,
            position.column
          )
          return {
            suggestions: table.columns.map((column, index) => ({
              detail: `${table.name}.${column}`,
              documentation: `${table.rowCount.toLocaleString()} rows in ${table.name}`,
              insertText: column,
              kind: monaco.languages.CompletionItemKind.Field,
              label: column,
              range,
              sortText: `1-${index.toString().padStart(3, "0")}-${column}`,
            })),
          }
        }

        const range = new monaco.Range(
          position.lineNumber,
          position.column - context.matchLength,
          position.lineNumber,
          position.column
        )
        return {
          suggestions: dataTableCompletionItems.map((table, index) => ({
            detail: `${table.columns.length.toLocaleString()} columns, ${table.rowCount.toLocaleString()} rows`,
            documentation: table.description || "Saved data table",
            insertText: `%${table.name}`,
            kind: monaco.languages.CompletionItemKind.Reference,
            label: table.name,
            range,
            sortText: `1-${index.toString().padStart(3, "0")}-${table.name}`,
          })),
        }
      }

      const udmContext = getYaralUdmFieldCompletionContext(linePrefix)
      if (udmContext) {
        const childFields = getUdmChildFieldNames(udmContext.parentPath)
        const range = new monaco.Range(
          position.lineNumber,
          position.column - udmContext.matchLength,
          position.lineNumber,
          position.column
        )
        return {
          suggestions: childFields.map((fieldName, index) => {
            const nextPath = udmContext.parentPath
              ? `${udmContext.parentPath}.${fieldName}`
              : fieldName
            const literalKind = getUdmFieldLiteralKind(nextPath)
            const valueCount = getUdmFieldAllowedValues(nextPath).length
            return {
              detail: nextPath,
              documentation: isKnownUdmFieldPath(nextPath)
                ? formatUdmFieldCompletionDocumentation(literalKind, valueCount)
                : "UDM field group",
              insertText: fieldName,
              kind: monaco.languages.CompletionItemKind.Field,
              label: fieldName,
              range,
              sortText: `2-${index.toString().padStart(3, "0")}-${fieldName}`,
            }
          }),
        }
      }

      const valueContext = getYaralValueCompletionContext(linePrefix)
      if (valueContext) {
        const values = getUdmFieldAllowedValues(valueContext.fieldPath)
        const range = new monaco.Range(
          position.lineNumber,
          position.column - valueContext.matchLength,
          position.lineNumber,
          position.column
        )
        return {
          suggestions: values.map((value, index) => ({
            detail: valueContext.fieldPath,
            documentation: "Known UDM enum value",
            insertText: valueContext.quoteOpen ? value : `"${value}"`,
            kind: monaco.languages.CompletionItemKind.EnumMember,
            label: `"${value}"`,
            range,
            sortText: `3-${index.toString().padStart(3, "0")}-${value}`,
          })),
        }
      }

      const functionContext = getYaralFunctionCompletionContext(linePrefix)
      if (functionContext) {
        const range = new monaco.Range(
          position.lineNumber,
          position.column - functionContext.matchLength,
          position.lineNumber,
          position.column
        )
        return {
          suggestions: YARAL_FUNCTION_COMPLETIONS.map((completion, index) => ({
            detail: completion.detail,
            documentation: "YARA-L function",
            insertText: completion.insertText,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            kind: monaco.languages.CompletionItemKind.Function,
            label: completion.label,
            range,
            sortText: `4-${index.toString().padStart(3, "0")}-${completion.label}`,
          })),
        }
      }

      return { suggestions: [] }
    },
  })

  monaco.languages.registerDefinitionProvider("yaral", {
    provideDefinition(model: editor.ITextModel, position: Position) {
      const range = getYaralCompilerDefinitionRange(model.getValue(), position)
      if (!range) {
        return null
      }

      return {
        uri: model.uri,
        range: new monaco.Range(
          range.line,
          range.column,
          range.endLine,
          range.endColumn
        ),
      }
    },
  })

  languagesWithYaralState.__yaralCompletionProviderRegistered = true
}

function getPresentYaralSections(source: string) {
  const sections = new Set<string>()
  const tokens = lexYaral(source).tokens

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind !== "identifier") {
      continue
    }
    const sectionName = token.value.toLowerCase()
    if (!YARAL_SECTION_NAMES.has(sectionName)) {
      continue
    }
    const nextToken = tokens.slice(index + 1).find((candidate) => candidate.kind !== "newline")
    if (nextToken?.kind === "colon") {
      sections.add(sectionName)
    }
  }

  return sections
}

function formatYaralFunctionArity(min: number, max: number) {
  if (max === Number.POSITIVE_INFINITY) {
    return `${min}+ args`
  }
  if (min === max) {
    return `${min} args`
  }
  return `${min}-${max} args`
}

function getYaralMonacoScopeForCompilerToken(token: YaralToken, nextToken: YaralToken | null) {
  switch (token.kind) {
    case "brace":
    case "bracket":
    case "paren":
      return "brackets.yara-l"
    case "countVariable":
    case "variable":
      return "variable.name.yara-l"
    case "duration":
    case "number":
      return "constant.numeric.yara-l"
    case "operator":
      return token.value === "=" ? "keyword.operator.assignment.yara-l" : "keyword.operator.comparison.yara-l"
    case "referenceList":
      return "variable.other.reference.yara-l"
    case "regex":
      return "string.regexp.yara-l"
    case "string":
      return "string.quoted.double.yara-l"
    case "identifier": {
      const value = token.value.toLowerCase()
      if (value === "rule") {
        return "entity.name.tag.yara-l"
      }
      if (YARAL_SECTION_NAMES.has(value) && nextToken?.kind === "colon") {
        return "keyword.control.yara-l"
      }
      if (YARAL_FUNCTION_NAMES.has(value) && nextToken?.value === "(") {
        return "support.function.yara-l"
      }
      if (YARAL_LANGUAGE_KEYWORDS.has(value)) {
        return value === "today" ? "constant.language.today.yara-l" : "constant.language.yara-l"
      }
      return ""
    }
    default:
      return ""
  }
}

function getYaralMonacoTokensForCompilerToken(
  source: string,
  token: YaralToken,
  nextToken: YaralToken | null
): YaralCompilerMonacoToken[] {
  const startIndex = getYaralTokenStartIndex(source, token)
  if (token.kind === "variable") {
    const tokens = getYaralMonacoTokensForVariableToken(token.value, startIndex)
    if (tokens.length > 0) {
      return tokens
    }
  }

  return [
    {
      scopes: getYaralMonacoScopeForCompilerToken(token, nextToken),
      startIndex,
      value: token.value,
    },
  ]
}

function getYaralMonacoTokensForVariableToken(value: string, startIndex: number) {
  const fieldStartIndex = value.indexOf(".")
  if (fieldStartIndex <= 0) {
    return []
  }

  const tokens: YaralCompilerMonacoToken[] = [
    {
      scopes: "variable.name.yara-l",
      startIndex,
      value: value.slice(0, fieldStartIndex),
    },
  ]
  const fieldText = value.slice(fieldStartIndex)
  const bracketStringPattern = /\[(["'])(?:\\.|(?!\1)[^\]])*\1\]/g
  let fieldOffset = 0

  for (const match of fieldText.matchAll(bracketStringPattern)) {
    const matchIndex = match.index ?? 0
    if (matchIndex > fieldOffset) {
      tokens.push({
        scopes: "variable.field.yara-l",
        startIndex: startIndex + fieldStartIndex + fieldOffset,
        value: fieldText.slice(fieldOffset, matchIndex),
      })
    }

    const bracketedValue = match[0]
    const quoteIndex = bracketedValue.indexOf(match[1] ?? "\"")
    const stringValue = bracketedValue.slice(quoteIndex, -1)
    tokens.push({
      scopes: "brackets.yara-l",
      startIndex: startIndex + fieldStartIndex + matchIndex,
      value: "[",
    })
    tokens.push({
      scopes: "string.quoted.double.yara-l",
      startIndex: startIndex + fieldStartIndex + matchIndex + quoteIndex,
      value: stringValue,
    })
    tokens.push({
      scopes: "brackets.yara-l",
      startIndex: startIndex + fieldStartIndex + matchIndex + bracketedValue.length - 1,
      value: "]",
    })
    fieldOffset = matchIndex + bracketedValue.length
  }

  if (fieldOffset < fieldText.length) {
    tokens.push({
      scopes: "variable.field.yara-l",
      startIndex: startIndex + fieldStartIndex + fieldOffset,
      value: fieldText.slice(fieldOffset),
    })
  }

  return tokens
}

function getYaralTokenStartIndex(source: string, token: YaralToken) {
  let line = 1
  let lineStartIndex = 0

  for (let index = 0; index < source.length && line < token.line; index += 1) {
    if (source[index] === "\n") {
      line += 1
      lineStartIndex = index + 1
    }
  }

  return lineStartIndex + token.column - 1
}

function getYaralCompilerSymbolAtPosition(
  source: string,
  position: YaralCompilerReferencePosition
) {
  const compiled = compileYaral(source)
  const symbols: YaralSymbol[] = [
    ...compiled.symbols.eventVariables,
    ...compiled.symbols.placeholderVariables,
    ...compiled.symbols.outcomeVariables,
    ...compiled.symbols.functions,
  ]

  return symbols.find((symbol) =>
    symbol.references.some((range) => containsYaralPosition(range, position))
  )
}

function containsYaralPosition(
  range: YaralSourceRange,
  position: YaralCompilerReferencePosition
) {
  if (position.lineNumber < range.line || position.lineNumber > range.endLine) {
    return false
  }
  if (position.lineNumber === range.line && position.column < range.column) {
    return false
  }
  if (position.lineNumber === range.endLine && position.column > range.endColumn) {
    return false
  }
  return true
}

function formatUdmFieldCompletionDocumentation(
  literalKind: ReturnType<typeof getUdmFieldLiteralKind>,
  valueCount: number
) {
  const parts = ["UDM field"]
  if (literalKind) {
    parts.push(literalKind)
  }
  if (valueCount > 0) {
    parts.push(`${valueCount} known values`)
  }
  return parts.join(" · ")
}
