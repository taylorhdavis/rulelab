import type { YaralExpression } from "./types"

export type DataTableLookupEntry = {
  cidrValues: CompiledCidr[]
  nocaseRegexValues: (RegExp | null)[]
  nocaseScalarIndex: Set<string>
  regexValues: (RegExp | null)[]
  scalarIndex: Set<string>
  values: unknown[]
}

type CompiledCidr =
  | {
      family: "ipv4"
      mask: number
      rangeNumber: number
    }
  | {
      family: "ipv6"
      mask: bigint
      rangeNumber: bigint
    }

type CompiledIp =
  | {
      family: "ipv4"
      number: number
    }
  | {
      family: "ipv6"
      number: bigint
    }

export type RepeatedEvaluationValue = {
  __yaralRepeated: true
  quantifier: "all" | "any"
  values: unknown[]
}

type RuntimeOperatorHandler = (input: {
  left: unknown
  nocase: boolean
  right: unknown
  rightExpression?: YaralExpression
}) => unknown

const MAX_RUNTIME_OPERATOR_REGEX_CACHE_ENTRIES = 512
const runtimeOperatorRegexCache = new Map<string, RegExp | null>()
const MAX_RUNTIME_OPERATOR_CIDR_CACHE_ENTRIES = 1_024
const runtimeOperatorCidrCache = new Map<string, CompiledCidr | null>()

const RUNTIME_BINARY_OPERATORS: Record<string, RuntimeOperatorHandler> = {
  "!=": ({ left, nocase, right, rightExpression }) =>
    rightExpression?.kind === "literal" && rightExpression.literalKind === "regex"
      ? !evaluateRegex(left, right, nocase)
      : !compareEqual(left, right, { nocase }),
  "%": ({ left, right }) => toNumber(left) % toNumber(right),
  "*": ({ left, right }) => toNumber(left) * toNumber(right),
  "+": ({ left, right }) => toNumber(left) + toNumber(right),
  "-": ({ left, right }) => toNumber(left) - toNumber(right),
  "/": ({ left, right }) => toNumber(left) / toNumber(right),
  "<": ({ left, right }) => toOrderedNumber(left) < toOrderedNumber(right),
  "<=": ({ left, right }) => toOrderedNumber(left) <= toOrderedNumber(right),
  "=": ({ left, nocase, right, rightExpression }) =>
    rightExpression?.kind === "literal" && rightExpression.literalKind === "regex"
      ? evaluateRegex(left, right, nocase)
      : compareEqual(left, right, { nocase }),
  "==": ({ left, nocase, right, rightExpression }) =>
    rightExpression?.kind === "literal" && rightExpression.literalKind === "regex"
      ? evaluateRegex(left, right, nocase)
      : compareEqual(left, right, { nocase }),
  ">": ({ left, right }) => toOrderedNumber(left) > toOrderedNumber(right),
  ">=": ({ left, right }) => toOrderedNumber(left) >= toOrderedNumber(right),
  "in": ({ left, nocase, right }) => containsComparableValue(right, left, { nocase }),
  "in cidr": ({ left, right }) => containsCidrMatch(right, left),
  "in regex": ({ left, nocase, right }) => containsRegexMatch(right, left, nocase),
  "not in": ({ left, nocase, right }) => !containsComparableValue(right, left, { nocase }),
  "not in cidr": ({ left, right }) => !containsCidrMatch(right, left),
  "not in regex": ({ left, nocase, right }) => !containsRegexMatch(right, left, nocase),
  "not regex": ({ left, nocase, right }) => !evaluateRegex(left, right, nocase),
  "regex": ({ left, nocase, right }) => evaluateRegex(left, right, nocase),
}

export function evaluateBinaryValues(
  operator: string,
  left: unknown,
  right: unknown,
  nocase = false,
  rightExpression?: YaralExpression
): unknown {
  if (isRepeatedEvaluationValue(left) || isRepeatedEvaluationValue(right)) {
    return evaluateRepeatedBinaryValues(operator, left, right, nocase, rightExpression)
  }

  return RUNTIME_BINARY_OPERATORS[operator.toLowerCase()]?.({
    left,
    nocase,
    right,
    rightExpression,
  }) ?? false
}

export function createRepeatedEvaluationValue(
  quantifier: "all" | "any",
  value: unknown
): RepeatedEvaluationValue {
  return {
    __yaralRepeated: true,
    quantifier,
    values: toComparisonValues(value).filter((item) => item !== undefined && item !== null),
  }
}

export function createDataTableLookupEntry(values: unknown[]): DataTableLookupEntry {
  return {
    cidrValues: values.map(compileCidr).filter((value): value is CompiledCidr => Boolean(value)),
    nocaseRegexValues: values.map((value) => createRegex(value, true)),
    nocaseScalarIndex: new Set(values.map((value) => getDataTableScalarIndexKey(value, true))),
    regexValues: values.map((value) => createRegex(value, false)),
    scalarIndex: new Set(values.map((value) => getDataTableScalarIndexKey(value, false))),
    values,
  }
}

export function getDataTableScalarIndexKey(value: unknown, nocase = false) {
  const key = String(value)
  return nocase ? key.toLowerCase() : key
}

export function isRepeatedEvaluationValue(value: unknown): value is RepeatedEvaluationValue {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Partial<RepeatedEvaluationValue>).__yaralRepeated === true
  )
}

export function toComparisonValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value]
}

export function compareEqual(
  left: unknown,
  right: unknown,
  options: { nocase?: boolean } = {}
): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return toComparisonValues(left).some((leftValue) =>
      toComparisonValues(right).some((rightValue) => compareEqual(leftValue, rightValue, options))
    )
  }
  if (left === right) {
    return true
  }
  const leftText = String(left)
  const rightText = String(right)
  return options.nocase
    ? leftText.toLowerCase() === rightText.toLowerCase()
    : leftText === rightText
}

function containsComparableValue(
  list: unknown,
  value: unknown,
  options: { nocase?: boolean } = {}
): boolean {
  if (isDataTableLookupEntry(list)) {
    const index = options.nocase ? list.nocaseScalarIndex : list.scalarIndex
    return toComparisonValues(value).some((candidate) =>
      index.has(getDataTableScalarIndexKey(candidate, options.nocase))
    )
  }
  return Array.isArray(list) && toComparisonValues(value).some((candidate) =>
    list.some((item) => compareEqual(item, candidate, options))
  )
}

function containsRegexMatch(patterns: unknown, value: unknown, nocase = false): boolean {
  if (isDataTableLookupEntry(patterns)) {
    const regexes = nocase ? patterns.nocaseRegexValues : patterns.regexValues
    return toComparisonValues(value).some((candidate) =>
      regexes.some((regex) => testRuntimeRegex(regex, candidate))
    )
  }
  const values = isDataTableLookupEntry(patterns) ? patterns.values : patterns
  return Array.isArray(values) && toComparisonValues(value).some((candidate) =>
    values.some((pattern) => evaluateRegex(candidate, pattern, nocase))
  )
}

function containsCidrMatch(patterns: unknown, value: unknown): boolean {
  if (isDataTableLookupEntry(patterns)) {
    return toComparisonValues(value).some((candidate) =>
      compiledIpMatchesAnyCidr(compileIp(candidate), patterns.cidrValues)
    )
  }
  const values = isDataTableLookupEntry(patterns) ? patterns.values : patterns
  return Array.isArray(values) && toComparisonValues(value).some((candidate) =>
    rawCidrValuesMatchCandidate(values, candidate)
  )
}

function evaluateRegex(left: unknown, right: unknown, nocase = false): boolean {
  const regex = createRegex(right, nocase)
  if (regex && isRepeatedEvaluationValue(left)) {
    return evaluateRepeatedPredicate(left, (value) => testRuntimeRegex(regex, value))
  }
  return regex
    ? toComparisonValues(left).some((value) => testRuntimeRegex(regex, value))
    : false
}

function testRuntimeRegex(regex: RegExp | null, value: unknown): boolean {
  if (!regex) {
    return false
  }
  regex.lastIndex = 0
  return regex.test(String(value ?? ""))
}

function evaluateRepeatedBinaryValues(
  operator: string,
  left: unknown,
  right: unknown,
  nocase = false,
  rightExpression?: YaralExpression
): boolean {
  if (isRepeatedEvaluationValue(left)) {
    return quantifyRepeatedResults(
      left,
      left.values.map((value): boolean =>
        Boolean(evaluateBinaryValues(operator, value, right, nocase, rightExpression))
      )
    )
  }
  if (isRepeatedEvaluationValue(right)) {
    return quantifyRepeatedResults(
      right,
      right.values.map((value): boolean =>
        Boolean(evaluateBinaryValues(operator, left, value, nocase, rightExpression))
      )
    )
  }
  return false
}

function quantifyRepeatedResults(value: RepeatedEvaluationValue, results: boolean[]): boolean {
  return value.quantifier === "all"
    ? results.length > 0 && results.every(Boolean)
    : results.some(Boolean)
}

function evaluateRepeatedPredicate(
  value: RepeatedEvaluationValue,
  predicate: (value: unknown) => boolean
): boolean {
  return quantifyRepeatedResults(value, value.values.map((item): boolean => predicate(item)))
}

function createRegex(value: unknown, nocase = false) {
  if (typeof value !== "string") {
    return null
  }
  if (value.startsWith("`") && value.endsWith("`")) {
    return compileRuntimeRegex(value.slice(1, -1), nocase ? "i" : "")
  }
  const match = value.match(/^\/(.*)\/([a-z]*)$/i)
  if (!match) {
    return compileRuntimeRegex(value, nocase ? "i" : "")
  }
  const flags = nocase && !match[2].includes("i") ? `${match[2]}i` : match[2]
  return compileRuntimeRegex(match[1], flags)
}

function compileRuntimeRegex(source: string, flags: string) {
  const normalized = normalizeRuntimeRegexSource(source, flags)
  const cacheKey = `${normalized.flags}\u0000${normalized.source}`
  if (runtimeOperatorRegexCache.has(cacheKey)) {
    return runtimeOperatorRegexCache.get(cacheKey) ?? null
  }

  let compiled: RegExp | null = null
  try {
    compiled = new RegExp(normalized.source, normalized.flags)
  } catch {
    compiled = null
  }
  runtimeOperatorRegexCache.set(cacheKey, compiled)
  if (runtimeOperatorRegexCache.size > MAX_RUNTIME_OPERATOR_REGEX_CACHE_ENTRIES) {
    const oldestKey = runtimeOperatorRegexCache.keys().next().value
    if (oldestKey !== undefined) {
      runtimeOperatorRegexCache.delete(oldestKey)
    }
  }
  return compiled
}

function normalizeRuntimeRegexSource(source: string, flags: string) {
  const nextFlags = new Set(flags)
  const inline = source.match(/^\(\?([ims-]+)\)/)
  if (inline) {
    const enabled = inline[1]?.split("-")[0] ?? ""
    for (const flag of enabled) {
      if (["i", "m", "s"].includes(flag)) {
        nextFlags.add(flag)
      }
    }
    return { flags: [...nextFlags].join(""), source: source.slice(inline[0].length) }
  }
  return { flags: [...nextFlags].join(""), source }
}

function ipInCidr(ip: unknown, cidr: unknown): boolean {
  if (isRepeatedEvaluationValue(ip)) {
    return evaluateRepeatedPredicate(ip, (value): boolean => ipInCidr(value, cidr))
  }
  const compiled = compileCidr(cidr)
  return compiled ? ipMatchesCompiledCidr(ip, compiled) : false
}

function rawCidrValuesMatchCandidate(values: unknown[], candidate: unknown): boolean {
  if (isRepeatedEvaluationValue(candidate)) {
    return evaluateRepeatedPredicate(candidate, (value): boolean =>
      rawCidrValuesMatchCandidate(values, value)
    )
  }
  const compiledIp = compileIp(candidate)
  return compiledIp !== null && values.some((pattern) => {
    const compiledCidr = compileCidr(pattern)
    return compiledCidr !== null && compiledIpMatchesCidr(compiledIp, compiledCidr)
  })
}

function compileCidr(cidr: unknown): CompiledCidr | null {
  const cidrText = String(cidr ?? "")
  if (runtimeOperatorCidrCache.has(cidrText)) {
    return runtimeOperatorCidrCache.get(cidrText) ?? null
  }

  const compiled = compileCidrUncached(cidrText)
  runtimeOperatorCidrCache.set(cidrText, compiled)
  if (runtimeOperatorCidrCache.size > MAX_RUNTIME_OPERATOR_CIDR_CACHE_ENTRIES) {
    const oldestKey = runtimeOperatorCidrCache.keys().next().value
    if (oldestKey !== undefined) {
      runtimeOperatorCidrCache.delete(oldestKey)
    }
  }
  return compiled
}

function compileCidrUncached(cidrText: string): CompiledCidr | null {
  const [range, prefixText] = cidrText.split("/")
  const prefix = Number(prefixText)
  const rangeText = range ?? ""

  if (rangeText.includes(":")) {
    const rangeNumber = ipv6ToBigInt(rangeText)
    if (rangeNumber === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
      return null
    }
    const hostBits = BigInt(128 - prefix)
    const mask = prefix === 0 ? 0n : BigInt.asUintN(128, ((1n << BigInt(prefix)) - 1n) << hostBits)
    return { family: "ipv6", mask, rangeNumber }
  }

  const rangeNumber = ipv4ToNumber(rangeText)
  if (rangeNumber === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return { family: "ipv4", mask, rangeNumber }
}

function ipMatchesCompiledCidr(ip: unknown, cidr: CompiledCidr): boolean {
  if (isRepeatedEvaluationValue(ip)) {
    return evaluateRepeatedPredicate(ip, (value): boolean => ipMatchesCompiledCidr(value, cidr))
  }
  return compiledIpMatchesCidr(compileIp(ip), cidr)
}

function compileIp(ip: unknown): CompiledIp | null {
  const ipText = String(ip ?? "")
  if (ipText.includes(":")) {
    const number = ipv6ToBigInt(ipText)
    return number === null ? null : { family: "ipv6", number }
  }
  const number = ipv4ToNumber(ipText)
  return number === null ? null : { family: "ipv4", number }
}

function compiledIpMatchesAnyCidr(ip: CompiledIp | null, cidrs: CompiledCidr[]): boolean {
  return ip !== null && cidrs.some((cidr) => compiledIpMatchesCidr(ip, cidr))
}

function compiledIpMatchesCidr(ip: CompiledIp | null, cidr: CompiledCidr): boolean {
  if (!ip || ip.family !== cidr.family) {
    return false
  }
  if (ip.family === "ipv6" && cidr.family === "ipv6") {
    return (ip.number & cidr.mask) === (cidr.rangeNumber & cidr.mask)
  }
  if (ip.family === "ipv4" && cidr.family === "ipv4") {
    return (ip.number & cidr.mask) === (cidr.rangeNumber & cidr.mask)
  }
  return false
}

function ipv4ToNumber(value: string) {
  const parts = value.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null
  }
  return parts.reduce((result, part) => ((result << 8) + part) >>> 0, 0)
}

function ipv6ToBigInt(value: string) {
  const normalized = value.toLowerCase()
  if (!normalized || normalized.split("::").length > 2) {
    return null
  }

  const [leftText = "", rightText = ""] = normalized.split("::")
  const left = leftText ? leftText.split(":") : []
  const right = rightText ? rightText.split(":") : []
  const missing = normalized.includes("::") ? 8 - left.length - right.length : 0
  const parts = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right]

  if (parts.length !== 8) {
    return null
  }

  let result = 0n
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) {
      return null
    }
    result = (result << 16n) + BigInt(Number.parseInt(part, 16))
  }
  return result
}

function isDataTableLookupEntry(value: unknown): value is DataTableLookupEntry {
  return Boolean(
    value &&
      typeof value === "object" &&
      "values" in value &&
      "scalarIndex" in value &&
      "nocaseScalarIndex" in value
  )
}

function toNumber(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function toOrderedNumber(value: unknown) {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    return numeric
  }
  if (typeof value === "string") {
    const timestamp = Date.parse(value)
    return Number.isNaN(timestamp) ? 0 : timestamp
  }
  return 0
}
