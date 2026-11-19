export type AppSettingsValidationErrorFactory = (statusCode: number, message: string) => Error

const MAX_TEXT_LENGTH = 256

export function normalizeMaintenanceMessage(
  value: string | undefined,
  fallback: string,
  createError: AppSettingsValidationErrorFactory
) {
  return normalizeText(value, "Maintenance message", 500, fallback, createError)
}

export function normalizeSupportEmail(
  value: string | undefined,
  createError: AppSettingsValidationErrorFactory
) {
  const email = normalizeText(value, "Support email", MAX_TEXT_LENGTH, "", createError)
  if (!email) {
    return ""
  }
  if (!isSafeEmail(email)) {
    throw createError(400, "Support email must be a valid email address.")
  }
  return email
}

export function normalizeStatusPageUrl(
  value: string | undefined,
  createError: AppSettingsValidationErrorFactory
) {
  const url = normalizeText(value, "Status page URL", MAX_TEXT_LENGTH, "", createError)
  if (!url) {
    return ""
  }
  if (!isSafeHttpUrl(url)) {
    throw createError(400, "Status page URL must be an http or https URL.")
  }
  return new URL(url).toString()
}

export function coerceStoredSupportEmail(value: unknown) {
  return typeof value === "string" && isSafeEmail(value) ? value : ""
}

export function coerceStoredStatusPageUrl(value: unknown) {
  return typeof value === "string" && isSafeHttpUrl(value) ? new URL(value).toString() : ""
}

function normalizeText(
  value: string | undefined,
  label: string,
  maxLength: number,
  fallback: string,
  createError: AppSettingsValidationErrorFactory
) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return fallback
  }
  if (trimmed.length > maxLength) {
    throw createError(400, `${label} must be ${maxLength.toLocaleString()} characters or fewer.`)
  }
  if (hasControlCharacters(trimmed)) {
    throw createError(400, `${label} cannot contain control characters.`)
  }
  return trimmed
}

function isSafeEmail(value: string) {
  return !hasControlCharacters(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isSafeHttpUrl(value: string) {
  if (hasControlCharacters(value)) {
    return false
  }
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function hasControlCharacters(value: string) {
  return /[\u0000-\u001f\u007f]/.test(value)
}
