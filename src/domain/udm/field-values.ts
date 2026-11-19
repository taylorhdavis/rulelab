import {
  GENERATED_UDM_ENUM_TYPE_BY_FIELD,
  GENERATED_UDM_ENUM_VALUES_BY_TYPE,
} from "./generated-field-values"

export function getUdmFieldAllowedValues(path: string): readonly string[] {
  const normalizedPath = normalizeUdmFieldValuePath(path)
  const enumType =
    GENERATED_UDM_ENUM_TYPE_BY_FIELD[
      normalizedPath as keyof typeof GENERATED_UDM_ENUM_TYPE_BY_FIELD
    ]

  if (!enumType) {
    return []
  }

  return GENERATED_UDM_ENUM_VALUES_BY_TYPE[
    enumType as keyof typeof GENERATED_UDM_ENUM_VALUES_BY_TYPE
  ] ?? []
}

export function hasUdmFieldAllowedValues(path: string) {
  return getUdmFieldAllowedValues(path).length > 0
}

function normalizeUdmFieldValuePath(path: string) {
  return path.replace(/\[[^\]]+\]/g, "")
}
