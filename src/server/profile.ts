import { HttpError, prisma } from "wasp/server"
import { verifyPassword } from "wasp/auth/password"
import {
  createProviderId,
  getProviderDataWithPassword,
  updateAuthIdentityProviderData,
} from "wasp/auth/utils"
import type { DeleteAccount, GetProfileData, UpdatePassword } from "wasp/server/operations"

import { WORKSPACE_LIMITS } from "../domain/workspace"
import { getPasswordPolicyError } from "../lib/passwordPolicy"
import { RATE_LIMITS, requireRateLimit } from "./rateLimit"

type ProfileContext = {
  entities: {
    ApiRateLimit?: any
    DataTable?: any
    SavedRule?: any
    UdmEventSet?: any
    User: any
  }
  user?: { id: string } | null
}

type UpdatePasswordArgs = {
  currentPassword?: string
  newPassword?: string
}

type DeleteAccountArgs = {
  confirmation?: string
  currentPassword?: string
}

export type ProfileData = {
  email: string | null
  isAdmin: boolean
  joinedAt: Date
  limits: {
    dataTables: number
    fixtureEventsPerSet: number
    fixtures: number
    rules: number
  }
  usage: {
    dataTables: number
    rules: number
    testCases: number
  }
  userId: string
}

export const getProfileData: GetProfileData<void, ProfileData> = async (_args, context) => {
  const userId = requireUserId(context)
  const user = await context.entities.User.findUnique({
    include: {
      auth: {
        include: {
          identities: true,
        },
      },
    },
    where: { id: userId },
  })

  if (!user) {
    throw new HttpError(404, "User not found.")
  }

  const [rules, testCases, dataTables] = await Promise.all([
    context.entities.SavedRule?.count({ where: { ownerId: userId } }) ?? 0,
    context.entities.UdmEventSet?.count({ where: { ownerId: userId } }) ?? 0,
    context.entities.DataTable?.count({ where: { ownerId: userId } }) ?? 0,
  ])

  return {
    email: getPasswordIdentity(user)?.providerUserId ?? null,
    isAdmin: Boolean(user.isAdmin),
    joinedAt: user.createdAt,
    limits: {
      dataTables: WORKSPACE_LIMITS.dataTables,
      fixtureEventsPerSet: WORKSPACE_LIMITS.fixtureEventsPerSet,
      fixtures: WORKSPACE_LIMITS.fixtures,
      rules: WORKSPACE_LIMITS.rules,
    },
    usage: {
      dataTables,
      rules,
      testCases,
    },
    userId: user.id,
  }
}

export const updatePassword: UpdatePassword<UpdatePasswordArgs, { success: true }> = async (
  args,
  context
) => {
  const userId = requireUserId(context)
  await requireProfileMutationRateLimit(context, userId)
  const currentPassword = normalizePassword(args.currentPassword)
  const newPassword = normalizePassword(args.newPassword)
  validateNewPassword(newPassword)

  if (currentPassword === newPassword) {
    throw new HttpError(400, "New password must be different from your current password.")
  }

  const user = await context.entities.User.findUnique({
    include: {
      auth: {
        include: {
          identities: true,
        },
      },
    },
    where: { id: userId },
  })
  const { providerData, providerName, providerUserId } = requirePasswordIdentity(user)
  await verifyCurrentPassword(providerData.hashedPassword, currentPassword)

  if (providerName === "username") {
    await updateAuthIdentityProviderData<"username">(
      createProviderId("username", providerUserId),
      providerData,
      { hashedPassword: newPassword }
    )
  } else {
    await updateAuthIdentityProviderData<"email">(
      createProviderId("email", providerUserId),
      providerData,
      { hashedPassword: newPassword }
    )
  }

  return { success: true }
}

export const deleteAccount: DeleteAccount<DeleteAccountArgs, { success: true }> = async (
  args,
  context
) => {
  const userId = requireUserId(context)
  await requireProfileMutationRateLimit(context, userId)
  const currentPassword = normalizePassword(args.currentPassword)
  const user = await context.entities.User.findUnique({
    include: {
      auth: {
        include: {
          identities: true,
        },
      },
    },
    where: { id: userId },
  })
  const { providerData, providerUserId } = requirePasswordIdentity(user)
  const email = providerUserId
  const confirmation = (args.confirmation ?? "").trim().toLowerCase()
  if (!confirmation || confirmation !== email.toLowerCase()) {
    throw new HttpError(400, "Type your account email to confirm deletion.")
  }

  await verifyCurrentPassword(providerData.hashedPassword, currentPassword)
  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id: userId } })
  })

  return { success: true }
}

function requireUserId(context: { user?: { id: string } | null }) {
  if (!context.user) {
    throw new HttpError(401, "You must be logged in.")
  }
  return context.user.id
}

async function requireProfileMutationRateLimit(context: unknown, userId: string) {
  await requireRateLimit({
    bucket: "profile-mutation",
    context,
    createError: (statusCode, message) => new HttpError(statusCode, message),
    key: userId,
    ownerId: userId,
    ...RATE_LIMITS.profileMutation,
  })
}

function normalizePassword(value: string | undefined) {
  const password = value ?? ""
  if (!password) {
    throw new HttpError(400, "Password is required.")
  }
  return password
}

function validateNewPassword(password: string) {
  const passwordPolicyError = getPasswordPolicyError(password)
  if (passwordPolicyError) {
    throw new HttpError(400, passwordPolicyError)
  }
}

function getPasswordIdentity(user: any) {
  return (
    user.auth?.identities?.find((identity: any) => identity.providerName === "username") ??
    user.auth?.identities?.find((identity: any) => identity.providerName === "email") ??
    null
  )
}

function requirePasswordIdentity(user: any) {
  const passwordIdentity = user ? getPasswordIdentity(user) : null
  if (!passwordIdentity) {
    throw new HttpError(400, "Password confirmation is only available for password accounts.")
  }
  if (passwordIdentity.providerName === "username") {
    return {
      providerData: getProviderDataWithPassword<"username">(passwordIdentity.providerData),
      providerName: "username" as const,
      providerUserId: passwordIdentity.providerUserId,
    }
  }
  const providerData = getProviderDataWithPassword<"email">(passwordIdentity.providerData)
  return {
    providerData,
    providerName: "email" as const,
    providerUserId: passwordIdentity.providerUserId,
  }
}

async function verifyCurrentPassword(hashedPassword: string, currentPassword: string) {
  try {
    await verifyPassword(hashedPassword, currentPassword)
  } catch {
    throw new HttpError(400, "Current password is incorrect.")
  }
}
