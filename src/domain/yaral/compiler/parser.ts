import { createDiagnostic, firstToken } from "./diagnostics"
import { parseExpressionStatements } from "./expression"
import { lexYaral } from "./lexer"
import { parseMatchAst } from "./match"
import { buildYaralRuntimePlan } from "./runtime-plan"
import { validateYaralSemantics } from "./semantic"
import { bindYaralSymbols } from "./symbols"
import type {
  YaralCompiledRule,
  YaralCompileFileResult,
  YaralCompileOptions,
  YaralCompileResult,
  YaralCompileSummary,
  YaralDiagnostic,
  YaralRuleAst,
  YaralSectionAst,
  YaralSectionName,
  YaralSymbolTable,
  YaralToken,
} from "./types"

const SECTION_ORDER: YaralSectionName[] = [
  "meta",
  "events",
  "match",
  "outcome",
  "condition",
  "options",
]
const SECTION_NAMES = new Set<string>(SECTION_ORDER)
const RESERVED_RULE_NAMES = new Set([
  "all",
  "and",
  "any",
  "after",
  "before",
  "by",
  "false",
  "in",
  "is",
  "not",
  "null",
  "of",
  "or",
  "over",
  "true",
])

export function compileYaral(source: string, options: YaralCompileOptions = {}): YaralCompileResult {
  const lexed = lexYaral(source)
  const compileOptions = {
    approximateHelperDiagnostics: options.experimentalDiagnostics === true,
    experimentalDiagnostics: false,
    ...options,
  }
  const parser = new Parser(lexed.tokens, compileOptions)
  const parsed =
    (compileOptions.mode ?? "rule") === "rule"
      ? parser.parseRule()
      : parser.parseSectionInput()
  const compiled = compileParsedRule(parsed, compileOptions)

  return {
    ...compiled,
    diagnostics: dedupeDiagnostics([...lexed.diagnostics, ...compiled.diagnostics]),
    tokens: lexed.tokens,
  }
}

export function compileYaralFile(source: string, options: YaralCompileOptions = {}): YaralCompileFileResult {
  const lexed = lexYaral(source)
  const parser = new Parser(lexed.tokens, { ...options, mode: "rule" })
  const parsed = parser.parseRules()
  const rules = parsed.rules.map((rule) => compileParsedRule(rule, options))
  const fileDiagnostics = [
    ...(rules.length === 0
      ? [diag(firstToken(), "YARA-L files must contain at least one `rule` block.")]
      : []),
    ...validateFileRules(rules),
  ]

  return {
    diagnostics: dedupeDiagnostics([
      ...lexed.diagnostics,
      ...parsed.diagnostics,
      ...rules.flatMap((rule) => rule.diagnostics),
      ...fileDiagnostics,
    ]),
    rules,
    tokens: lexed.tokens,
  }
}

function compileParsedRule(parsed: {
  ast: YaralRuleAst | null
  diagnostics: YaralDiagnostic[]
}, options: YaralCompileOptions): YaralCompiledRule {
  const symbols = bindYaralSymbols(parsed.ast)
  const semanticDiagnostics = validateYaralSemantics(parsed.ast, symbols, options)

  return {
    ast: parsed.ast,
    diagnostics: dedupeDiagnostics([...parsed.diagnostics, ...semanticDiagnostics]),
    plan: buildYaralRuntimePlan(parsed.ast, symbols),
    summary: buildSummary(parsed.ast, symbols),
    symbols,
  }
}

class Parser {
  private diagnostics: YaralDiagnostic[] = []
  private index = 0

  constructor(
    private tokens: YaralToken[],
    private options: YaralCompileOptions = {}
  ) {}

  parseRules() {
    const rules: Array<{ ast: YaralRuleAst | null; diagnostics: YaralDiagnostic[] }> = []
    const diagnosticStart = this.diagnostics.length

    while (this.hasMoreTokens()) {
      if (!this.peekNextRuleToken()) {
        const token = this.take()
        if (token && token.kind !== "newline" && token.kind !== "eof") {
          this.diagnostics.push(diag(token, `Unexpected token \`${token.value}\` between rule blocks.`))
        }
        this.skipToNextRule()
        continue
      }

      const before = this.index
      rules.push(this.parseRule(false))
      if (this.index === before) {
        this.index += 1
      }
    }

    return {
      diagnostics: this.diagnostics.slice(diagnosticStart),
      rules,
    }
  }

  parseRule(validateTrailingTokens = true) {
    const diagnosticStart = this.diagnostics.length
    const ruleToken = this.nextNonNewline()
    if (!ruleToken || !isIdentifier(ruleToken, "rule")) {
      this.diagnostics.push(diag(ruleToken ?? firstPosition(), "YARA-L rules must start with `rule`."))
      return { ast: null, diagnostics: this.diagnostics.slice(diagnosticStart) }
    }

    const nameToken = this.nextNonNewline()
    const name = nameToken?.kind === "identifier" ? nameToken.value : null
    if (!nameToken || nameToken.kind !== "identifier") {
      this.diagnostics.push(diag(nameToken ?? ruleToken, "Expected a rule name after `rule`."))
    } else if (RESERVED_RULE_NAMES.has(nameToken.value.toLowerCase())) {
      this.diagnostics.push(diag(nameToken, "`" + nameToken.value + "` is a reserved YARA-L keyword."))
    } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nameToken.value)) {
      this.diagnostics.push(
        diag(nameToken, "Rule names must contain only letters, numbers, and underscores.")
      )
    }

    const openBrace = this.nextNonNewline()
    if (!openBrace || openBrace.value !== "{") {
      this.diagnostics.push(diag(openBrace ?? nameToken ?? ruleToken, "Expected `{` after the rule name."))
      return {
        ast: {
          closeBrace: null,
          name,
          nameToken: nameToken ?? null,
          openBrace: null,
          ruleToken,
          sections: [],
        },
        diagnostics: this.diagnostics.slice(diagnosticStart),
      }
    }

    const { closeBrace, sections } = this.collectSections()
    if (validateTrailingTokens) {
      this.validateNoTrailingTokens()
    }

    return {
      ast: {
        closeBrace,
        name,
        nameToken: nameToken ?? null,
        openBrace,
        ruleToken,
        sections,
      } satisfies YaralRuleAst,
      diagnostics: this.diagnostics.slice(diagnosticStart),
    }
  }

  parseSectionInput() {
    const diagnosticStart = this.diagnostics.length
    const { sections } = this.collectSectionInputSections()
    this.validateNoTrailingTokens()

    return {
      ast: {
        closeBrace: null,
        name: null,
        nameToken: null,
        openBrace: null,
        ruleToken: null,
        sections,
      } satisfies YaralRuleAst,
      diagnostics: this.diagnostics.slice(diagnosticStart),
    }
  }

  private collectSections() {
    const sections: YaralSectionAst[] = []
    let current: YaralSectionAst | null = null
    let closeBrace: YaralToken | null = null
    let depth = 0
    let reportedPreambleToken = false

    while (true) {
      const token = this.take()
      if (!token || token.kind === "eof") {
        this.diagnostics.push(diag(token ?? firstPosition(), "Expected closing `}` for rule block."))
        break
      }

      if (token.value === "{" || token.value === "(" || token.value === "[") {
        depth += 1
      }
      if (token.value === "}" || token.value === ")" || token.value === "]") {
        if (token.value === "}" && depth === 0) {
          closeBrace = token
          break
        }
        depth = Math.max(0, depth - 1)
      }

      if (
        depth === 0 &&
        token.kind === "identifier" &&
        SECTION_NAMES.has(token.value.toLowerCase()) &&
        this.peek()?.kind === "colon"
      ) {
        this.take()
        current = {
          expressions: [],
          match: null,
          name: token.value.toLowerCase() as YaralSectionName,
          nameToken: token,
          tokens: [],
        }
        sections.push(current)
        continue
      }

      if (current) {
        current.tokens.push(token)
      } else if (token.kind !== "newline" && !reportedPreambleToken) {
        this.diagnostics.push(diag(token, `Unexpected token \`${token.value}\` before any rule section.`))
        reportedPreambleToken = true
      }
    }

    this.validateSectionOrder(sections)
    this.parseSectionExpressions(sections)
    return { closeBrace, sections }
  }

  private collectSectionInputSections() {
    const sections: YaralSectionAst[] = []
    let current: YaralSectionAst | null = null
    let reportedPreambleToken = false

    while (true) {
      const token = this.take()
      if (!token || token.kind === "eof") {
        break
      }

      if (
        token.kind === "identifier" &&
        SECTION_NAMES.has(token.value.toLowerCase()) &&
        this.peek()?.kind === "colon"
      ) {
        this.take()
        current = {
          expressions: [],
          match: null,
          name: token.value.toLowerCase() as YaralSectionName,
          nameToken: token,
          tokens: [],
        }
        sections.push(current)
        continue
      }

      if (current) {
        current.tokens.push(token)
      } else if (token.kind !== "newline" && !reportedPreambleToken) {
        this.diagnostics.push(diag(token, `Unexpected token \`${token.value}\` before any YARA-L section.`))
        reportedPreambleToken = true
      }
    }

    this.validateSectionOrder(sections)
    this.parseSectionExpressions(sections)
    return { closeBrace: null, sections }
  }

  private parseSectionExpressions(sections: YaralSectionAst[]) {
    for (const section of sections) {
      if (section.name === "match") {
        const parsed = parseMatchAst(section.tokens, {
          allowDirectFields: (this.options.mode ?? "rule") !== "rule",
          requireRulePlaceholders: (this.options.mode ?? "rule") === "rule",
        })
        section.match = parsed.match
        this.diagnostics.push(...parsed.diagnostics)
        continue
      }
      const parsed = parseExpressionStatements(section.tokens, {
        allowDirectFields: (this.options.mode ?? "rule") !== "rule" && section.name !== "meta",
        preferTopLevelAssignment: section.name !== "condition",
      })
      section.expressions = parsed.statements
      this.diagnostics.push(...parsed.diagnostics)
    }
  }

  private validateSectionOrder(sections: YaralSectionAst[]) {
    const seen = new Set<YaralSectionName>()
    let previousOrder = -1

    for (const section of sections) {
      if (seen.has(section.name)) {
        this.diagnostics.push(diag(section.nameToken, `Duplicate \`${section.name}:\` section.`))
      }
      seen.add(section.name)

      const order = SECTION_ORDER.indexOf(section.name)
      if (order < previousOrder) {
        this.diagnostics.push(
          diag(
            section.nameToken,
            `\`${section.name}:\` is out of order. YARA-L rule sections must be ${SECTION_ORDER.join(", ")}.`
          )
        )
      }
      previousOrder = Math.max(previousOrder, order)
    }
  }

  private validateNoTrailingTokens() {
    while (true) {
      const token = this.take()
      if (!token || token.kind === "eof") {
        return
      }
      if (token.kind !== "newline") {
        this.diagnostics.push(diag(token, `Unexpected token \`${token.value}\` after rule block.`))
      }
    }
  }

  private nextNonNewline() {
    while (this.tokens[this.index]?.kind === "newline") {
      this.index += 1
    }
    return this.tokens[this.index++] ?? null
  }

  private hasMoreTokens() {
    while (this.tokens[this.index]?.kind === "newline") {
      this.index += 1
    }
    return Boolean(this.tokens[this.index] && this.tokens[this.index]?.kind !== "eof")
  }

  private peekNextRuleToken() {
    let offset = 0
    while (this.peek(offset)?.kind === "newline") {
      offset += 1
    }
    const token = this.peek(offset)
    return isIdentifier(token, "rule") ? token : null
  }

  private skipToNextRule() {
    while (this.tokens[this.index] && this.tokens[this.index]?.kind !== "eof") {
      if (this.peekNextRuleToken()) {
        return
      }
      this.index += 1
    }
  }

  private peek(offset = 0) {
    return this.tokens[this.index + offset] ?? null
  }

  private take() {
    return this.tokens[this.index++] ?? null
  }
}

function validateFileRules(rules: YaralCompiledRule[]) {
  const diagnostics: YaralDiagnostic[] = []
  const seenRuleNames = new Map<string, YaralToken>()

  for (const rule of rules) {
    const name = rule.ast?.name
    const nameToken = rule.ast?.nameToken
    if (!name || !nameToken) {
      continue
    }

    if (seenRuleNames.has(name)) {
      diagnostics.push(diag(nameToken, `Duplicate rule name \`${name}\`.`))
      continue
    }
    seenRuleNames.set(name, nameToken)
  }

  return diagnostics
}

function isIdentifier(token: YaralToken | null | undefined, value: string) {
  return token?.kind === "identifier" && token.value.toLowerCase() === value
}

function diag(token: YaralToken, message: string): YaralDiagnostic {
  return createDiagnostic(token, message, "error", { allowEmptyRange: token.kind === "eof" })
}

function dedupeDiagnostics(diagnostics: YaralDiagnostic[]) {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = [
      diagnostic.line,
      diagnostic.column,
      diagnostic.endLine,
      diagnostic.endColumn,
      diagnostic.severity,
      diagnostic.message,
    ].join(":")
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function buildSummary(
  ast: YaralRuleAst | null,
  symbols: YaralSymbolTable
): YaralCompileSummary {
  const presentSectionNames = new Set(ast?.sections.map((section) => section.name) ?? [])
  const matchSection = ast?.sections.find((section) => section.name === "match") ?? null

  return {
    eventFilters: symbols.eventVariables.reduce((count, symbol) => count + symbol.filterCount, 0),
    matchWindow: matchSection?.match?.duration?.value ?? null,
    matchWindowType: matchSection?.match?.windowKind ?? null,
    ruleName: ast?.name ?? null,
    ruleType: inferRuleType(symbols.eventVariables.length),
    sections: SECTION_ORDER.map((name) => ({ name, present: presentSectionNames.has(name) })),
  }
}

function inferRuleType(eventVariableCount: number) {
  if (eventVariableCount === 0) {
    return "unknown"
  }
  return eventVariableCount > 1 ? "multi_event" : "single_event"
}

function firstPosition(): YaralToken {
  return firstToken()
}
