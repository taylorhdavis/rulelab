import crypto from "node:crypto"
import type { Request, RequestHandler } from "express"
import { HttpError, prisma } from "wasp/server"
import { createSession } from "wasp/auth/session"
import { verifyPassword } from "wasp/auth/password"
import {
  createProviderId, createUser, findAuthIdentity,
  getProviderDataWithPassword, sanitizeAndSerializeProviderData,
} from "wasp/auth/utils"
import { onBeforeSignup } from "./authHooks"
import { getSignupIpAddress } from "./authSignupPolicy"
import { requireRateLimit } from "./rateLimit"
import { authenticatePassword, normalizePasswordCredentials } from "./passwordAuthPolicy"

const createError = (code: number, message: string) => new HttpError(code, message)

// Keep Wasp sessions and password hashing, with email verification removed.
// Installed before the generated email-auth router, after the JSON parser.
export const passwordAuthMiddleware: RequestHandler = (req, res, next) => {
  if (req.method !== "POST") return next()
  const match = req.originalUrl.split("?")[0].match(/^\/auth\/email\/(login|signup|verify-email)\/?$/)
  if (!match) return next()
  if (match[1] === "verify-email") return next(new HttpError(404, "Not found."))
  const signingUp = match[1] === "signup"
  res.setHeader("Cache-Control", "no-store")
  void handlePasswordAuth(req, signingUp).then((result) => { res.json(result) }).catch(next)
}

async function handlePasswordAuth(req: Request, signingUp: boolean) {
  const { email, password } = normalizePasswordCredentials(req.body, signingUp, createError)
  const providerId = createProviderId("email", email)
  if (signingUp) {
    await onBeforeSignup({ prisma, providerId, req })
    // Never delete or overwrite an existing account, including unverified ones.
    if (await findAuthIdentity(providerId)) return { success: true }
    const providerData = await sanitizeAndSerializeProviderData<"email">({
      hashedPassword: password,
      isEmailVerified: false,
      emailVerificationSentAt: null,
      passwordResetSentAt: null,
    })
    try {
      await createUser(providerId, providerData, {})
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error
    }
    return { success: true }
  }
  for (const [bucket, value, limit] of [
    ["login-email", email, 20], ["login-ip", getSignupIpAddress(req) ?? "unknown", 60],
  ] as const) {
    await requireRateLimit({
      bucket, key: crypto.createHash("sha256").update(value).digest("hex"),
      limit, windowMs: 60_000, createError,
    })
  }
  return authenticatePassword({
    email, password, createError, createSession, verifyPassword,
    findIdentity: async (address) => {
      const identity = await findAuthIdentity(createProviderId("email", address))
      if (!identity) return null
      const { hashedPassword } = getProviderDataWithPassword<"email">(identity.providerData)
      return { authId: identity.authId, hashedPassword }
    },
  })
}
