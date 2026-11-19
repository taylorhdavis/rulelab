import type { ServerSetupFn } from "wasp/server"
import { prisma } from "wasp/server"
import { sanitizeAndSerializeProviderData } from "wasp/auth/utils"

import { bootstrapDefaultAdmin, DEFAULT_ADMIN_SETUP_KEY, getDefaultAdminConfig } from "./defaultAdminBootstrap"

export const serverSetup: ServerSetupFn = async () => {
  if (process.env.AUTH_IDENTITY_COMPAT_MIGRATION_ENABLED === "true") {
    await migrateUsernameAuthIdentitiesToEmail()
  }

  await bootstrapDefaultAdmin(getDefaultAdminConfig(), {
    isComplete: async () => Boolean(await prisma.appSetting.findUnique({ where: { key: DEFAULT_ADMIN_SETUP_KEY } })),
    transaction: (work) => prisma.$transaction(async (tx) => work({
      isComplete: async () => Boolean(await tx.appSetting.findUnique({ where: { key: DEFAULT_ADMIN_SETUP_KEY } })),
      markComplete: async () => { await tx.appSetting.create({ data: { key: DEFAULT_ADMIN_SETUP_KEY, value: { completed: true } } }) },
      findIdentity: async (email) => {
        const identity = await tx.authIdentity.findUnique({
          where: { providerName_providerUserId: { providerName: "email", providerUserId: email } },
          include: { auth: { include: { user: true } } },
        })
        return identity ? { isAdmin: identity.auth.user?.isAdmin === true } : null
      },
      createAdmin: async (email, providerData) => {
        await tx.user.create({ data: { isAdmin: true, auth: { create: {
          identities: { create: { providerName: "email", providerUserId: email, providerData } },
        } } } })
      },
    })),
  }, (password) => sanitizeAndSerializeProviderData<"email">({
    hashedPassword: password, isEmailVerified: false, emailVerificationSentAt: null, passwordResetSentAt: null,
  }))

}

async function migrateUsernameAuthIdentitiesToEmail() {
  const usernameIdentities = await prisma.authIdentity.findMany({
    select: {
      authId: true,
      providerData: true,
      providerUserId: true,
    },
    where: {
      providerName: "username",
    },
  })

  let migratedCount = 0
  for (const identity of usernameIdentities) {
    const email = identity.providerUserId.trim().toLowerCase()
    if (!isEmailAddress(email)) {
      continue
    }

    const providerData = getEmailProviderDataFromUsernameIdentity(identity.providerData)
    if (!providerData) {
      continue
    }

    await prisma.authIdentity.upsert({
      create: {
        authId: identity.authId,
        providerName: "email",
        providerUserId: email,
        providerData,
      },
      update: {},
      where: {
        providerName_providerUserId: {
          providerName: "email",
          providerUserId: email,
        },
      },
    })
    migratedCount += 1
  }

  if (migratedCount > 0) {
    console.info(`Migrated ${migratedCount} username auth identity/identities to email auth.`)
  }
}

function getEmailProviderDataFromUsernameIdentity(providerData: string) {
  try {
    const parsedProviderData = JSON.parse(providerData) as Record<string, unknown>
    if (typeof parsedProviderData.hashedPassword !== "string") {
      return null
    }
    return JSON.stringify({
      hashedPassword: parsedProviderData.hashedPassword,
      isEmailVerified: true,
      emailVerificationSentAt: null,
      passwordResetSentAt: null,
    })
  } catch {
    return null
  }
}

function isEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
