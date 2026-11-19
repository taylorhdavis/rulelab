import { HttpError } from "wasp/server"
import type { OnBeforeSignupHook } from "wasp/server/auth"
import {
  getSignupIpAddress,
  requireSignupRateLimits,
  shouldDisableSignupForSettings,
  validateSignupEmailAddress,
} from "./authSignupPolicy"

const APP_SETTINGS_KEY = "app"

export const onBeforeSignup: OnBeforeSignupHook = async ({ prisma, providerId, req }) => {
  const appSettings = await prisma.appSetting.findUnique({
    select: { value: true },
    where: { key: APP_SETTINGS_KEY },
  })

  if (shouldDisableSignupForSettings(appSettings?.value)) {
    throw new HttpError(403, "New signups are currently disabled.")
  }

  await requireSignupRateLimits({
    context: { entities: { ApiRateLimit: prisma.apiRateLimit } },
    createError: (statusCode, message) => new HttpError(statusCode, message),
    email: providerId.providerUserId,
    ipAddress: getSignupIpAddress(req),
  })

  try {
    await validateSignupEmailAddress(providerId.providerUserId)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not validate that email address."
    throw new HttpError(400, message)
  }
}
