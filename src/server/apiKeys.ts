import crypto from "node:crypto"

import type {
  CreateApiKey,
  ListApiKeys,
  RenameApiKey,
  RevokeApiKey,
} from "wasp/server/operations"

import { getDefaultAppSettingsForEnvironment } from "./appSettingsDefaults"
import { RATE_LIMITS, requireRateLimit } from "./rateLimit"

export const API_KEY_SCOPES = [
  "yaral:compile",
  "yaral:test",
  "rules:read",
  "rules:write",
] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

export type ApiKeyPrincipal = {
  apiKey: {
    id: string
    lastUsedIpHash: string | null
    prefix: string
    scopes: ApiKeyScope[]
  }
  user: {
    id: string
    isAdmin: boolean
  }
}

export type ApiKeySummary = {
  createdAt: Date
  expiresAt: Date | null
  id: string
  lastUsedAt: Date | null
  name: string
  prefix: string
  revokedAt: Date | null
  scopes: ApiKeyScope[]
}

type ApiKeyContext = {
  entities: {
    ApiKey: any
    ApiRateLimit?: any
    AppSetting: any
    User: any
  }
  user?: { id: string } | null
}

type CreateApiKeyArgs = {
  expiresAt?: string | null
  name?: string
  scopes?: string[]
}

type RenameApiKeyArgs = {
  id?: string | null
  name?: string
}

type RevokeApiKeyArgs = {
  id?: string | null
}

const API_KEY_PREFIX = "rl_live"
const API_KEY_LOOKUP_BYTES = 6
const API_KEY_SECRET_BYTES = 32
const API_KEY_LOOKUP_HEX_LENGTH = API_KEY_LOOKUP_BYTES * 2
const API_KEY_NAME_MAX_LENGTH = 80
const MIN_API_KEY_HASH_SECRET_LENGTH = 64
const API_KEY_DEFAULT_SCOPES: ApiKeyScope[] = [...API_KEY_SCOPES]
const MAX_ACTIVE_API_KEYS = 10

class ApiKeyOperationError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
  }
}

const createApiKeyOperationError = (statusCode: number, message: string) =>
  new ApiKeyOperationError(statusCode, message)

export const listApiKeys: ListApiKeys<void, ApiKeySummary[]> = async (_args, context) => {
  const ownerId = requireUserId(context)
  const keys = await context.entities.ApiKey.findMany({
    orderBy: [{ createdAt: "desc" }],
    where: { ownerId },
  })
  return keys.map(toApiKeySummary)
}

export const createApiKey: CreateApiKey<
  CreateApiKeyArgs,
  ApiKeySummary & { key: string }
> = async (args, context) => {
  const ownerId = requireUserId(context)
  await requireApiKeyMutationRateLimit(context, ownerId)
  await requireApiKeyCreationAllowed(context, ownerId)
  const name = normalizeApiKeyName(args.name)
  const scopes = normalizeScopes(args.scopes)
  const expiresAt = normalizeExpiresAt(args.expiresAt)
  const { key, prefix, hash } = await generateUniqueApiKey(context)
  const created = await context.entities.ApiKey.create({
    data: {
      expiresAt,
      hash,
      name,
      ownerId,
      prefix,
      scopes,
    },
  })
  return {
    ...toApiKeySummary(created),
    key,
  }
}

export const renameApiKey: RenameApiKey<RenameApiKeyArgs, ApiKeySummary> = async (
  args,
  context
) => {
  const ownerId = requireUserId(context)
  await requireApiKeyMutationRateLimit(context, ownerId)
  const id = normalizeApiKeyId(args.id)
  const updated = await context.entities.ApiKey.updateMany({
    data: { name: normalizeApiKeyName(args.name) },
    where: { id, ownerId },
  })
  if (updated.count === 0) {
    throw createApiKeyOperationError(404, "API key not found.")
  }
  const key = await context.entities.ApiKey.findFirst({ where: { id, ownerId } })
  return toApiKeySummary(key)
}

export const revokeApiKey: RevokeApiKey<RevokeApiKeyArgs, ApiKeySummary> = async (
  args,
  context
) => {
  const ownerId = requireUserId(context)
  await requireApiKeyMutationRateLimit(context, ownerId)
  const id = normalizeApiKeyId(args.id)
  const revokedAt = new Date()
  const updated = await context.entities.ApiKey.updateMany({
    data: { revokedAt },
    where: { id, ownerId, revokedAt: null },
  })
  if (updated.count === 0) {
    const existing = await context.entities.ApiKey.findFirst({ where: { id, ownerId } })
    if (!existing) {
      throw createApiKeyOperationError(404, "API key not found.")
    }
    return toApiKeySummary(existing)
  }
  const key = await context.entities.ApiKey.findFirst({ where: { id, ownerId } })
  return toApiKeySummary(key)
}

export async function authenticateApiKey(
  context: ApiKeyContext,
  authorizationHeader: string | undefined,
  requiredScope: ApiKeyScope,
  ipAddress: string | null
): Promise<ApiKeyPrincipal> {
  const rawKey = parseBearerApiKey(authorizationHeader)
  const prefix = parseApiKeyPrefix(rawKey)
  const keyRecord = await context.entities.ApiKey.findUnique({
    include: {
      owner: {
        select: {
          id: true,
          isAdmin: true,
        },
      },
    },
    where: { prefix },
  })
  if (!keyRecord || !verifyApiKeyHash(rawKey, keyRecord.hash)) {
    throw new PublicApiError(401, "unauthorized", "Unauthorized.")
  }
  if (keyRecord.revokedAt || (keyRecord.expiresAt && keyRecord.expiresAt <= new Date())) {
    throw new PublicApiError(401, "unauthorized", "Unauthorized.")
  }
  const scopes = normalizeStoredScopes(keyRecord.scopes)
  if (!scopes.includes(requiredScope)) {
    throw new PublicApiError(403, "forbidden", "Forbidden.")
  }
  const settings = await getApiAccessSettings(context)
  if (!settings.apiAccessEnabled && !keyRecord.owner.isAdmin) {
    throw new PublicApiError(503, "temporarily_unavailable", "Service unavailable.")
  }
  await context.entities.ApiKey.update({
    data: {
      lastUsedAt: new Date(),
      lastUsedIpHash: ipAddress ? hashIpAddress(ipAddress) : null,
    },
    where: { id: keyRecord.id },
  })
  return {
    apiKey: {
      id: keyRecord.id,
      lastUsedIpHash: ipAddress ? hashIpAddress(ipAddress) : null,
      prefix: keyRecord.prefix,
      scopes,
    },
    user: keyRecord.owner,
  }
}

export async function requireApiRateLimit({
  context,
  family,
  ipAddress,
  principal,
}: {
  context: { entities: { ApiRateLimit: any } }
  family: "compile" | "rules" | "test"
  ipAddress?: string | null
  principal: ApiKeyPrincipal
}) {
  const limit = getRateLimit(family)
  const ownerLimit = multiplyRateLimit(limit, MAX_ACTIVE_API_KEYS)
  const ipLimit = multiplyRateLimit(limit, 8)
  const globalLimit = multiplyRateLimit(limit, 50)
  const ipHash = ipAddress ? hashIpAddress(ipAddress) : principal.apiKey.lastUsedIpHash ?? "unknown"

  await incrementRateLimit({
    bucket: `${family}:global:minute`,
    context,
    key: "global",
    limit: globalLimit.perMinute,
    ownerId: null,
    windowMs: 60_000,
  })
  await incrementRateLimit({
    bucket: `${family}:global:day`,
    context,
    key: "global",
    limit: globalLimit.perDay,
    ownerId: null,
    windowMs: 86_400_000,
  })
  await incrementRateLimit({
    bucket: `${family}:ip:minute`,
    context,
    key: ipHash,
    limit: ipLimit.perMinute,
    ownerId: null,
    windowMs: 60_000,
  })
  await incrementRateLimit({
    bucket: `${family}:ip:day`,
    context,
    key: ipHash,
    limit: ipLimit.perDay,
    ownerId: null,
    windowMs: 86_400_000,
  })
  await incrementRateLimit({
    bucket: `${family}:owner:minute`,
    context,
    key: principal.user.id,
    limit: ownerLimit.perMinute,
    ownerId: principal.user.id,
    windowMs: 60_000,
  })
  await incrementRateLimit({
    bucket: `${family}:owner:day`,
    context,
    key: principal.user.id,
    limit: ownerLimit.perDay,
    ownerId: principal.user.id,
    windowMs: 86_400_000,
  })
  await incrementRateLimit({
    bucket: `${family}:key:minute`,
    context,
    key: principal.apiKey.id,
    limit: limit.perMinute,
    ownerId: principal.user.id,
    windowMs: 60_000,
  })
  await incrementRateLimit({
    bucket: `${family}:key:day`,
    context,
    key: principal.apiKey.id,
    limit: limit.perDay,
    ownerId: principal.user.id,
    windowMs: 86_400_000,
  })
}

export class PublicApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message)
  }
}

function requireUserId(context: { user?: { id: string } | null }) {
  if (!context.user) {
    throw createApiKeyOperationError(401, "You must be logged in.")
  }
  return context.user.id
}

async function requireApiKeyMutationRateLimit(context: unknown, ownerId: string) {
  await requireRateLimit({
    bucket: "api-key-mutation",
    context,
    createError: createApiKeyOperationError,
    key: ownerId,
    ownerId,
    ...RATE_LIMITS.apiKeyMutation,
  })
}

async function requireApiKeyCreationAllowed(context: ApiKeyContext, ownerId: string) {
  const settings = await getApiAccessSettings(context)
  if (!settings.apiAccessEnabled) {
    throw createApiKeyOperationError(503, "API access is currently unavailable.")
  }
  const user = await context.entities.User.findUnique({
    select: {
      isAdmin: true,
    },
    where: { id: ownerId },
  })
  if (!user) {
    throw createApiKeyOperationError(401, "You must be logged in.")
  }
  const maxKeys = MAX_ACTIVE_API_KEYS
  const activeKeyCount = await context.entities.ApiKey.count({
    where: {
      ownerId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })
  if (activeKeyCount >= maxKeys) {
    throw createApiKeyOperationError(409, `Workspace limit reached: ${maxKeys} active API keys.`)
  }
}

async function getApiAccessSettings(context: ApiKeyContext) {
  if (!context.entities.AppSetting) {
    return { apiAccessEnabled: getDefaultAppSettingsForEnvironment().apiAccessEnabled }
  }
  const record = await context.entities.AppSetting.findUnique({
    where: { key: "app" },
  })
  const value = record?.value
  return {
    apiAccessEnabled: typeof value?.apiAccessEnabled === "boolean"
      ? value.apiAccessEnabled
      : getDefaultAppSettingsForEnvironment().apiAccessEnabled,
  }
}

async function generateUniqueApiKey(context: ApiKeyContext) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const lookup = crypto.randomBytes(API_KEY_LOOKUP_BYTES).toString("hex")
    const secret = crypto.randomBytes(API_KEY_SECRET_BYTES).toString("hex")
    const prefix = `${API_KEY_PREFIX}_${lookup}`
    const key = `${prefix}_${secret}`
    const hash = hashApiKey(key)
    const existing = await context.entities.ApiKey.findFirst({
      select: { id: true },
      where: { OR: [{ prefix }, { hash }] },
    })
    if (!existing) {
      return { hash, key, prefix }
    }
  }
  throw createApiKeyOperationError(500, "Could not create API key.")
}

function normalizeApiKeyName(value: string | undefined) {
  const name = value?.trim() || "Default API key"
  if (name.length > API_KEY_NAME_MAX_LENGTH) {
    throw createApiKeyOperationError(400, `API key name must be ${API_KEY_NAME_MAX_LENGTH} characters or fewer.`)
  }
  if (hasControlCharacters(name)) {
    throw createApiKeyOperationError(400, "API key name cannot contain control characters.")
  }
  return name
}

function normalizeApiKeyId(value: string | null | undefined) {
  const id = value?.trim()
  if (!id) {
    throw createApiKeyOperationError(400, "API key id is required.")
  }
  return id
}

function normalizeExpiresAt(value: string | null | undefined) {
  if (!value) {
    return null
  }
  const expiresAt = new Date(value)
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw createApiKeyOperationError(400, "API key expiry must be a future ISO date.")
  }
  return expiresAt
}

function normalizeScopes(value: unknown): ApiKeyScope[] {
  if (value !== undefined && !Array.isArray(value)) {
    throw createApiKeyOperationError(400, "API key scopes must be an array.")
  }
  const scopes = Array.isArray(value) && value.length ? value : API_KEY_DEFAULT_SCOPES
  const uniqueScopes = [...new Set(scopes)]
  if (uniqueScopes.length > API_KEY_SCOPES.length) {
    throw createApiKeyOperationError(400, "Too many API key scopes.")
  }
  for (const scope of uniqueScopes) {
    if (!API_KEY_SCOPES.includes(scope as ApiKeyScope)) {
      throw createApiKeyOperationError(400, "Unknown API key scope.")
    }
  }
  return uniqueScopes as ApiKeyScope[]
}

function normalizeStoredScopes(value: unknown): ApiKeyScope[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((scope): scope is ApiKeyScope =>
    API_KEY_SCOPES.includes(scope as ApiKeyScope)
  )
}

function hasControlCharacters(value: string) {
  return /[\u0000-\u001f\u007f]/.test(value)
}

function parseBearerApiKey(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) {
    throw new PublicApiError(401, "unauthorized", "Unauthorized.")
  }
  const key = header.slice("Bearer ".length).trim()
  if (!key) {
    throw new PublicApiError(401, "unauthorized", "Unauthorized.")
  }
  return key
}

function parseApiKeyPrefix(key: string) {
  const match = /^rl_live_([0-9a-f]{12})_[0-9a-f]{64}$/i.exec(key)
  if (!match) {
    throw new PublicApiError(401, "unauthorized", "Unauthorized.")
  }
  const lookup = match[1]
  if (lookup.length !== API_KEY_LOOKUP_HEX_LENGTH) {
    throw new PublicApiError(401, "unauthorized", "Unauthorized.")
  }
  return `${API_KEY_PREFIX}_${lookup}`
}

function hashApiKey(key: string) {
  return crypto
    .createHmac("sha256", getApiKeyHashSecret())
    .update(key)
    .digest("base64url")
}

function verifyApiKeyHash(key: string, expectedHash: string) {
  const actualHash = hashApiKey(key)
  const actual = Buffer.from(actualHash)
  const expected = Buffer.from(expectedHash)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function hashIpAddress(ipAddress: string) {
  return crypto
    .createHmac("sha256", getApiKeyHashSecret())
    .update(ipAddress)
    .digest("base64url")
}

function getApiKeyHashSecret() {
  const configuredSecret = process.env.API_KEY_HASH_SECRET?.trim()
  if (configuredSecret) {
    if (configuredSecret.length < MIN_API_KEY_HASH_SECRET_LENGTH) {
      throw new PublicApiError(
        500,
        "internal_error",
        "API key hash secret must be at least 64 characters."
      )
    }
    return configuredSecret
  }
  throw new PublicApiError(500, "internal_error", "Internal server error.")
}

function toApiKeySummary(key: any): ApiKeySummary {
  return {
    createdAt: key.createdAt,
    expiresAt: key.expiresAt ?? null,
    id: key.id,
    lastUsedAt: key.lastUsedAt ?? null,
    name: key.name,
    prefix: key.prefix,
    revokedAt: key.revokedAt ?? null,
    scopes: normalizeStoredScopes(key.scopes),
  }
}

function getRateLimit(family: "compile" | "rules" | "test") {
  if (family === "test") return { perDay: 2_000, perMinute: 60 }
  if (family === "rules") return { perDay: 5_000, perMinute: 120 }
  return { perDay: 20_000, perMinute: 300 }
}

function multiplyRateLimit(limit: { perDay: number; perMinute: number }, multiplier: number) {
  return {
    perDay: limit.perDay * multiplier,
    perMinute: limit.perMinute * multiplier,
  }
}

async function incrementRateLimit({
  bucket,
  context,
  key,
  limit,
  ownerId,
  windowMs,
}: {
  bucket: string
  context: { entities: { ApiRateLimit: any } }
  key: string
  limit: number
  ownerId: string | null
  windowMs: number
}) {
  const now = Date.now()
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs)
  const incremented = await context.entities.ApiRateLimit.updateMany({
    data: { count: { increment: 1 } },
    where: { bucket, count: { lt: limit }, key, windowStart },
  })
  if (incremented.count > 0) {
    return
  }

  const existing = await context.entities.ApiRateLimit.findFirst({ where: { bucket, key, windowStart } })
  if (existing?.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000))
    throw new PublicApiError(429, "rate_limited", "Rate limit exceeded.", retryAfterSeconds)
  }
  if (existing) {
    return
  }

  try {
    await context.entities.ApiRateLimit.create({
      data: { bucket, count: 1, key, ownerId, windowStart },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return incrementRateLimit({ bucket, context, key, limit, ownerId, windowMs })
    }
    throw error
  }
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
  )
}
