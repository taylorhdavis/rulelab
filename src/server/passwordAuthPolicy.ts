import { getPasswordPolicyError } from "../lib/passwordPolicy"

type ErrorFactory = (code: number, message: string) => Error
export function normalizePasswordCredentials(body: unknown, signup: boolean, createError: ErrorFactory) {
  const fields = body && typeof body === "object" ? body as Record<string, unknown> : {}
  const email = typeof fields.email === "string" ? fields.email.trim().toLowerCase() : ""
  const password = typeof fields.password === "string" ? fields.password : ""
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 128) {
    throw createError(400, "Invalid email or password.")
  }
  if (signup) {
    const error = getPasswordPolicyError(password)
    if (error) throw createError(400, error)
  }
  return { email, password }
}

export async function authenticatePassword({
  email, password, findIdentity, verifyPassword, createSession, createError,
}: {
  email: string
  password: string
  findIdentity: (email: string) => Promise<{ authId: string; hashedPassword: string } | null>
  verifyPassword: (hash: string, password: string) => Promise<unknown>
  createSession: (authId: string) => Promise<{ id: string }>
  createError: ErrorFactory
}) {
  const identity = await findIdentity(email)
  if (!identity) throw createError(401, "Email or password is incorrect.")
  try {
    await verifyPassword(identity.hashedPassword, password)
  } catch {
    throw createError(401, "Email or password is incorrect.")
  }
  // Email ownership is not a prerequisite for account access in this product.
  const session = await createSession(identity.authId)
  return { sessionId: session.id }
}
