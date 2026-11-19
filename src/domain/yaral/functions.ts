export type YaralFunctionSignature = {
  args?: readonly YaralFunctionArgumentSpec[]
  fidelity?: YaralFunctionRuntimeFidelity
  max: number
  min: number
  returnType: YaralFunctionReturnType
}

export type YaralFunctionRuntimeFidelity = "exact" | "approximate"

export type YaralFunctionArgumentSpec = {
  index: number
  message?: string
  repeat?: boolean
  types: readonly YaralFunctionArgumentType[]
}

export type YaralFunctionArgumentType =
  | "array"
  | "boolean"
  | "duration"
  | "null"
  | "number"
  | "regex"
  | "string"
  | "unknown"

export type YaralFunctionReturnType = "array" | "boolean" | "number" | "string" | "unknown"

type FunctionEntry = readonly [name: string, signature: YaralFunctionSignature]

const UNBOUNDED = Number.POSITIVE_INFINITY

const arrayFirstArgument: YaralFunctionArgumentSpec = {
  index: 0,
  message: "Function `{callee}` expects an array as its first argument.",
  types: ["array", "unknown"],
}

const cidrRangeArgument: YaralFunctionArgumentSpec = {
  index: 1,
  message: "CIDR ranges must be quoted strings.",
  types: ["string", "unknown"],
}

const ipAddressArgument: YaralFunctionArgumentSpec = {
  index: 0,
  message: "IP addresses must be strings.",
  types: ["string", "unknown"],
}

const regexPatternArgument: YaralFunctionArgumentSpec = {
  index: 1,
  message: "Function `{callee}` expects a regex or string pattern.",
  types: ["regex", "string", "unknown"],
}

const booleanArguments = (...indexes: number[]) =>
  indexes.map((index): YaralFunctionArgumentSpec => ({
    index,
    message: "Function `{callee}` expects a boolean argument.",
    types: ["boolean", "unknown"],
  }))

const numberArguments = (...indexes: number[]) =>
  indexes.map((index): YaralFunctionArgumentSpec => ({
    index,
    message: "Function `{callee}` expects a number argument.",
    types: ["number", "unknown"],
  }))

const stringArguments = (...indexes: number[]) =>
  indexes.map((index): YaralFunctionArgumentSpec => ({
    index,
    message: "Function `{callee}` expects a string argument.",
    types: ["string", "unknown"],
  }))

const stringOrNumberArguments = (...indexes: number[]) =>
  indexes.map((index): YaralFunctionArgumentSpec => ({
    index,
    message: "Function `{callee}` expects a string or number argument.",
    types: ["number", "string", "unknown"],
  }))

const booleanStringOrNumberArguments = (...indexes: number[]) =>
  indexes.map((index): YaralFunctionArgumentSpec => ({
    index,
    message: "Function `{callee}` expects a boolean, string, or number argument.",
    types: ["boolean", "number", "string", "unknown"],
  }))

const repeatedStringArguments = (index: number, message?: string): YaralFunctionArgumentSpec => ({
  index,
  message: message ?? "Function `{callee}` expects a string argument.",
  repeat: true,
  types: ["string", "unknown"],
})

const AGGREGATE_FUNCTIONS = [
  ["array", { min: 1, max: UNBOUNDED, returnType: "array" }],
  ["array_distinct", { min: 1, max: 1, returnType: "array" }],
  ["avg", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["count", { min: 1, max: 1, returnType: "number" }],
  ["count_distinct", { min: 1, max: 1, returnType: "number" }],
  ["max", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["min", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["stdev", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["stddev", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["sum", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
] as const satisfies readonly FunctionEntry[]

const GENERAL_FUNCTIONS = [
  ["arrays.contains", { min: 2, max: 2, returnType: "boolean", args: [arrayFirstArgument] }],
  ["arrays.concat", { min: 2, max: 2, returnType: "array", args: [{ ...arrayFirstArgument, repeat: true }] }],
  ["arrays.index_to_float", { min: 2, max: 2, returnType: "number", args: [arrayFirstArgument, ...numberArguments(1)] }],
  ["arrays.index_to_int", { min: 2, max: 2, returnType: "number", args: [arrayFirstArgument, ...numberArguments(1)] }],
  ["arrays.index_to_str", { min: 2, max: 2, returnType: "string", args: [arrayFirstArgument, ...numberArguments(1)] }],
  ["arrays.join_string", { min: 1, max: 2, returnType: "string", args: [arrayFirstArgument, ...stringArguments(1)] }],
  ["arrays.length", { min: 1, max: 1, returnType: "number", args: [arrayFirstArgument] }],
  ["arrays.max", { min: 1, max: 1, returnType: "number", args: [arrayFirstArgument] }],
  ["arrays.min", { min: 1, max: 1, returnType: "number", args: [arrayFirstArgument] }],
  ["arrays.size", { min: 1, max: 1, returnType: "number", args: [arrayFirstArgument] }],
  ["cast.as_bool", { min: 1, max: 1, returnType: "boolean", args: booleanStringOrNumberArguments(0) }],
  ["cast.as_float", { min: 1, max: 1, returnType: "number", args: stringOrNumberArguments(0) }],
  ["cast.as_int", { min: 1, max: 1, returnType: "number", args: stringOrNumberArguments(0) }],
  ["cast.as_string", { min: 1, max: 2, returnType: "string", args: stringArguments(1) }],
  ["cidr", { min: 1, max: UNBOUNDED, returnType: "array", args: [repeatedStringArguments(0, "Function `{callee}` expects quoted CIDR strings.")] }],
  ["group", { min: 1, max: UNBOUNDED, returnType: "array" }],
  ["hash.fingerprint2011", { min: 1, max: 1, returnType: "number", fidelity: "approximate", args: stringArguments(0) }],
  ["hash.sha256", { min: 1, max: 1, returnType: "string", args: stringArguments(0) }],
  ["if", { min: 2, max: 3, returnType: "unknown", args: booleanArguments(0) }],
  ["math.abs", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["math.ceil", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["math.floor", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["math.geo_distance", { min: 4, max: 4, returnType: "number", args: numberArguments(0, 1, 2, 3) }],
  ["math.is_increasing", { min: 2, max: UNBOUNDED, returnType: "boolean", args: [{ index: 0, repeat: true, message: "Function `{callee}` expects numeric arguments.", types: ["number", "unknown"] }] }],
  ["math.log", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["math.pow", { min: 2, max: 2, returnType: "number", args: numberArguments(0, 1) }],
  ["math.random", { min: 0, max: 0, returnType: "number" }],
  ["math.round", { min: 1, max: 2, returnType: "number", args: numberArguments(0, 1) }],
  ["math.sqrt", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["net.ip_in_range_cidr", { min: 2, max: 2, returnType: "boolean", args: [ipAddressArgument, cidrRangeArgument] }],
  ["optimization.sample_rate", { min: 3, max: 3, returnType: "boolean", fidelity: "approximate", args: [...stringArguments(0), ...numberArguments(1, 2)] }],
  ["re.capture", { min: 2, max: 3, returnType: "string", args: [...stringArguments(0), regexPatternArgument, ...numberArguments(2)] }],
  ["re.capture_all", { min: 2, max: 2, returnType: "array", args: [...stringArguments(0), regexPatternArgument] }],
  ["re.regex", { min: 2, max: 2, returnType: "boolean", args: [...stringArguments(0), regexPatternArgument] }],
  ["re.replace", { min: 3, max: 3, returnType: "string", args: [...stringArguments(0), regexPatternArgument, ...stringArguments(2)] }],
  ["strings.base64_decode", { min: 1, max: 1, returnType: "string", args: stringArguments(0) }],
  ["strings.concat", { min: 1, max: UNBOUNDED, returnType: "string", args: [repeatedStringArguments(0)] }],
  ["strings.coalesce", { min: 1, max: UNBOUNDED, returnType: "string", args: [repeatedStringArguments(0)] }],
  ["strings.contains", { min: 2, max: 2, returnType: "boolean", args: stringArguments(0, 1) }],
  ["strings.count_substrings", { min: 2, max: 2, returnType: "number", args: stringArguments(0, 1) }],
  ["strings.ends_with", { min: 2, max: 2, returnType: "boolean", args: stringArguments(0, 1) }],
  ["strings.extract_domain", { min: 1, max: 1, returnType: "string", args: stringArguments(0) }],
  ["strings.extract_hostname", { min: 1, max: 1, returnType: "string", args: stringArguments(0) }],
  ["strings.from_base64", { min: 1, max: 1, returnType: "string", args: stringArguments(0) }],
  ["strings.from_hex", { min: 1, max: 1, returnType: "string", args: stringArguments(0) }],
  ["strings.ltrim", { min: 2, max: 2, returnType: "string", args: stringArguments(0, 1) }],
  ["strings.reverse", { min: 1, max: 1, returnType: "string", args: stringArguments(0) }],
  ["strings.rtrim", { min: 2, max: 2, returnType: "string", args: stringArguments(0, 1) }],
  ["strings.split", { min: 1, max: 2, returnType: "array", args: stringArguments(0, 1) }],
  ["strings.starts_with", { min: 2, max: 2, returnType: "boolean", args: stringArguments(0, 1) }],
  ["strings.to_lower", { min: 1, max: 1, returnType: "string", args: stringArguments(0) }],
  ["strings.to_upper", { min: 1, max: 1, returnType: "string", args: stringArguments(0) }],
  ["strings.trim", { min: 2, max: 2, returnType: "string", args: stringArguments(0, 1) }],
  ["strings.url_decode", { min: 1, max: 1, returnType: "string", args: stringArguments(0) }],
  ["timestamp.as_unix_seconds", { min: 1, max: 2, returnType: "number", args: [...stringOrNumberArguments(0), ...stringArguments(1)] }],
  ["timestamp.current_seconds", { min: 0, max: 0, returnType: "number" }],
  ["timestamp.current_timestamp", { min: 0, max: 0, returnType: "string" }],
  ["timestamp.get_date", { min: 1, max: 2, returnType: "string", args: [...stringOrNumberArguments(0), ...stringArguments(1)] }],
  ["timestamp.get_day_of_week", { min: 1, max: 2, returnType: "number", args: [...stringOrNumberArguments(0), ...stringArguments(1)] }],
  ["timestamp.get_hour", { min: 1, max: 2, returnType: "number", args: [...stringOrNumberArguments(0), ...stringArguments(1)] }],
  ["timestamp.get_minute", { min: 1, max: 2, returnType: "number", args: [...stringOrNumberArguments(0), ...stringArguments(1)] }],
  ["timestamp.get_timestamp", { min: 1, max: 3, returnType: "string", args: [...stringOrNumberArguments(0), ...stringArguments(1, 2)] }],
  ["timestamp.get_week", { min: 1, max: 2, returnType: "number", args: [...stringOrNumberArguments(0), ...stringArguments(1)] }],
  ["timestamp.now", { min: 0, max: 0, returnType: "number" }],
] as const satisfies readonly FunctionEntry[]

const WINDOW_FUNCTIONS = [
  ["window.avg", { min: 1, max: 2, returnType: "number", args: [...numberArguments(0), ...booleanArguments(1)] }],
  ["window.first", { min: 2, max: 2, returnType: "unknown" }],
  ["window.last", { min: 2, max: 2, returnType: "unknown" }],
  ["window.median", { min: 1, max: 2, returnType: "number", args: [...numberArguments(0), ...booleanArguments(1)] }],
  ["window.mode", { min: 1, max: 1, returnType: "unknown" }],
  ["window.range", { min: 1, max: 2, returnType: "number", args: [...numberArguments(0), ...booleanArguments(1)] }],
  ["window.stddev", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
  ["window.variance", { min: 1, max: 1, returnType: "number", args: numberArguments(0) }],
] as const satisfies readonly FunctionEntry[]

export const YARAL_AGGREGATE_FUNCTION_NAMES = new Set(
  [...AGGREGATE_FUNCTIONS, ...WINDOW_FUNCTIONS].map(([name]) => name.toLowerCase())
)

const YARAL_FUNCTION_ENTRIES = [
  ...AGGREGATE_FUNCTIONS,
  ...GENERAL_FUNCTIONS,
  ...WINDOW_FUNCTIONS,
] as const satisfies readonly FunctionEntry[]

export const YARAL_FUNCTIONS = createFunctionMap(YARAL_FUNCTION_ENTRIES)

export function getYaralFunctionSignatures() {
  return YARAL_FUNCTION_ENTRIES.map(([name, signature]) => ({ name, signature }))
}

export function getYaralFunctionRuntimeFidelity(name: string): YaralFunctionRuntimeFidelity {
  return YARAL_FUNCTIONS.get(name.toLowerCase())?.fidelity ?? "exact"
}

export function getYaralApproximateFunctionMessage(name: string) {
  const callee = name.toLowerCase()
  if (callee === "hash.fingerprint2011") {
    return "`hash.fingerprint2011` is deterministic in RuleLab local tests but is not verified as Google SecOps-compatible."
  }
  if (callee === "optimization.sample_rate") {
    return "`optimization.sample_rate` uses RuleLab's local fingerprint approximation and may not match Google SecOps sampling exactly."
  }
  return `\`${callee}\` uses RuleLab local-test approximation and may not match Google SecOps exactly.`
}

export function isYaralUnsupportedRuntimeFunction(name: string) {
  return false
}

function createFunctionMap(entries: readonly FunctionEntry[]) {
  return new Map(entries.map(([name, signature]) => [name.toLowerCase(), signature]))
}
