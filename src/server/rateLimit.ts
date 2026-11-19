export type RateLimitErrorFactory = (statusCode: number, message: string) => Error

type RateLimitOptions = {
  bucket?: string
  context?: unknown
  createError: RateLimitErrorFactory
  key: string
  limit: number
  message?: string
  nowMs?: number
  ownerId?: string | null
  windowMs: number
}

type RateLimitBucket = {
  count: number
  resetAt: number
}

const buckets = new Map<string, RateLimitBucket>()
let defaultPrismaClient: any = null

export const RATE_LIMITS = {
  adminMutation: { limit: 60, windowMs: 60_000 },
  apiKeyMutation: { limit: 30, windowMs: 60_000 },
  libraryMutation: { limit: 120, windowMs: 60_000 },
  profileMutation: { limit: 10, windowMs: 60_000 },
  publicApiAuth: { limit: 120, windowMs: 60_000 },
  signupEmail: { limit: 3, windowMs: 60 * 60_000 },
  signupEmailDomain: { limit: 30, windowMs: 60 * 60_000 },
  signupIp: { limit: 10, windowMs: 60 * 60_000 },
} as const

export async function requireRateLimit({
  bucket = "server-action",
  context,
  createError,
  key,
  limit,
  message = "Too many requests. Please wait a moment and try again.",
  nowMs = Date.now(),
  ownerId = null,
  windowMs,
}: RateLimitOptions) {
  const persistedStore = getPersistedRateLimitStore(context) ?? await getDefaultPersistedRateLimitStore()
  if (persistedStore) {
    await requirePersistedRateLimit({
      bucket,
      createError,
      key,
      limit,
      message,
      nowMs,
      ownerId,
      store: persistedStore,
      windowMs,
    })
    return
  }

  requireMemoryRateLimit({ createError, key: `${bucket}:${key}`, limit, message, nowMs, windowMs })
}

function requireMemoryRateLimit({
  createError,
  key,
  limit,
  message,
  nowMs,
  windowMs,
}: {
  createError: RateLimitErrorFactory
  key: string
  limit: number
  message: string
  nowMs: number
  windowMs: number
}) {
  pruneExpiredBuckets(nowMs)

  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= nowMs) {
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs })
    return
  }

  if (existing.count >= limit) {
    throw createError(429, message)
  }

  existing.count += 1
}

async function requirePersistedRateLimit({
  bucket,
  createError,
  key,
  limit,
  message,
  nowMs,
  ownerId,
  store,
  windowMs,
}: {
  bucket: string
  createError: RateLimitErrorFactory
  key: string
  limit: number
  message: string
  nowMs: number
  ownerId: string | null
  store: any
  windowMs: number
}) {
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs)
  const incremented = await store.updateMany({
    data: { count: { increment: 1 } },
    where: { bucket, count: { lt: limit }, key, windowStart },
  })
  if (incremented.count > 0) {
    return
  }

  const existing = await store.findFirst({ where: { bucket, key, windowStart } })
  if (existing?.count >= limit) {
    throw createError(429, message)
  }
  if (existing) {
    return
  }

  try {
    await store.create({
      data: { bucket, count: 1, key, ownerId, windowStart },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      await requirePersistedRateLimit({
        bucket,
        createError,
        key,
        limit,
        message,
        nowMs,
        ownerId,
        store,
        windowMs,
      })
      return
    }
    throw error
  }
}

function pruneExpiredBuckets(nowMs: number) {
  if (buckets.size < 1_000) {
    return
  }
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= nowMs) {
      buckets.delete(key)
    }
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

function getPersistedRateLimitStore(context: unknown) {
  if (!context || typeof context !== "object" || !("entities" in context)) {
    return null
  }
  const entities = (context as { entities?: unknown }).entities
  if (!entities || typeof entities !== "object" || !("ApiRateLimit" in entities)) {
    return null
  }
  return (entities as { ApiRateLimit?: unknown }).ApiRateLimit ?? null
}

async function getDefaultPersistedRateLimitStore() {
  if (!defaultPrismaClient) {
    const prismaModule = await import("@prisma/client")
    defaultPrismaClient = new prismaModule.PrismaClient()
  }
  return defaultPrismaClient.apiRateLimit ?? null
}
