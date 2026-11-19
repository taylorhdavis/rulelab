import { collectVariableExpressions, isAssignmentExpression, walkExpression } from "./ast"
import { stripYaralStringQuotes } from "./text"
import type {
  YaralAssignmentExpression,
  YaralBinaryExpression,
  YaralEventSymbol,
  YaralExpression,
  YaralLiteralExpression,
  YaralRuleAst,
  YaralSourceRange,
  YaralSymbol,
  YaralSymbolTable,
} from "./types"

type InternalEventSymbol = YaralEventSymbol
type InternalPlaceholderSymbol = YaralSymbol & {
  eventVariables: Set<string>
  sources: Set<string>
}

export function bindYaralSymbols(ast: YaralRuleAst | null): YaralSymbolTable {
  const eventVariables = new Map<string, InternalEventSymbol>()
  const outcomeVariables = new Map<string, YaralSymbol>()
  const placeholderVariables = new Map<string, InternalPlaceholderSymbol>()
  const functions = new Map<string, YaralSymbol>()
  const referencedFields = new Set<string>()

  if (!ast) {
    return emptySymbolTable()
  }

  for (const section of ast.sections) {
    if (section.name === "match" && section.match) {
      for (const variable of section.match.variables) {
        addSymbolReference(placeholderVariables, variable.name, variable.range)
      }
      if (section.match.pivot) {
        addSymbolReference(eventVariables, section.match.pivot.name, section.match.pivot.range)
      }
      continue
    }

    for (const statement of section.expressions) {
      if (!statement.expression) {
        continue
      }

      if (section.name === "events") {
        bindEventsExpression(
          statement.expression,
          eventVariables,
          placeholderVariables,
          functions,
          referencedFields
        )
      } else if (section.name === "outcome") {
        bindOutcomeExpression(statement.expression, outcomeVariables, eventVariables, placeholderVariables, functions, referencedFields)
      } else {
        bindExpression(statement.expression, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields)
      }
    }
  }

  return {
    eventVariables: sortSymbols([...eventVariables.values()]),
    functions: sortSymbols([...functions.values()]),
    outcomeVariables: sortSymbols([...outcomeVariables.values()]),
    placeholderVariables: [...placeholderVariables.entries()]
      .map(([name, symbol]) => {
        const eventVariableNames = [...symbol.eventVariables].sort()
        return {
          name,
          eventVariable: eventVariableNames[0] ?? null,
          eventVariables: eventVariableNames,
          isJoin: eventVariableNames.length > 1,
          references: symbol.references,
          source: [...symbol.sources].sort()[0] ?? "",
          sources: [...symbol.sources].sort(),
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
    referencedFields: [...referencedFields].sort(),
  }
}

function bindEventsExpression(
  expression: YaralExpression,
  eventVariables: Map<string, InternalEventSymbol>,
  placeholderVariables: Map<string, InternalPlaceholderSymbol>,
  functions: Map<string, YaralSymbol>,
  referencedFields: Set<string>
) {
  if (isAssignmentExpression(expression)) {
    bindEventsAssignment(expression, eventVariables, placeholderVariables, functions, referencedFields)
    return
  }

  addEventFilterPredicates(expression, eventVariables)
  addCompoundPlaceholderSources(expression, placeholderVariables)
  bindExpression(expression, eventVariables, placeholderVariables, new Map(), functions, referencedFields, {
    allowImplicitPlaceholders: true,
  })
}

function bindEventsAssignment(
  expression: YaralAssignmentExpression,
  eventVariables: Map<string, InternalEventSymbol>,
  placeholderVariables: Map<string, InternalPlaceholderSymbol>,
  functions: Map<string, YaralSymbol>,
  referencedFields: Set<string>
) {
  const leftVariables = collectVariableExpressions(expression.left)
  const rightVariables = collectVariableExpressions(expression.right)
  const left = leftVariables[0]

  if (left?.path) {
    const eventSymbol = ensureEventSymbol(eventVariables, left.name)
    addEventField(eventSymbol, left.path)
    eventSymbol.filterCount += 1
    const eventType = getEventTypeLiteral(expression)
    if (left.path === "metadata.event_type" && eventType) {
      addSorted(eventSymbol.eventTypes, stripYaralStringQuotes(eventType.value))
    }
    if (left.path === "metadata.log_type" && eventType) {
      addSorted(eventSymbol.logTypes, stripYaralStringQuotes(eventType.value))
    }
  }

  bindExpression(expression.left, eventVariables, placeholderVariables, new Map(), functions, referencedFields, {
    allowImplicitPlaceholders: true,
  })
  bindExpression(expression.right, eventVariables, placeholderVariables, new Map(), functions, referencedFields, {
    allowImplicitPlaceholders: true,
  })

  if (left?.kind === "variable" && left.path.length === 0) {
    const source = rightVariables.find((variable) => variable.path.length > 0)
    if (source) {
      addPlaceholderSource(placeholderVariables, left.name, source.name, `$${source.name}.${source.path}`, left.range)
    }
    return
  }

  const placeholder = rightVariables.find((variable) => variable.path.length === 0)
  const source = leftVariables.find((variable) => variable.path.length > 0)
  if (placeholder && source) {
    addPlaceholderSource(placeholderVariables, placeholder.name, source.name, `$${source.name}.${source.path}`, placeholder.range)
  }
}

function addCompoundPlaceholderSources(
  expression: YaralExpression,
  placeholderVariables: Map<string, InternalPlaceholderSymbol>
) {
  walkExpression(expression, (node) => {
    if (node.kind !== "binary" && !isAssignmentExpression(node)) {
      return
    }
    if (node.kind === "binary" && node.operator !== "=") {
      return
    }

    addPlaceholderSourcesFromComparison(node, placeholderVariables)
  })
}

function addPlaceholderSourcesFromComparison(
  expression: YaralBinaryExpression | YaralAssignmentExpression,
  placeholderVariables: Map<string, InternalPlaceholderSymbol>
) {
  const leftVariables = collectVariableExpressions(expression.left)
  const rightVariables = collectVariableExpressions(expression.right)
  const leftSources = leftVariables.filter((variable) => variable.path.length > 0)
  const rightSources = rightVariables.filter((variable) => variable.path.length > 0)

  for (const placeholder of leftVariables.filter((variable) => variable.path.length === 0)) {
    const source = rightSources[0]
    if (source) {
      addPlaceholderSource(
        placeholderVariables,
        placeholder.name,
        source.name,
        `$${source.name}.${source.path}`,
        placeholder.range
      )
    }
  }

  for (const placeholder of rightVariables.filter((variable) => variable.path.length === 0)) {
    const source = leftSources[0]
    if (source) {
      addPlaceholderSource(
        placeholderVariables,
        placeholder.name,
        source.name,
        `$${source.name}.${source.path}`,
        placeholder.range
      )
    }
  }
}

function addEventFilterPredicates(
  expression: YaralExpression,
  eventVariables: Map<string, InternalEventSymbol>
) {
  let countedComparison = false

  walkExpression(expression, (node) => {
    if (node.kind !== "binary") {
      return
    }
    if (!isEventFilterOperator(node.operator)) {
      return
    }

    const leftVariables = collectVariableExpressions(node.left).filter((variable) => variable.path.length > 0)
    if (leftVariables.length === 0) {
      return
    }

    countedComparison = true
    for (const variable of leftVariables) {
      const eventSymbol = ensureEventSymbol(eventVariables, variable.name)
      addEventField(eventSymbol, variable.path)
      eventSymbol.filterCount += 1
      const eventType = getEventTypeLiteral(node)
      if (variable.path === "metadata.event_type" && eventType) {
        addSorted(eventSymbol.eventTypes, stripYaralStringQuotes(eventType.value))
      }
      if (variable.path === "metadata.log_type" && eventType) {
        addSorted(eventSymbol.logTypes, stripYaralStringQuotes(eventType.value))
      }
    }
  })

  if (countedComparison) {
    return
  }

  const eventVariablesInExpression = new Map(
    collectVariableExpressions(expression)
      .filter((variable) => variable.path.length > 0)
      .map((variable) => [variable.name, variable])
  )
  for (const variable of eventVariablesInExpression.values()) {
    const eventSymbol = ensureEventSymbol(eventVariables, variable.name)
    addEventField(eventSymbol, variable.path)
    eventSymbol.filterCount += 1
  }
}

function isEventFilterOperator(operator: string) {
  return [
    "=",
    "==",
    "!=",
    "<",
    "<=",
    ">",
    ">=",
    "in",
    "in regex",
    "not in",
    "not in regex",
    "regex",
    "not regex",
    "is",
  ].includes(operator.toLowerCase())
}

function bindOutcomeExpression(
  expression: YaralExpression,
  outcomeVariables: Map<string, YaralSymbol>,
  eventVariables: Map<string, InternalEventSymbol>,
  placeholderVariables: Map<string, InternalPlaceholderSymbol>,
  functions: Map<string, YaralSymbol>,
  referencedFields: Set<string>
) {
  if (isAssignmentExpression(expression)) {
    const leftVariables = collectVariableExpressions(expression.left)
    const target = leftVariables[0]
    if (target?.kind === "variable" && target.path.length === 0) {
      addSymbolReference(outcomeVariables, target.name, target.range)
    }
    bindExpression(expression.right, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields)
    return
  }

  bindExpression(expression, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields)
}

function bindExpression(
  expression: YaralExpression,
  eventVariables: Map<string, InternalEventSymbol>,
  placeholderVariables: Map<string, InternalPlaceholderSymbol>,
  outcomeVariables: Map<string, YaralSymbol>,
  functions: Map<string, YaralSymbol>,
  referencedFields: Set<string>,
  options: { allowImplicitPlaceholders?: boolean } = {}
) {
  switch (expression.kind) {
    case "array":
      expression.elements.forEach((element) =>
        bindExpression(element, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields, options)
      )
      break
    case "binary":
      bindExpression(expression.left, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields, options)
      bindExpression(expression.right, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields, options)
      break
    case "call":
      addSymbolReference(functions, expression.callee, expression.range)
      expression.args.forEach((arg) =>
        bindExpression(arg, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields, options)
      )
      break
    case "countVariable":
    case "variable":
      if (expression.path.length > 0) {
        const eventSymbol = addEventReference(eventVariables, expression.name, expression.range)
        addEventField(eventSymbol, expression.path)
        referencedFields.add(expression.path)
      } else if (eventVariables.has(expression.name)) {
        addSymbolReference(eventVariables, expression.name, expression.range)
      } else if (outcomeVariables.has(expression.name)) {
        addSymbolReference(outcomeVariables, expression.name, expression.range)
      } else if (placeholderVariables.has(expression.name) || options.allowImplicitPlaceholders) {
        addSymbolReference(placeholderVariables, expression.name, expression.range)
      }
      break
    case "group":
      bindExpression(expression.expression, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields, options)
      break
    case "of":
      expression.expressions.forEach((element) =>
        bindExpression(element, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields, options)
      )
      break
    case "repeated":
      bindExpression(expression.argument, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields, options)
      break
    case "unary":
      bindExpression(expression.argument, eventVariables, placeholderVariables, outcomeVariables, functions, referencedFields, options)
      break
  }
}

function addPlaceholderSource(
  symbols: Map<string, InternalPlaceholderSymbol>,
  name: string,
  eventVariable: string,
  source: string,
  range: YaralSourceRange
) {
  const symbol = addSymbolReference(symbols, name, range)
  symbol.eventVariables.add(eventVariable)
  symbol.sources.add(source)
}

function addEventReference(
  symbols: Map<string, InternalEventSymbol>,
  name: string,
  range: YaralSourceRange
) {
  const existing = ensureEventSymbol(symbols, name)
  existing.references.push(range)
  return existing
}

function ensureEventSymbol(symbols: Map<string, InternalEventSymbol>, name: string) {
  const existing = symbols.get(name)
  if (existing) {
    return existing
  }

  const next = {
    eventTypes: [],
    fields: [],
    filterCount: 0,
    logTypes: [],
    name,
    references: [],
  } satisfies InternalEventSymbol
  symbols.set(name, next)
  return next
}

function addSymbolReference<T extends YaralSymbol>(
  symbols: Map<string, T>,
  name: string,
  range: YaralSourceRange
) {
  const existing =
    symbols.get(name) ??
    ({
      eventVariables: new Set<string>(),
      name,
      references: [],
      sources: new Set<string>(),
    } as unknown as T)

  existing.references.push(range)
  symbols.set(name, existing)
  return existing
}

function sortSymbols<T extends YaralSymbol>(symbols: T[]) {
  return symbols.sort((left, right) => left.name.localeCompare(right.name))
}

function addEventField(symbol: InternalEventSymbol, field: string) {
  addSorted(symbol.fields, field)
}

function addSorted(values: string[], value: string) {
  if (!values.includes(value)) {
    values.push(value)
    values.sort()
  }
}

function getEventTypeLiteral(
  expression: YaralBinaryExpression | YaralAssignmentExpression
): YaralLiteralExpression | null {
  return expression.right.kind === "literal" && expression.right.literalKind === "string"
    ? expression.right
    : null
}

function emptySymbolTable(): YaralSymbolTable {
  return {
    eventVariables: [],
    functions: [],
    outcomeVariables: [],
    placeholderVariables: [],
    referencedFields: [],
  }
}
