import { GENERATED_UDM_FIELD_PATHS } from "./generated-fields"
import { UDM_TOP_LEVEL_FIELDS } from "./types"

const LOCAL_UDM_FIELD_PATHS = [
  "metadata.log_type",
  "network.http.parsed_user_agent.browser",
  "network.http.parsed_user_agent.os",
  "principal.user.attribute.labels",
  "src.resource.attribute.labels",
  "src.resource.attribute.labels.key",
  "src.resource.attribute.labels.value",
  "target.resource.attribute.labels",
  "target.resource.attribute.labels.key",
  "target.resource.attribute.labels.value",
  "target.resource_ancestors.attribute.labels",
  "target.resource.attribute.roles",
  "target.resource.attribute.roles.name",
  "target.user.attribute.labels",
]

export const UDM_FIELD_PATHS = [...new Set([...GENERATED_UDM_FIELD_PATHS, ...LOCAL_UDM_FIELD_PATHS])]

const OPEN_STRUCT_ROOTS = new Set(["additional", "extracted", "graph"])
const UDM_FIELD_PATH_SET = new Set<string>(UDM_FIELD_PATHS)
const UDM_FIELD_PREFIX_SET = new Set<string>()
const UDM_OBJECT_FIELD_PREFIX_SET = new Set<string>()
const UDM_CHILD_FIELDS_BY_PREFIX = new Map<string, Set<string>>()

for (const topLevelField of UDM_TOP_LEVEL_FIELDS) {
  addUdmChildField("", topLevelField)
}

for (const path of UDM_FIELD_PATHS) {
  const parts = path.split(".")
  for (let index = 0; index < parts.length; index += 1) {
    addUdmChildField(parts.slice(0, index).join("."), parts[index])
  }
  for (let index = 1; index <= parts.length; index += 1) {
    const prefix = parts.slice(0, index).join(".")
    UDM_FIELD_PREFIX_SET.add(prefix)
    if (index < parts.length) {
      UDM_OBJECT_FIELD_PREFIX_SET.add(prefix)
    }
  }
}

export function isKnownUdmFieldPath(path: string) {
  const normalizedPath = normalizeUdmFieldCatalogPath(path)
  if (UDM_FIELD_PATH_SET.has(normalizedPath)) {
    return true
  }

  const [topLevelField, ...childPath] = normalizedPath.split(".")
  return childPath.length > 0 && OPEN_STRUCT_ROOTS.has(topLevelField)
}

export function isKnownUdmFieldPrefix(path: string) {
  return UDM_FIELD_PREFIX_SET.has(normalizeUdmFieldCatalogPath(path))
}

export function getUdmFieldLiteralKind(path: string): "boolean" | "number" | "string" | null {
  const normalizedPath = normalizeUdmFieldCatalogPath(path)
  if (!isKnownUdmFieldPath(normalizedPath)) {
    return null
  }
  if (UDM_OBJECT_FIELD_PREFIX_SET.has(normalizedPath)) {
    return null
  }

  const fieldName = normalizedPath.split(".").at(-1) ?? ""
  if (BOOLEAN_FIELD_NAMES.has(fieldName)) {
    return "boolean"
  }
  if (
    NUMERIC_FIELD_NAMES.has(fieldName) ||
    NUMERIC_FIELD_SUFFIXES.some((suffix) => normalizedPath.endsWith(suffix))
  ) {
    return "number"
  }

  return "string"
}

export function isKnownScalarUdmFieldPath(path: string) {
  const normalizedPath = normalizeUdmFieldCatalogPath(path)
  return (
    isKnownUdmFieldPath(normalizedPath) &&
    !UDM_OBJECT_FIELD_PREFIX_SET.has(normalizedPath) &&
    !isKnownRepeatedUdmFieldPath(normalizedPath)
  )
}

export function isKnownRepeatedUdmFieldPath(path: string) {
  const normalizedPath = normalizeUdmFieldCatalogPath(path)
  const parts = normalizedPath.split(".")
  const topLevelField = parts[0] ?? ""
  const fieldName = parts.at(-1) ?? ""

  return (
    REPEATED_TOP_LEVEL_FIELDS.has(topLevelField) ||
    REPEATED_FIELD_NAMES.has(fieldName) ||
    REPEATED_FIELD_SUFFIXES.some((suffix) => normalizedPath.endsWith(suffix)) ||
    REPEATED_FIELD_SEGMENTS.some((segment) => parts.includes(segment))
  )
}

function normalizeUdmFieldCatalogPath(path: string) {
  return path.replace(/\[[^\]]+\]/g, "")
}

export function getUdmTopLevelFieldNames() {
  return UDM_TOP_LEVEL_FIELDS
}

export function getUdmChildFieldNames(path = "") {
  return [...(UDM_CHILD_FIELDS_BY_PREFIX.get(normalizeUdmFieldCatalogPath(path)) ?? [])].sort(
    (left, right) => left.localeCompare(right)
  )
}

function addUdmChildField(parentPath: string, childName: string) {
  const normalizedParentPath = normalizeUdmFieldCatalogPath(parentPath)
  const children = UDM_CHILD_FIELDS_BY_PREFIX.get(normalizedParentPath) ?? new Set<string>()
  children.add(childName)
  UDM_CHILD_FIELDS_BY_PREFIX.set(normalizedParentPath, children)
}

const BOOLEAN_FIELD_NAMES = new Set([
  "anonymous",
  "authoritative",
  "blocked",
  "ca",
  "response",
])

const NUMERIC_FIELD_NAMES = new Set([
  "asn",
  "confidence_score",
  "entry_point",
  "exponent",
  "flags",
  "hlen",
  "hops",
  "key_size",
  "lease_time_seconds",
  "nanos",
  "opcode",
  "pid",
  "port",
  "received_bytes",
  "received_packets",
  "region_latitude",
  "region_longitude",
  "response_code",
  "risk_score",
  "seconds",
  "sent_bytes",
  "sent_packets",
  "size",
  "ttl",
  "version",
])

const NUMERIC_FIELD_SUFFIXES = [
  "_bytes",
  "_count",
  "_number",
  "_packets",
  "_score",
  "_seconds",
  "_time.nanos",
  "_time.seconds",
]

const REPEATED_TOP_LEVEL_FIELDS = new Set([
  "about",
  "intermediary",
  "observer",
  "security_result",
])

const REPEATED_FIELD_NAMES = new Set([
  "actions",
  "aliases",
  "answers",
  "asset_id",
  "email_addresses",
  "group_identifiers",
  "ip",
  "labels",
  "names",
  "permissions",
  "questions",
  "relations",
  "roles",
  "tags",
])

const REPEATED_FIELD_SUFFIXES = [
  "_ids",
  "_names",
  "_tags",
]

const REPEATED_FIELD_SEGMENTS = [
  "attribute",
  "managers",
  "process_ancestors",
  "relations",
  "resources",
  "vulnerabilities",
]
