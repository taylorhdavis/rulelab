import type { YaralEvaluationResult } from "../compiler"
import type { RuleTestRunResult } from "./run-rule-test"

export type FixtureExpectedResults = {
  rules: Record<string, RuleExpectedResult>
  version: 1
}

export type RuleExpectedResult = {
  matched: boolean
  matchedEventCounts: Record<string, number>
  matches?: RuleExpectedMatch[]
  outcomes: Record<string, unknown>
}

export type RuleExpectedMatch = {
  matchedEventCounts: Record<string, number>
  outcomes: Record<string, unknown>
  placeholders: Record<string, unknown>
}

export type ExpectedResultDiff = {
  actual: unknown
  expected: unknown
  path: string
}

export function parseFixtureExpectedResults(value: unknown): FixtureExpectedResults | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  const rules = (value as Record<string, unknown>).rules
  const version = (value as Record<string, unknown>).version
  if (version !== undefined && version !== 1) {
    return null
  }
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
    return null
  }

  const parsedRules: FixtureExpectedResults["rules"] = {}
  for (const [ruleName, expected] of Object.entries(rules)) {
    if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
      continue
    }
    const record = expected as Record<string, unknown>
    const firstMatch = parseExpectedMatch(record)
    parsedRules[ruleName] = {
      matched: Boolean(record.matched),
      matchedEventCounts: firstMatch.matchedEventCounts,
      matches: Array.isArray(record.matches)
        ? record.matches
            .filter((match): match is Record<string, unknown> => isRecord(match))
            .map(parseExpectedMatch)
        : undefined,
      outcomes: firstMatch.outcomes,
    }
  }

  return { rules: parsedRules, version: 1 }
}

export function captureExpectedResults(result: RuleTestRunResult): FixtureExpectedResults {
  return {
    rules: Object.fromEntries(
      result.rules.map((rule) => [
        rule.ruleName,
        {
          matched: rule.result.matched,
          matchedEventCounts: getMatchedEventCounts(rule.result.matchedEvents),
          matches: rule.result.matches.map((match) => ({
            matchedEventCounts: getMatchedEventCounts(match.matchedEvents),
            outcomes: match.outcomes,
            placeholders: match.placeholders,
          })),
          outcomes: rule.result.outcomes,
        },
      ])
    ),
    version: 1,
  }
}

export function summarizeExpectedResults(expectedResults: FixtureExpectedResults) {
  const entries = Object.entries(expectedResults.rules)
  return {
    matchedEventCount: entries.reduce(
      (total, [, expected]) =>
        total +
        Object.values(expected.matchedEventCounts).reduce(
          (count, value) => count + value,
          0
        ),
      0
    ),
    matchedRuleCount: entries.filter(([, expected]) => expected.matched).length,
    outcomeCount: entries.reduce(
      (total, [, expected]) => total + Object.keys(expected.outcomes).length,
      0
    ),
    matchCount: entries.reduce(
      (total, [, expected]) => total + (expected.matches?.length ?? (expected.matched ? 1 : 0)),
      0
    ),
    ruleCount: entries.length,
    ruleNames: entries.map(([ruleName]) => ruleName).sort(),
  }
}

export function compareExpectedResult(
  result: YaralEvaluationResult,
  expected: RuleExpectedResult
) {
  const failures: string[] = []
  const diffs: ExpectedResultDiff[] = []
  if (result.matched !== expected.matched) {
    failures.push(`Expected match=${expected.matched}, got ${result.matched}.`)
    diffs.push({
      actual: result.matched,
      expected: expected.matched,
      path: "matched",
    })
  }
  if (!deepEqual(result.outcomes, expected.outcomes)) {
    failures.push("Outcomes differ from expected results.")
    diffs.push(...diffRecords("outcomes", expected.outcomes, result.outcomes))
  }

  const actualCounts = getMatchedEventCounts(result.matchedEvents)
  if (!deepEqual(actualCounts, expected.matchedEventCounts)) {
    failures.push("Matched event counts differ from expected results.")
    diffs.push(
      ...diffRecords("matchedEventCounts", expected.matchedEventCounts, actualCounts)
    )
  }
  if (expected.matches) {
    const expectedMatches = sortExpectedMatches(expected.matches)
    const actualMatches = sortExpectedMatches(
      result.matches.map((match) => ({
        matchedEventCounts: getMatchedEventCounts(match.matchedEvents),
        outcomes: match.outcomes,
        placeholders: match.placeholders,
      }))
    )
    if (!deepEqual(actualMatches, expectedMatches)) {
      failures.push("Per-match details differ from expected results.")
      diffs.push(...diffMatches(expectedMatches, actualMatches))
    }
  }

  return {
    diffs,
    failures,
    passed: failures.length === 0,
  }
}

export function getMatchedEventCounts(matchedEvents: Record<string, unknown[]>) {
  return Object.fromEntries(
    Object.entries(matchedEvents).map(([name, events]) => [name, events.length])
  )
}

function diffMatches(
  expectedMatches: RuleExpectedMatch[],
  actualMatches: RuleExpectedMatch[]
) {
  const diffs: ExpectedResultDiff[] = []
  if (actualMatches.length !== expectedMatches.length) {
    diffs.push({
      actual: actualMatches.length,
      expected: expectedMatches.length,
      path: "matches.length",
    })
  }

  const maxLength = Math.max(expectedMatches.length, actualMatches.length)
  for (let index = 0; index < maxLength; index += 1) {
    const expected = expectedMatches[index]
    const actual = actualMatches[index]
    if (!expected || !actual) {
      diffs.push({
        actual: actual ?? null,
        expected: expected ?? null,
        path: `matches[${index}]`,
      })
      continue
    }
    diffs.push(
      ...diffRecords(
        `matches[${index}].matchedEventCounts`,
        expected.matchedEventCounts,
        actual.matchedEventCounts
      ),
      ...diffRecords(`matches[${index}].outcomes`, expected.outcomes, actual.outcomes),
      ...diffRecords(
        `matches[${index}].placeholders`,
        expected.placeholders,
        actual.placeholders
      )
    )
  }

  return diffs
}

function sortExpectedMatches(matches: RuleExpectedMatch[]) {
  return [...matches].sort((left, right) => {
    const leftKey = expectedMatchSortKey(left)
    const rightKey = expectedMatchSortKey(right)
    return leftKey.localeCompare(rightKey)
  })
}

function expectedMatchSortKey(match: RuleExpectedMatch) {
  return JSON.stringify(
    sortJson({
      matchedEventCounts: match.matchedEventCounts,
      outcomes: match.outcomes,
      placeholders: match.placeholders,
    })
  )
}

function diffRecords(
  prefix: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
) {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
  return keys
    .filter((key) => !deepEqual(actual[key], expected[key]))
    .map((key) => ({
      actual: actual[key] ?? null,
      expected: expected[key] ?? null,
      path: `${prefix}.${key}`,
    }))
}

function parseExpectedMatch(record: Record<string, unknown>): RuleExpectedMatch {
  return {
    matchedEventCounts: isRecord(record.matchedEventCounts)
      ? Object.fromEntries(
          Object.entries(record.matchedEventCounts).map(([name, count]) => [
            name,
            typeof count === "number" ? count : Number(count) || 0,
          ])
        )
      : {},
    outcomes: isRecord(record.outcomes) ? record.outcomes : {},
    placeholders: isRecord(record.placeholders) ? record.placeholders : {},
  }
}

function deepEqual(left: unknown, right: unknown) {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson)
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)])
    )
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
