import { getDefaultAppSettingsForEnvironment } from "./appSettingsDefaults"
import { RATE_LIMITS, requireRateLimit, type RateLimitErrorFactory } from "./rateLimit"

const DEFAULT_BLOCKED_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
])

export const TEMP_EMAIL_ERROR_MESSAGE = "Please use a permanent email address."
export const SIGNUP_RATE_LIMIT_MESSAGE = "Too many signup attempts. Please wait and try again."

export function shouldDisableSignupForSettings(value: unknown, nodeEnv = process.env.NODE_ENV) {
  return !getSignupEnabledForSettings(value, nodeEnv)
}

export async function validateSignupEmailAddress(
  email: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const domain = getEmailDomain(email)
  if (!domain) {
    throw new Error("Enter a valid email address.")
  }

  if (getConfiguredDomainSet(env.RULELAB_EMAIL_ALLOWLIST_DOMAINS).has(domain)) {
    return
  }

  if (isBlockedEmailDomain(domain, env)) {
    throw new Error(TEMP_EMAIL_ERROR_MESSAGE)
  }
}

export async function requireSignupRateLimits({
  context,
  createError,
  email,
  ipAddress,
}: {
  context?: unknown
  createError: RateLimitErrorFactory
  email: string
  ipAddress: string | null
}) {
  const normalizedEmail = normalizeEmail(email)
  const domain = getEmailDomain(normalizedEmail)

  if (ipAddress) {
    await requireRateLimit({
      bucket: "signup-ip",
      context,
      createError,
      key: ipAddress,
      message: SIGNUP_RATE_LIMIT_MESSAGE,
      ...RATE_LIMITS.signupIp,
    })
  }

  if (domain) {
    await requireRateLimit({
      bucket: "signup-email-domain",
      context,
      createError,
      key: domain,
      message: SIGNUP_RATE_LIMIT_MESSAGE,
      ...RATE_LIMITS.signupEmailDomain,
    })
  }

  if (normalizedEmail) {
    await requireRateLimit({
      bucket: "signup-email",
      context,
      createError,
      key: normalizedEmail,
      message: SIGNUP_RATE_LIMIT_MESSAGE,
      ...RATE_LIMITS.signupEmail,
    })
  }
}

export function getSignupIpAddress(req: {
  ip?: string
  socket?: { remoteAddress?: string | null } | null
}) {
  return normalizeRateLimitKey(req.ip) ?? normalizeRateLimitKey(req.socket?.remoteAddress)
}

function getEmailDomain(email: string) {
  const normalized = normalizeEmail(email)
  const atIndex = normalized.lastIndexOf("@")
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return null
  }
  return normalized.slice(atIndex + 1)
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function normalizeRateLimitKey(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase()
  return normalized || null
}

function isBlockedEmailDomain(domain: string, env: NodeJS.ProcessEnv) {
  const configuredBlockedDomains = getConfiguredDomainSet(env.RULELAB_EMAIL_BLOCKLIST_DOMAINS)
  return configuredBlockedDomains.has(domain) || DEFAULT_BLOCKED_EMAIL_DOMAINS.has(domain)
}

function getConfiguredDomainSet(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  )
}

function getSignupEnabledForSettings(value: unknown, nodeEnv: string | undefined) {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "signupsEnabled" in value &&
    typeof value.signupsEnabled === "boolean"
  ) {
    return value.signupsEnabled
  }
  return getDefaultAppSettingsForEnvironment(nodeEnv).signupsEnabled
}
