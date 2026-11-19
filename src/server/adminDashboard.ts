import { HttpError } from "wasp/server"
import {
  createProviderId,
  createUser,
  findAuthIdentity,
  sanitizeAndSerializeProviderData,
} from "wasp/auth/utils"
import type {
  DeleteAdminDataTable,
  DeleteAdminSavedRule,
  DeleteAdminUdmEventSet,
  DeleteAdminUser,
  GetAdminDashboardData,
  UpdateAdminUser,
} from "wasp/server/operations"
import { getAppSettings } from "./appSettings"
import type { AppSettings } from "./appSettings"
import {
  requireAdminStatusChangeAllowed,
  requireAdminUserId,
} from "./adminDashboardValidation"
import { RATE_LIMITS, requireRateLimit } from "./rateLimit"
import { getPasswordPolicyError } from "../lib/passwordPolicy"

type AdminContext = {
  entities: {
    ApiKey?: any
    ApiRateLimit?: any
    AppSetting?: any
    User: any
  }
  user?: { id: string } | null
}

type DeleteAdminRecordArgs = {
  id?: string | null
}

export type UpdateAdminUserArgs = {
  isAdmin?: boolean
  userId?: string | null
}

export type CreateAdminUserArgs = {
  isAdmin?: boolean | null
  password?: string | null
  username?: string | null
}

export type AdminUserSummary = {
  activeApiKeyCount: number
  apiKeyCount: number
  apiRateLimitBucketCount: number
  createdAt: Date
  dataTableCount: number
  id: string
  isAdmin: boolean
  lastActiveAt: Date | null
  lastApiKeyUsedAt: Date | null
  lastLoginAt: Date | null
  savedRuleCount: number
  udmEventSetCount: number
  username: string
}

export type AdminSavedRuleSummary = {
  createdAt: Date
  description: string | null
  folder: string | null
  id: string
  name: string
  ownerId: string | null
  ownerUsername: string
  source: string
  sourceLength: number
  tags: string[]
  updatedAt: Date
}

export type AdminUdmEventSetSummary = {
  createdAt: Date
  description: string | null
  eventCount: number
  events: any
  expectedResults: any | null
  hasExpectedResults: boolean
  id: string
  name: string
  ownerId: string | null
  ownerUsername: string
  savedRuleId: string | null
  updatedAt: Date
}

export type AdminDataTableSummary = {
  createdAt: Date
  description: string | null
  id: string
  name: string
  ownerId: string | null
  ownerUsername: string
  rowCount: number
  rows: any
  updatedAt: Date
}

export type AdminApiKeySummary = {
  active: boolean
  createdAt: Date
  expiresAt: Date | null
  id: string
  lastUsedAt: Date | null
  name: string
  ownerId: string
  ownerUsername: string
  prefix: string
  rateLimitBucketCount: number
  recentUsageCount: number
  revokedAt: Date | null
  scopes: string[]
  status: "active" | "expired" | "revoked"
  updatedAt: Date
}

export type AdminDashboardData = {
  apiKeys: AdminApiKeySummary[]
  dataTables: AdminDataTableSummary[]
  savedRules: AdminSavedRuleSummary[]
  settings: AppSettings
  stats: {
    activeApiKeyCount: number
    adminCount: number
    apiKeyCount: number
    apiRateLimitBucketCount: number
    dataTableCount: number
    newSignups30d: number
    newSignups7d: number
    savedRuleCount: number
    udmEventSetCount: number
    userCount: number
  }
  udmEventSets: AdminUdmEventSetSummary[]
  users: AdminUserSummary[]
}

const createHttpError = (statusCode: number, message: string) => new HttpError(statusCode, message)

async function requireAdminMutationRateLimit(context: unknown, adminUserId: string) {
  await requireRateLimit({
    bucket: "admin-mutation",
    context,
    createError: createHttpError,
    key: adminUserId,
    ownerId: adminUserId,
    ...RATE_LIMITS.adminMutation,
  })
}

export const getAdminDashboardData: GetAdminDashboardData<void, AdminDashboardData> = async (
  _args,
  context
) => {
  await requireAdmin(context)
  const [users, savedRules, udmEventSets, dataTables, apiKeys] = await Promise.all([
    context.entities.User.findMany({
      include: {
        _count: {
          select: {
            dataTables: true,
            apiKeys: true,
            apiRateLimits: true,
            savedRules: true,
            udmEventSets: true,
          },
        },
        apiKeys: {
          select: {
            expiresAt: true,
            lastUsedAt: true,
            revokedAt: true,
          },
        },
        dataTables: {
          orderBy: { updatedAt: "desc" },
          select: { updatedAt: true },
          take: 1,
        },
        savedRules: {
          orderBy: { updatedAt: "desc" },
          select: { updatedAt: true },
          take: 1,
        },
        udmEventSets: {
          orderBy: { updatedAt: "desc" },
          select: { updatedAt: true },
          take: 1,
        },
        auth: {
          include: {
            identities: true,
            sessions: {
              select: {
                expiresAt: true,
              },
            },
          },
        },
      },
      orderBy: [{ isAdmin: "desc" }, { id: "asc" }],
    }),
    context.entities.SavedRule.findMany({
      include: {
        owner: {
          include: {
            auth: {
              include: {
                identities: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    }),
    context.entities.UdmEventSet.findMany({
      include: {
        owner: {
          include: {
            auth: {
              include: {
                identities: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    }),
    context.entities.DataTable.findMany({
      include: {
        owner: {
          include: {
            auth: {
              include: {
                identities: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    }),
    context.entities.ApiKey.findMany({
      include: {
        owner: {
          include: {
            auth: {
              include: {
                identities: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    }),
  ])

  const apiKeyIds = apiKeys.map((apiKey: any) => apiKey.id)
  const apiRateLimits = apiKeyIds.length > 0
    ? await context.entities.ApiRateLimit.findMany({
        select: {
          bucket: true,
          count: true,
          key: true,
          ownerId: true,
          windowStart: true,
        },
        where: {
          bucket: { contains: ":key:" },
          key: { in: apiKeyIds },
          windowStart: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      })
    : []

  const userSummaries = users.map(toAdminUserSummary)
  const apiKeySummaries = apiKeys.map((apiKey: any) => toAdminApiKeySummary(apiKey, apiRateLimits))
  const recentStats = getRecentAdminStats(userSummaries)
  const settings = await getAppSettings(context as AdminContext & { entities: AdminContext["entities"] & { AppSetting: any } })

  return {
    apiKeys: apiKeySummaries,
    dataTables: dataTables.map(toAdminDataTableSummary),
    savedRules: savedRules.map(toAdminSavedRuleSummary),
    settings,
    stats: {
      activeApiKeyCount: apiKeySummaries.filter((apiKey) => apiKey.active).length,
      adminCount: userSummaries.filter((user) => user.isAdmin).length,
      apiKeyCount: apiKeySummaries.length,
      apiRateLimitBucketCount: apiRateLimits.length,
      dataTableCount: dataTables.length,
      newSignups30d: recentStats.newSignups30d,
      newSignups7d: recentStats.newSignups7d,
      savedRuleCount: savedRules.length,
      udmEventSetCount: udmEventSets.length,
      userCount: users.length,
    },
    udmEventSets: udmEventSets.map(toAdminUdmEventSetSummary),
    users: userSummaries,
  }
}

export const updateAdminUser: UpdateAdminUser<
  UpdateAdminUserArgs,
  AdminUserSummary
> = async (args, context) => {
  const adminUserId = await requireAdmin(context)
  await requireAdminMutationRateLimit(context, adminUserId)
  const userId = requireId(args.userId, "User id is required.")
  const targetUser = await context.entities.User.findUnique({
    include: {
      _count: {
        select: {
          dataTables: true,
          apiKeys: true,
          apiRateLimits: true,
          savedRules: true,
          udmEventSets: true,
        },
      },
      apiKeys: {
        select: {
          expiresAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      },
      auth: {
        include: {
          identities: true,
          sessions: {
            select: {
              expiresAt: true,
            },
          },
        },
      },
    },
    where: { id: userId },
  })
  if (!targetUser) {
    throw new HttpError(404, "User not found.")
  }

  requireAdminStatusChangeAllowed(adminUserId, targetUser, args.isAdmin, createHttpError)
  if (args.isAdmin === false && targetUser.isAdmin) {
    await requireAnotherAdmin(context, userId)
  }

  const updatedUser = await context.entities.User.update({
    data: {
      isAdmin: args.isAdmin ?? targetUser.isAdmin,
    },
    include: {
      _count: {
        select: {
          dataTables: true,
          apiKeys: true,
          apiRateLimits: true,
          savedRules: true,
          udmEventSets: true,
        },
      },
      apiKeys: {
        select: {
          expiresAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      },
      auth: {
        include: {
          identities: true,
          sessions: {
            select: {
              expiresAt: true,
            },
          },
        },
      },
    },
    where: { id: userId },
  })

  return toAdminUserSummary(updatedUser)
}

export const createAdminUser = async (
  args: CreateAdminUserArgs,
  context: AdminContext
): Promise<AdminUserSummary> => {
  const adminUserId = await requireAdmin(context)
  await requireAdminMutationRateLimit(context, adminUserId)
  const username = normalizeAdminUsername(args.username)
  const password = normalizeAdminPassword(args.password)
  const providerId = createProviderId("email", username)
  const legacyUsernameProviderId = createProviderId("username", username)
  const [existingIdentity, existingLegacyUsernameIdentity] = await Promise.all([
    findAuthIdentity(providerId),
    findAuthIdentity(legacyUsernameProviderId),
  ])
  if (existingIdentity || existingLegacyUsernameIdentity) {
    throw new HttpError(409, "A user with that email already exists.")
  }

  const providerData = await sanitizeAndSerializeProviderData<"email">({
    hashedPassword: password,
    isEmailVerified: true,
    emailVerificationSentAt: null,
    passwordResetSentAt: null,
  })

  const createdUser = await createUser(providerId, providerData, {
    isAdmin: Boolean(args.isAdmin),
  })

  const user = await context.entities.User.findUnique({
    include: {
      _count: {
        select: {
          dataTables: true,
          apiKeys: true,
          apiRateLimits: true,
          savedRules: true,
          udmEventSets: true,
        },
      },
      apiKeys: {
        select: {
          expiresAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      },
      auth: {
        include: {
          identities: true,
          sessions: {
            select: {
              expiresAt: true,
            },
          },
        },
      },
    },
    where: { id: createdUser.id },
  })

  if (!user) {
    throw new HttpError(500, "Created user could not be loaded.")
  }

  return toAdminUserSummary(user)
}

export const deleteAdminUser: DeleteAdminUser<
  DeleteAdminRecordArgs,
  AdminUserSummary
> = async (args, context) => {
  const adminUserId = await requireAdmin(context)
  await requireAdminMutationRateLimit(context, adminUserId)
  const userId = requireId(args.id, "User id is required.")
  if (userId === adminUserId) {
    throw new HttpError(400, "Admins cannot delete their own user.")
  }
  const targetUser = await context.entities.User.findUnique({
    include: {
      _count: {
        select: {
          dataTables: true,
          apiKeys: true,
          apiRateLimits: true,
          savedRules: true,
          udmEventSets: true,
        },
      },
      apiKeys: {
        select: {
          expiresAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      },
      auth: {
        include: {
          identities: true,
          sessions: {
            select: {
              expiresAt: true,
            },
          },
        },
      },
    },
    where: { id: userId },
  })
  if (!targetUser) {
    throw new HttpError(404, "User not found.")
  }

  return toAdminUserSummary(
    await context.entities.User.delete({
      include: {
        _count: {
          select: {
            dataTables: true,
            apiKeys: true,
            apiRateLimits: true,
            savedRules: true,
            udmEventSets: true,
          },
        },
        apiKeys: {
          select: {
            expiresAt: true,
            lastUsedAt: true,
            revokedAt: true,
          },
        },
        auth: {
          include: {
            identities: true,
            sessions: {
              select: {
                expiresAt: true,
              },
            },
          },
        },
      },
      where: { id: userId },
    })
  )
}

export const deleteAdminSavedRule: DeleteAdminSavedRule<
  DeleteAdminRecordArgs,
  AdminSavedRuleSummary
> = async (args, context) => {
  const adminUserId = await requireAdmin(context)
  await requireAdminMutationRateLimit(context, adminUserId)
  const id = requireId(args.id, "Rule id is required.")
  const record = await context.entities.SavedRule.findUnique({
    include: {
      owner: {
        include: {
          auth: {
            include: {
              identities: true,
            },
          },
        },
      },
    },
    where: { id },
  })
  if (!record) {
    throw new HttpError(404, "Rule not found.")
  }
  await context.entities.SavedRule.delete({ where: { id } })
  return toAdminSavedRuleSummary(record)
}

export const deleteAdminUdmEventSet: DeleteAdminUdmEventSet<
  DeleteAdminRecordArgs,
  AdminUdmEventSetSummary
> = async (args, context) => {
  const adminUserId = await requireAdmin(context)
  await requireAdminMutationRateLimit(context, adminUserId)
  const id = requireId(args.id, "UDM event set id is required.")
  const record = await context.entities.UdmEventSet.findUnique({
    include: {
      owner: {
        include: {
          auth: {
            include: {
              identities: true,
            },
          },
        },
      },
    },
    where: { id },
  })
  if (!record) {
    throw new HttpError(404, "UDM event set not found.")
  }
  await context.entities.UdmEventSet.delete({ where: { id } })
  return toAdminUdmEventSetSummary(record)
}

export const deleteAdminDataTable: DeleteAdminDataTable<
  DeleteAdminRecordArgs,
  AdminDataTableSummary
> = async (args, context) => {
  const adminUserId = await requireAdmin(context)
  await requireAdminMutationRateLimit(context, adminUserId)
  const id = requireId(args.id, "Data table id is required.")
  const record = await context.entities.DataTable.findUnique({
    include: {
      owner: {
        include: {
          auth: {
            include: {
              identities: true,
            },
          },
        },
      },
    },
    where: { id },
  })
  if (!record) {
    throw new HttpError(404, "Data table not found.")
  }
  await context.entities.DataTable.delete({ where: { id } })
  return toAdminDataTableSummary(record)
}

async function requireAdmin(context: AdminContext) {
  if (!context.user) {
    return requireAdminUserId(context, null, createHttpError)
  }
  const user = await context.entities.User.findUnique({
    select: { isAdmin: true },
    where: { id: context.user.id },
  })
  return requireAdminUserId(context, user, createHttpError)
}

async function requireAnotherAdmin(context: AdminContext, userId: string) {
  const otherAdminCount = await context.entities.User.count({
    where: {
      id: { not: userId },
      isAdmin: true,
    },
  })
  if (otherAdminCount === 0) {
    throw new HttpError(400, "At least one admin user must remain.")
  }
}

function requireId(value: string | null | undefined, message: string) {
  const id = value?.trim()
  if (!id) {
    throw new HttpError(400, message)
  }
  return id
}

function normalizeAdminUsername(value: string | null | undefined) {
  const username = value?.trim().toLowerCase()
  if (!username) {
    throw new HttpError(400, "Email is required.")
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
    throw new HttpError(400, "Email must be valid.")
  }
  return username
}

function normalizeAdminPassword(value: string | null | undefined) {
  const password = value ?? ""
  const passwordPolicyError = getPasswordPolicyError(password)
  if (passwordPolicyError) {
    throw new HttpError(400, passwordPolicyError)
  }
  return password
}

function toAdminUserSummary(user: any): AdminUserSummary {
  return {
    activeApiKeyCount: getActiveApiKeyCount(user.apiKeys),
    apiKeyCount: user._count?.apiKeys ?? 0,
    apiRateLimitBucketCount: user._count?.apiRateLimits ?? 0,
    createdAt: user.createdAt,
    dataTableCount: user._count?.dataTables ?? 0,
    id: user.id,
    isAdmin: user.isAdmin,
    lastActiveAt: getLastActiveAt(user),
    lastApiKeyUsedAt: getLastApiKeyUsedAt(user.apiKeys),
    lastLoginAt: getLastLoginAt(user),
    savedRuleCount: user._count?.savedRules ?? 0,
    udmEventSetCount: user._count?.udmEventSets ?? 0,
    username: getUsername(user),
  }
}

const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function getLastActiveAt(user: any) {
  const latestActivityMs = Math.max(
    getTime(getLastLoginAt(user)),
    getTime(getLastApiKeyUsedAt(user.apiKeys)),
    getTime(getLastContentUpdatedAt(user))
  )
  return latestActivityMs > 0 ? new Date(latestActivityMs) : null
}

function getLastLoginAt(user: any) {
  const latestSessionExpiresMs = Math.max(
    0,
    ...(user.auth?.sessions ?? []).map((session: { expiresAt?: Date | string | null }) =>
      getTime(session.expiresAt)
    )
  )
  const inferredSessionActivityMs = latestSessionExpiresMs > 0
    ? Math.max(0, latestSessionExpiresMs - AUTH_SESSION_TTL_MS)
    : 0
  return inferredSessionActivityMs > 0 ? new Date(inferredSessionActivityMs) : null
}

function getActiveApiKeyCount(apiKeys: any[] | undefined) {
  const now = Date.now()
  return (apiKeys ?? []).filter((key) =>
    !key.revokedAt && (!key.expiresAt || getTime(key.expiresAt) > now)
  ).length
}

function getLastApiKeyUsedAt(apiKeys: any[] | undefined) {
  const lastUsedMs = Math.max(
    0,
    ...(apiKeys ?? []).map((key) => getTime(key.lastUsedAt))
  )
  return lastUsedMs > 0 ? new Date(lastUsedMs) : null
}

function getLastContentUpdatedAt(user: any) {
  const latestContentMs = Math.max(
    0,
    ...(user.savedRules ?? []).map((record: { updatedAt?: Date | string | null }) =>
      getTime(record.updatedAt)
    ),
    ...(user.udmEventSets ?? []).map((record: { updatedAt?: Date | string | null }) =>
      getTime(record.updatedAt)
    ),
    ...(user.dataTables ?? []).map((record: { updatedAt?: Date | string | null }) =>
      getTime(record.updatedAt)
    )
  )
  return latestContentMs > 0 ? new Date(latestContentMs) : null
}

function getRecentAdminStats(users: AdminUserSummary[]) {
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

  return {
    newSignups30d: users.filter((user) => getTime(user.createdAt) >= thirtyDaysAgo).length,
    newSignups7d: users.filter((user) => getTime(user.createdAt) >= sevenDaysAgo).length,
  }
}

function getTime(date: Date | string | null | undefined) {
  return date ? new Date(date).getTime() : 0
}

function toAdminSavedRuleSummary(rule: any): AdminSavedRuleSummary {
  return {
    createdAt: rule.createdAt,
    description: rule.description,
    folder: rule.folder,
    id: rule.id,
    name: rule.name,
    ownerId: rule.ownerId,
    ownerUsername: getUsername(rule.owner),
    source: rule.source,
    sourceLength: rule.source.length,
    tags: rule.tags ?? [],
    updatedAt: rule.updatedAt,
  }
}

function toAdminUdmEventSetSummary(eventSet: any): AdminUdmEventSetSummary {
  return {
    createdAt: eventSet.createdAt,
    description: eventSet.description,
    eventCount: Array.isArray(eventSet.events) ? eventSet.events.length : 0,
    events: eventSet.events,
    expectedResults: eventSet.expectedResults,
    hasExpectedResults: eventSet.expectedResults != null,
    id: eventSet.id,
    name: eventSet.name,
    ownerId: eventSet.ownerId,
    ownerUsername: getUsername(eventSet.owner),
    savedRuleId: eventSet.savedRuleId,
    updatedAt: eventSet.updatedAt,
  }
}

function toAdminDataTableSummary(dataTable: any): AdminDataTableSummary {
  return {
    createdAt: dataTable.createdAt,
    description: dataTable.description,
    id: dataTable.id,
    name: dataTable.name,
    ownerId: dataTable.ownerId,
    ownerUsername: getUsername(dataTable.owner),
    rowCount: Array.isArray(dataTable.rows) ? dataTable.rows.length : 0,
    rows: dataTable.rows,
    updatedAt: dataTable.updatedAt,
  }
}

function toAdminApiKeySummary(apiKey: any, apiRateLimits: any[]): AdminApiKeySummary {
  const relatedRateLimits = apiRateLimits.filter((rateLimit) => rateLimit.key === apiKey.id)
  const status = getApiKeyStatus(apiKey)

  return {
    active: status === "active",
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt,
    id: apiKey.id,
    lastUsedAt: apiKey.lastUsedAt,
    name: apiKey.name,
    ownerId: apiKey.ownerId,
    ownerUsername: getUsername(apiKey.owner),
    prefix: apiKey.prefix,
    rateLimitBucketCount: relatedRateLimits.length,
    recentUsageCount: relatedRateLimits
      .filter((rateLimit) => String(rateLimit.bucket).endsWith(":key:day"))
      .reduce((total, rateLimit) => total + normalizeAdminCount(rateLimit.count), 0),
    revokedAt: apiKey.revokedAt,
    scopes: normalizeApiKeyScopes(apiKey.scopes),
    status,
    updatedAt: apiKey.updatedAt,
  }
}

function getApiKeyStatus(apiKey: any): AdminApiKeySummary["status"] {
  if (apiKey.revokedAt) {
    return "revoked"
  }
  if (apiKey.expiresAt && getTime(apiKey.expiresAt) <= Date.now()) {
    return "expired"
  }
  return "active"
}

function normalizeApiKeyScopes(value: unknown) {
  return Array.isArray(value) ? value.map((scope) => String(scope)) : []
}

function normalizeAdminCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function getUsername(user: any) {
  if (!user) {
    return "Unowned"
  }
  const identity =
    user.auth?.identities?.find((item: any) => item.providerName === "email") ??
    user.auth?.identities?.find((item: any) => item.providerName === "username")
  return identity?.providerUserId ?? user.id
}
