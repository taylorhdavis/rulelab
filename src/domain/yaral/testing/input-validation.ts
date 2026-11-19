import { UDM_EVENT_TYPES } from "../../udm/event-types"

const DANGEROUS_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"])
const DATA_TABLE_COLUMN_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export const JSON_SAFETY_LIMITS = {
  maxArrayLength: 2_000,
  maxDepth: 64,
  maxObjectKeys: 500,
  maxStringLength: 1_000_000,
  maxTotalNodes: 25_000,
} as const

type JsonSafetyTraversalState = {
  rootLabel: string
  totalNodes: number
}

export function validateJsonValueSafety(
  value: unknown,
  label: string,
  depth = 0,
  state: JsonSafetyTraversalState = { rootLabel: label, totalNodes: 0 }
): string | null {
  state.totalNodes += 1
  if (state.totalNodes > JSON_SAFETY_LIMITS.maxTotalNodes) {
    return `${state.rootLabel} can contain at most ${JSON_SAFETY_LIMITS.maxTotalNodes.toLocaleString()} JSON values.`
  }
  if (depth > JSON_SAFETY_LIMITS.maxDepth) {
    return `${label} is nested too deeply.`
  }
  if (typeof value === "string" && value.length > JSON_SAFETY_LIMITS.maxStringLength) {
    return `${label} must be ${JSON_SAFETY_LIMITS.maxStringLength.toLocaleString()} characters or fewer.`
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return `${label} contains a non-finite number.`
  }
  if (!value || typeof value !== "object") {
    return null
  }

  if (Array.isArray(value)) {
    if (value.length > JSON_SAFETY_LIMITS.maxArrayLength) {
      return `${label} can contain at most ${JSON_SAFETY_LIMITS.maxArrayLength.toLocaleString()} items per array.`
    }
    for (const [index, item] of value.entries()) {
      const itemError = validateJsonValueSafety(item, `${label}[${index}]`, depth + 1, state)
      if (itemError) {
        return itemError
      }
    }
    return null
  }

  const entries = Object.entries(value)
  if (entries.length > JSON_SAFETY_LIMITS.maxObjectKeys) {
    return `${label} can contain at most ${JSON_SAFETY_LIMITS.maxObjectKeys.toLocaleString()} keys per object.`
  }

  for (const [key, childValue] of entries) {
    if (DANGEROUS_JSON_KEYS.has(key)) {
      return `${label} contains unsupported key "${key}".`
    }
    const childError = validateJsonValueSafety(childValue, `${label}.${key}`, depth + 1, state)
    if (childError) {
      return childError
    }
  }
  return null
}

export function validateUdmEvents(events: unknown[]): string | null {
  for (const [index, event] of events.entries()) {
    const label = `UDM event ${index + 1}`
    if (!isJsonRecord(event)) {
      return `${label} must be a JSON object.`
    }
    const metadata = event.metadata
    if (!isJsonRecord(metadata)) {
      return `${label} must include a metadata object.`
    }
    if (typeof metadata.event_type !== "string" || !metadata.event_type.trim()) {
      return `${label} must include metadata.event_type.`
    }
    if (!UDM_EVENT_TYPES.includes(metadata.event_type as (typeof UDM_EVENT_TYPES)[number])) {
      return `${label} metadata.event_type must be a supported UDM event type.`
    }

    const metadataError = validateOptionalUdmMetadataStrings(metadata, label)
    if (metadataError) {
      return metadataError
    }

    const timestampError = validateOptionalUdmTimestamps(event, label)
    if (timestampError) {
      return timestampError
    }
  }

  return null
}

export function validateDataTableRows(rows: unknown[]): string | null {
  const seenRows = new Set<string>()
  for (const [index, row] of rows.entries()) {
    if (row === null || Array.isArray(row)) {
      return `Data table row ${index + 1} must be a scalar or object.`
    }
    if (typeof row !== "object") {
      if (!["boolean", "number", "string"].includes(typeof row)) {
        return `Data table row ${index + 1} must be a scalar or object.`
      }
      if (typeof row === "number" && !Number.isFinite(row)) {
        return `Data table row ${index + 1} must be a finite number.`
      }
      const key = `scalar:${typeof row}:${String(row)}`
      if (seenRows.has(key)) {
        return `Data table row ${index + 1} duplicates an earlier row.`
      }
      seenRows.add(key)
      continue
    }

    const keys = Object.keys(row)
    if (keys.length === 0) {
      return `Data table row ${index + 1} must include at least one column.`
    }
    const invalidKey = keys.find((key) => !DATA_TABLE_COLUMN_NAME_PATTERN.test(key))
    if (invalidKey) {
      return `Data table row ${index + 1} has invalid column "${invalidKey}". Column names must use letters, numbers, and underscores.`
    }
    const key = `object:${JSON.stringify(sortJsonValue(row))}`
    if (seenRows.has(key)) {
      return `Data table row ${index + 1} duplicates an earlier row.`
    }
    seenRows.add(key)
  }

  return null
}

export function parseJsonTimestampMs(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? (value > 10_000_000_000 ? value : value * 1000) : null
  }
  if (typeof value === "string") {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : null
  }
  if (isJsonRecord(value)) {
    const seconds = value.seconds
    const nanos = value.nanos
    const numericSeconds = typeof seconds === "string" ? Number(seconds) : seconds
    if (typeof numericSeconds === "number" && Number.isFinite(numericSeconds)) {
      return numericSeconds * 1000 + (typeof nanos === "number" ? nanos / 1_000_000 : 0)
    }
  }
  return null
}

export function getJsonPathValue(value: unknown, path: string[]) {
  let current = value
  for (const segment of path) {
    if (!isJsonRecord(current)) {
      return null
    }
    current = current[segment]
  }
  return current ?? null
}

export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }
  if (isJsonRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)])
    )
  }
  return value
}

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function validateOptionalUdmMetadataStrings(
  metadata: Record<string, unknown>,
  label: string
) {
  const fields = ["log_type", "product_name", "vendor_name", "product_event_type"]
  for (const field of fields) {
    const value = metadata[field]
    if (value !== undefined && value !== null && typeof value !== "string") {
      return `${label} metadata.${field} must be a string when present.`
    }
  }
  return null
}

function validateOptionalUdmTimestamps(event: Record<string, unknown>, label: string) {
  const timestampFields = [
    ["metadata", "event_timestamp"],
    ["metadata", "collected_timestamp"],
    ["metadata", "ingested_timestamp"],
    ["event_timestamp"],
    ["timestamp"],
  ]

  for (const path of timestampFields) {
    const value = getJsonPathValue(event, path)
    if (value === null || value === undefined) {
      continue
    }
    if (parseJsonTimestampMs(value) === null) {
      return `${label} ${path.join(".")} must be an ISO timestamp, Unix timestamp, or {seconds,nanos} object.`
    }
  }

  return null
}
