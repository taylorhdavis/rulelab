import type express from "express"

import { HttpError, config } from "wasp/server"
import { createJWT, TimeSpan, validateJWT } from "wasp/auth/jwt"
import { emailSender } from "wasp/server/email"
import {
  createProviderId,
  doFakeWork,
  findAuthIdentity,
  getProviderDataWithPassword,
  updateAuthIdentityProviderData,
} from "wasp/auth/utils"
import { getPasswordPolicyError } from "../lib/passwordPolicy"
import { getPasswordResetEmailContent } from "./authEmails"
import { getPasswordResetResendStatus } from "./passwordResetPolicy"

const PASSWORD_RESET_ROUTE = "/password-reset"
const FROM_FIELD = {
  name: "RuleLab",
  email: "noreply@example.com",
}

export async function requestRulelabPasswordReset(
  req: express.Request,
  res: express.Response,
  _context?: unknown
) {
  const email = getEmailArg(req.body)
  const providerId = createProviderId("email", email)
  const authIdentity = await findAuthIdentity(providerId)

  if (!authIdentity) {
    await doFakeWork()
    return res.json({ success: true })
  }

  const providerData = getProviderDataWithPassword<"email">(authIdentity.providerData)
  const resendStatus = getPasswordResetResendStatus(providerData.passwordResetSentAt)
  if (!resendStatus.isAllowed) {
    throw new HttpError(400, `Please wait ${resendStatus.timeLeftSeconds} secs before trying again.`)
  }

  const jwtToken = await createJWT(
    { email: providerId.providerUserId },
    { expiresIn: new TimeSpan(30, "m") }
  )
  const passwordResetLink = `${config.frontendUrl}${PASSWORD_RESET_ROUTE}?token=${jwtToken}`
  const passwordResetSentAt = new Date().toISOString()

  await updateAuthIdentityProviderData<"email">(providerId, providerData, {
    passwordResetSentAt,
  })

  try {
    await emailSender.send({
      from: FROM_FIELD,
      to: providerId.providerUserId,
      ...getPasswordResetEmailContent({ passwordResetLink }),
    })
  } catch (error) {
    console.error("Failed to send password reset email:", error)
    await updateAuthIdentityProviderData<"email">(
      providerId,
      { ...providerData, passwordResetSentAt },
      { passwordResetSentAt: providerData.passwordResetSentAt }
    )
    throw new HttpError(500, "Failed to send password reset email.")
  }

  return res.json({ success: true })
}

export async function resetRulelabPassword(
  req: express.Request,
  res: express.Response,
  _context?: unknown
) {
  const token = getStringArg(req.body, "token", "Password reset link is missing a token.")
  const password = getStringArg(req.body, "password", "Password is required.")
  const passwordPolicyError = getPasswordPolicyError(password)
  if (passwordPolicyError) {
    throw new HttpError(400, passwordPolicyError)
  }

  const { email } = await validateJWT<{ email: string }>(token).catch(() => {
    throw new HttpError(400, "Password reset link is invalid or expired.")
  })
  const providerId = createProviderId("email", email)
  const authIdentity = await findAuthIdentity(providerId)
  if (!authIdentity) {
    throw new HttpError(400, "Password reset link is invalid or expired.")
  }

  const providerData = getProviderDataWithPassword<"email">(authIdentity.providerData)
  await updateAuthIdentityProviderData<"email">(providerId, providerData, {
    hashedPassword: password,
    isEmailVerified: true,
    passwordResetSentAt: null,
  })

  return res.json({ success: true })
}

function getEmailArg(body: unknown) {
  const email = getStringArg(body, "email", "Email is required.").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address.")
  }
  return email
}

function getStringArg(body: unknown, key: string, message: string) {
  const value = typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)[key]
    : null
  if (
    typeof value !== "string" ||
    !value
  ) {
    throw new HttpError(400, message)
  }
  return value
}
