export type YaralRuntimeFunctionSources = {
  nowMs: () => number
  random: () => number
}

export type YaralRuntimeFunctionContext = {
  nocase?: boolean
  runtimeSources: YaralRuntimeFunctionSources
}

export type YaralRuntimeFunction = (
  values: unknown[],
  context: YaralRuntimeFunctionContext
) => unknown

type RepeatedRuntimeValue = {
  __yaralRepeated: true
  quantifier: "all" | "any"
  values: unknown[]
}

const MAX_RUNTIME_REGEX_CACHE_ENTRIES = 512
const runtimeRegexCache = new Map<string, RegExp | null>()

const RUNTIME_FUNCTIONS = new Map<string, YaralRuntimeFunction>([
  ["if", (values) => values[0] ? values[1] : (values[2] ?? 0)],
  ["arrays.concat", (values) => [...toArray(values[0]), ...toArray(values[1])]],
  ["arrays.contains", (values) => Array.isArray(values[0]) && values[0].some((item) => compareEqual(item, values[1]))],
  ["arrays.index_to_float", (values) => toNumber(toArray(values[0])[toNumber(values[1])])],
  ["arrays.index_to_int", (values) => Math.trunc(toNumber(toArray(values[0])[toNumber(values[1])]))],
  ["arrays.index_to_str", (values) => String(toArray(values[0])[toNumber(values[1])] ?? "")],
  ["arrays.join_string", (values) => toArray(values[0]).map((value) => String(value ?? "")).join(String(values[1] ?? ""))],
  ["arrays.length", (values) => toArray(values[0]).length],
  ["arrays.max", (values) => Math.max(...toArray(values[0]).map(toNumber))],
  ["arrays.min", (values) => Math.min(...toArray(values[0]).map(toNumber))],
  ["arrays.size", (values) => toArray(values[0]).length],
  ["cast.as_bool", (values) => Boolean(values[0])],
  ["cast.as_float", (values) => toNumber(values[0])],
  ["cast.as_int", (values) => Math.trunc(toNumber(values[0]))],
  ["cast.as_string", (values) => String(values[0] ?? "")],
  ["cidr", (values) => values],
  ["group", (values) => values],
  ["hash.fingerprint2011", (values) => fingerprint2011Compat(values[0])],
  ["hash.sha256", (values) => sha256Hex(values[0])],
  ["math.abs", (values) => Math.abs(toNumber(values[0]))],
  ["math.ceil", (values) => Math.ceil(toNumber(values[0]))],
  ["math.floor", (values) => Math.floor(toNumber(values[0]))],
  ["math.geo_distance", (values) => geoDistance(values[0], values[1], values[2], values[3])],
  ["math.is_increasing", (values) => values.every((value, index) => index === 0 || toNumber(values[index - 1]) < toNumber(value))],
  ["math.log", (values) => Math.log(toNumber(values[0]))],
  ["math.pow", (values) => Math.pow(toNumber(values[0]), toNumber(values[1]))],
  ["math.random", (_values, context) => context.runtimeSources.random()],
  ["math.round", (values) => {
    const places = values[1] === undefined ? 0 : toNumber(values[1])
    const factor = 10 ** places
    return Math.round(toNumber(values[0]) * factor) / factor
  }],
  ["math.sqrt", (values) => Math.sqrt(Math.max(0, toNumber(values[0])))],
  ["net.ip_in_range_cidr", (values) => ipInCidr(values[0], values[1])],
  ["optimization.sample_rate", (values) => sampleRate(values[0], values[1], values[2])],
  ["re.capture", (values, context) => captureRegex(values[0], values[1], values[2], Boolean(context.nocase))],
  ["re.capture_all", (values, context) => captureAllRegex(values[0], values[1], Boolean(context.nocase))],
  ["re.regex", (values, context) => evaluateRegex(values[0], values[1], Boolean(context.nocase))],
  ["re.replace", (values, context) => replaceRegex(values[0], values[1], values[2], Boolean(context.nocase))],
  ["strings.base64_decode", (values) => decodeBase64(values[0])],
  ["strings.coalesce", (values) => values.find((value) => value !== undefined && value !== null && value !== "") ?? ""],
  ["strings.contains", (values, context) =>
    stringValueMatches(values[0], (value) =>
      compareStringPredicate(value, values[1], Boolean(context.nocase), (source, needle) => source.includes(needle))
    )],
  ["strings.concat", (values) => values.map((value) => String(value ?? "")).join("")],
  ["strings.count_substrings", (values, context) => countSubstrings(values[0], values[1], Boolean(context.nocase))],
  ["strings.ends_with", (values, context) =>
    stringValueMatches(values[0], (value) =>
      compareStringPredicate(value, values[1], Boolean(context.nocase), (source, needle) => source.endsWith(needle))
    )],
  ["strings.extract_domain", (values) => extractDomain(values[0])],
  ["strings.extract_hostname", (values) => extractHostname(values[0])],
  ["strings.from_base64", (values) => decodeBase64(values[0])],
  ["strings.from_hex", (values) => decodeHex(values[0])],
  ["strings.ltrim", (values) => trimCharacters(values[0], values[1], "left")],
  ["strings.reverse", (values) => [...String(values[0] ?? "")].reverse().join("")],
  ["strings.rtrim", (values) => trimCharacters(values[0], values[1], "right")],
  ["strings.split", (values) => String(values[0] ?? "").split(String(values[1] ?? ","))],
  ["strings.starts_with", (values, context) =>
    stringValueMatches(values[0], (value) =>
      compareStringPredicate(value, values[1], Boolean(context.nocase), (source, needle) => source.startsWith(needle))
    )],
  ["strings.to_lower", (values) => String(values[0] ?? "").toLowerCase()],
  ["strings.to_upper", (values) => String(values[0] ?? "").toUpperCase()],
  ["strings.trim", (values) => trimCharacters(values[0], values[1], "both")],
  ["strings.url_decode", (values) => safeUrlDecode(values[0])],
  ["timestamp.as_unix_seconds", (values) => unixSeconds(values[0])],
  ["timestamp.current_seconds", (_values, context) => Math.floor(context.runtimeSources.nowMs() / 1000)],
  ["timestamp.current_timestamp", (_values, context) => new Date(context.runtimeSources.nowMs()).toISOString()],
  ["timestamp.get_date", (values) => datePart(values[0], values[1], "date")],
  ["timestamp.get_day_of_week", (values) => datePart(values[0], values[1], "day")],
  ["timestamp.get_hour", (values) => datePart(values[0], values[1], "hour")],
  ["timestamp.get_minute", (values) => datePart(values[0], values[1], "minute")],
  ["timestamp.get_timestamp", (values) => safeTimestamp(values[0])],
  ["timestamp.get_week", (values) => datePart(values[0], values[1], "week")],
  ["timestamp.now", (_values, context) => Math.floor(context.runtimeSources.nowMs() / 1000)],
])

export function getYaralRuntimeFunction(name: string) {
  return RUNTIME_FUNCTIONS.get(name.toLowerCase()) ?? null
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  return value === undefined || value === null ? [] : [value]
}

function toNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value)
}

function compareEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return toArray(left).some((leftValue) =>
      toArray(right).some((rightValue) => compareEqual(leftValue, rightValue))
    )
  }
  if (left === right) {
    return true
  }
  return String(left) === String(right)
}

function geoDistance(
  longitude1Value: unknown,
  latitude1Value: unknown,
  longitude2Value: unknown,
  latitude2Value: unknown
) {
  const longitude1 = toNumber(longitude1Value)
  const latitude1 = toNumber(latitude1Value)
  const longitude2 = toNumber(longitude2Value)
  const latitude2 = toNumber(latitude2Value)
  if (
    !Number.isFinite(longitude1) ||
    !Number.isFinite(latitude1) ||
    !Number.isFinite(longitude2) ||
    !Number.isFinite(latitude2) ||
    Math.abs(longitude1) > 180 ||
    Math.abs(longitude2) > 180 ||
    Math.abs(latitude1) > 90 ||
    Math.abs(latitude2) > 90
  ) {
    return -1
  }

  const earthRadiusMeters = 6_371_000
  const phi1 = degreesToRadians(latitude1)
  const phi2 = degreesToRadians(latitude2)
  const deltaPhi = degreesToRadians(latitude2 - latitude1)
  const deltaLambda = degreesToRadians(longitude2 - longitude1)
  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
}

function countSubstrings(value: unknown, substring: unknown, nocase = false) {
  const rawNeedle = String(substring ?? "")
  const needle = nocase ? rawNeedle.toLowerCase() : rawNeedle
  if (!needle) {
    return 0
  }
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countSubstrings(item, needle, nocase), 0)
  }

  const rawSource = String(value ?? "")
  const source = nocase ? rawSource.toLowerCase() : rawSource
  let count = 0
  let index = source.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = source.indexOf(needle, index + needle.length)
  }
  return count
}

function stringValueMatches(value: unknown, predicate: (value: string) => boolean) {
  if (isRepeatedRuntimeValue(value)) {
    return evaluateRepeatedPredicate(value, (item) => predicate(String(item ?? "")))
  }
  return toResolvedValues(value).some((item) => predicate(String(item ?? "")))
}

function compareStringPredicate(
  value: string,
  needleValue: unknown,
  nocase: boolean,
  predicate: (source: string, needle: string) => boolean
) {
  const needle = String(needleValue ?? "")
  return nocase
    ? predicate(value.toLowerCase(), needle.toLowerCase())
    : predicate(value, needle)
}

const SHA256_INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(String(value ?? ""))
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80

  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 4, bitLength, false)

  const hash = [...SHA256_INITIAL_HASH]
  const words = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false)
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15] ?? 0, 7) ^ rotateRight(words[index - 15] ?? 0, 18) ^ ((words[index - 15] ?? 0) >>> 3)
      const s1 = rotateRight(words[index - 2] ?? 0, 17) ^ rotateRight(words[index - 2] ?? 0, 19) ^ ((words[index - 2] ?? 0) >>> 10)
      words[index] = ((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25)
      const ch = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0))
      const temp1 = ((h ?? 0) + s1 + ch + (SHA256_ROUND_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0
      const s0 = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22)
      const maj = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0))
      const temp2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = ((d ?? 0) + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    hash[0] = ((hash[0] ?? 0) + (a ?? 0)) >>> 0
    hash[1] = ((hash[1] ?? 0) + (b ?? 0)) >>> 0
    hash[2] = ((hash[2] ?? 0) + (c ?? 0)) >>> 0
    hash[3] = ((hash[3] ?? 0) + (d ?? 0)) >>> 0
    hash[4] = ((hash[4] ?? 0) + (e ?? 0)) >>> 0
    hash[5] = ((hash[5] ?? 0) + (f ?? 0)) >>> 0
    hash[6] = ((hash[6] ?? 0) + (g ?? 0)) >>> 0
    hash[7] = ((hash[7] ?? 0) + (h ?? 0)) >>> 0
  }

  return hash.map((word) => word.toString(16).padStart(8, "0")).join("")
}

function rotateRight(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits))
}

function fingerprint2011Compat(value: unknown) {
  const bytes = new TextEncoder().encode(String(value ?? ""))
  let hash = 0xcbf29ce484222325n
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return Number(hash % BigInt(Number.MAX_SAFE_INTEGER))
}

function sampleRate(value: unknown, numeratorValue: unknown, denominatorValue: unknown) {
  const numerator = Math.trunc(toNumber(numeratorValue))
  const denominator = Math.trunc(toNumber(denominatorValue))
  if (denominator <= 0 || numerator <= 0) {
    return false
  }
  if (numerator >= denominator) {
    return true
  }
  return fingerprint2011Compat(value) % denominator < numerator
}

function isRepeatedRuntimeValue(value: unknown): value is RepeatedRuntimeValue {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Partial<RepeatedRuntimeValue>).__yaralRepeated === true
  )
}

function evaluateRepeatedPredicate(
  value: RepeatedRuntimeValue,
  predicate: (value: unknown) => boolean
): boolean {
  const results = value.values.map((item): boolean => predicate(item))
  return value.quantifier === "all"
    ? results.length > 0 && results.every(Boolean)
    : results.some(Boolean)
}

function toResolvedValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value]
}

function extractDomain(value: unknown) {
  const hostname = extractHostname(value)
  const parts = hostname.split(".").filter(Boolean)
  return parts.length > 1 ? parts.slice(-2).join(".") : hostname
}

function extractHostname(value: unknown) {
  const source = String(value ?? "")
  try {
    return new URL(source.includes("://") ? source : `scheme://${source}`).hostname
  } catch {
    return source.split("/")[0]?.split(":")[0] ?? ""
  }
}

function trimCharacters(value: unknown, characters: unknown, side: "both" | "left" | "right") {
  const source = String(value ?? "")
  const chars = String(characters ?? " ")
  const pattern = `[${escapeRegExp(chars)}]+`
  const left = side === "left" || side === "both" ? `^${pattern}` : ""
  const right = side === "right" || side === "both" ? `${pattern}$` : ""
  return source.replace(new RegExp(`${left}${left && right ? "|" : ""}${right}`, "g"), "")
}

function safeUrlDecode(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "").replace(/\+/g, " "))
  } catch {
    return String(value ?? "")
  }
}

function evaluateRegex(left: unknown, right: unknown, nocase = false): boolean {
  const regex = createRegex(right, nocase)
  if (regex && isRepeatedRuntimeValue(left)) {
    return evaluateRepeatedPredicate(left, (value) => testRuntimeRegex(regex, value))
  }
  return regex
    ? toResolvedValues(left).some((value) => testRuntimeRegex(regex, value))
    : false
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
  const cacheKey = `${normalized.source}\0${normalized.flags}`
  if (runtimeRegexCache.has(cacheKey)) {
    return runtimeRegexCache.get(cacheKey) ?? null
  }
  try {
    const regex = new RegExp(normalized.source, normalized.flags)
    setRuntimeRegexCacheEntry(cacheKey, regex)
    return regex
  } catch {
    setRuntimeRegexCacheEntry(cacheKey, null)
    return null
  }
}

function setRuntimeRegexCacheEntry(key: string, value: RegExp | null) {
  if (runtimeRegexCache.size >= MAX_RUNTIME_REGEX_CACHE_ENTRIES) {
    runtimeRegexCache.clear()
  }
  runtimeRegexCache.set(key, value)
}

function testRuntimeRegex(regex: RegExp, value: unknown) {
  regex.lastIndex = 0
  return regex.test(String(value ?? ""))
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

function captureRegex(value: unknown, pattern: unknown, group: unknown, nocase = false): string {
  const regex = createRegex(pattern, nocase)
  if (!regex) {
    return ""
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const captured: string = captureRegex(item, pattern, group, nocase)
      if (captured !== "") {
        return captured
      }
    }
    return ""
  }
  regex.lastIndex = 0
  const match = String(value ?? "").match(regex)
  return match?.[group === undefined ? 1 : toNumber(group)] ?? match?.[0] ?? ""
}

function captureAllRegex(value: unknown, pattern: unknown, nocase = false): string[] {
  const regex = createRegex(pattern, nocase)
  if (!regex) {
    return []
  }
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`
  const globalRegex = new RegExp(regex.source, flags)
  const values = Array.isArray(value) ? value : [value]
  const captures: string[] = []

  for (const item of values) {
    const source = String(item ?? "")
    for (const match of source.matchAll(globalRegex)) {
      captures.push(match[1] ?? match[0] ?? "")
    }
  }

  return captures
}

function replaceRegex(value: unknown, pattern: unknown, replacement: unknown, nocase = false) {
  const regex = createRegex(pattern, nocase)
  if (!regex) {
    return String(value ?? "")
  }
  regex.lastIndex = 0
  return String(value ?? "").replace(regex, String(replacement ?? ""))
}

function ipInCidr(ip: unknown, cidr: unknown): boolean {
  if (isRepeatedRuntimeValue(ip)) {
    return evaluateRepeatedPredicate(ip, (value): boolean => ipInCidr(value, cidr))
  }
  const cidrText = String(cidr ?? "")
  const [range, prefixText] = cidrText.split("/")
  const prefix = Number(prefixText)
  const ipText = String(ip ?? "")
  const rangeText = range ?? ""

  if (ipText.includes(":") || rangeText.includes(":")) {
    const ipNumber = ipv6ToBigInt(ipText)
    const rangeNumber = ipv6ToBigInt(rangeText)
    if (ipNumber === null || rangeNumber === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
      return false
    }
    const hostBits = BigInt(128 - prefix)
    const mask = prefix === 0 ? 0n : BigInt.asUintN(128, ((1n << BigInt(prefix)) - 1n) << hostBits)
    return (ipNumber & mask) === (rangeNumber & mask)
  }

  const ipNumber = ipv4ToNumber(ipText)
  const rangeNumber = ipv4ToNumber(rangeText)
  if (ipNumber === null || rangeNumber === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ipNumber & mask) === (rangeNumber & mask)
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
  const missing = 8 - (left.length + right.length)
  if (missing < 0) {
    return null
  }

  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right]
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))
  ) {
    return null
  }

  return groups.reduce((result, group) => (result << 16n) + BigInt(Number.parseInt(group, 16)), 0n)
}

function decodeBase64(value: unknown) {
  const source = String(value ?? "").replace(/\s+/g, "")
  if (!source) {
    return ""
  }

  try {
    const binary = globalThis.atob(source)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ""
  }
}

function decodeHex(value: unknown) {
  const source = String(value ?? "").replace(/\s+/g, "")
  if (!source || source.length % 2 !== 0 || /[^0-9a-f]/i.test(source)) {
    return ""
  }

  const bytes = new Uint8Array(source.length / 2)
  for (let index = 0; index < source.length; index += 2) {
    bytes[index / 2] = Number.parseInt(source.slice(index, index + 2), 16)
  }
  return new TextDecoder().decode(bytes)
}

function unixSeconds(value: unknown) {
  if (typeof value === "number") {
    return Math.floor(value)
  }
  const date = new Date(String(value ?? ""))
  return Number.isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000)
}

function safeTimestamp(value: unknown) {
  const date = new Date(typeof value === "number" ? value * 1000 : String(value ?? ""))
  return Number.isNaN(date.getTime()) ? "" : date.toISOString()
}

function datePart(
  value: unknown,
  timezone: unknown,
  part: "date" | "day" | "hour" | "minute" | "week"
) {
  const date = new Date(typeof value === "number" ? value * 1000 : String(value ?? ""))
  if (Number.isNaN(date.getTime())) {
    return part === "date" ? "" : 0
  }

  const timeZone = typeof timezone === "string" && timezone ? timezone : "UTC"
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    weekday: "short",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, item) => {
      result[item.type] = item.value
      return result
    }, {})

  if (part === "date") {
    return `${parts.year}-${parts.month}-${parts.day}`
  }
  if (part === "day") {
    const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "")
    return dayIndex >= 0 ? dayIndex + 1 : 0
  }
  if (part === "hour") {
    return Number(parts.hour)
  }
  if (part === "minute") {
    return Number(parts.minute)
  }
  return getIsoWeek(new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  )))
}

function getIsoWeek(date: Date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNumber = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
