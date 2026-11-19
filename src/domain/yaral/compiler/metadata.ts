import { compileYaralFile } from "./parser"
import type { YaralExpression, YaralRuntimePlan, YaralSectionAst } from "./types"

export type YaralRuleMetadata = {
  author: string | null
  description: string | null
  fields: Record<string, string>
  name: string | null
  severity: string | null
  tags: string[]
}

export type YaralDataTableReference = {
  column: string | null
  membership: "in" | "not in" | "reference"
  name: string
  token: string
}

export function getYaralRuleMetadata(source: string): YaralRuleMetadata {
  const rule = compileYaralFile(source).rules[0] ?? null
  const meta = rule?.plan?.meta ?? getAstMetaFallback(rule?.ast?.sections ?? [])

  return {
    author: meta.author ?? null,
    description: meta.description ?? null,
    fields: meta,
    name: rule?.summary.ruleName ?? rule?.ast?.name ?? null,
    severity: meta.severity ?? null,
    tags: parseYaralTags(meta.tags),
  }
}

export function getYaralRuleDataTableReferences(source: string): YaralDataTableReference[] {
  const rule = compileYaralFile(source).rules[0] ?? null
  return getYaralRuleDataTableReferencesFromSections(rule?.ast?.sections ?? [])
}

export function getYaralRuleDataTableReferencesFromSections(
  sections: YaralSectionAst[]
): YaralDataTableReference[] {
  const references = new Map<string, YaralDataTableReference>()

  for (const section of sections) {
    for (const statement of section.expressions) {
      if (!statement.expression) {
        continue
      }
      for (const reference of collectDataTableReferences(statement.expression)) {
        references.set(reference.token.toLowerCase(), reference)
      }
    }
  }

  return [...references.values()].sort((left, right) => left.token.localeCompare(right.token))
}

function collectDataTableReferences(expression: YaralExpression): YaralDataTableReference[] {
  const references: YaralDataTableReference[] = []

  function addReference(name: string, membership: YaralDataTableReference["membership"]) {
    const [tableName = "", ...columnParts] = name.split(".")
    if (!tableName) {
      return
    }
    const column = columnParts.length > 0 ? columnParts.join(".") : null
    const token = `%${tableName}${column ? `.${column}` : ""}`
    references.push({ column, membership, name: tableName, token })
  }

  function visit(node: YaralExpression, membership: YaralDataTableReference["membership"] = "reference") {
    if (node.kind === "referenceList") {
      addReference(node.name, membership)
      return
    }
    if (node.kind === "binary") {
      const nextMembership =
        node.operator === "in"
          ? "in"
          : node.operator === "not in"
            ? "not in"
            : "reference"
      visit(node.left)
      visit(node.right, nextMembership)
      return
    }
    if (node.kind === "array") {
      node.elements.forEach((element) => visit(element, membership))
      return
    }
    if (node.kind === "call") {
      node.args.forEach((arg) => visit(arg, membership))
      return
    }
    if (node.kind === "group") {
      visit(node.expression, membership)
      return
    }
    if (node.kind === "unary") {
      visit(node.argument, membership)
    }
  }

  visit(expression)
  return references
}

function getAstMetaFallback(sections: YaralSectionAst[]) {
  const meta: YaralRuntimePlan["meta"] = {}
  const metaSection = sections.find((section) => section.name === "meta")
  for (const statement of metaSection?.expressions ?? []) {
    const expression = statement.expression
    if (
      expression?.kind === "assignment" &&
      expression.left.kind === "identifier" &&
      expression.right.kind === "literal" &&
      expression.right.literalKind === "string"
    ) {
      meta[expression.left.name] = stripYaralMetadataString(expression.right.value)
    }
  }
  return meta
}

function parseYaralTags(value: string | null | undefined) {
  return [
    ...new Set(
      (value ?? "")
        .split(/[,;\s]+/)
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean)
    ),
  ]
}

function stripYaralMetadataString(value: string) {
  return value
    .replace(/^"/, "")
    .replace(/"$/, "")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
}
