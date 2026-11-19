export type AdminDashboardErrorFactory = (statusCode: number, message: string) => Error

export type AdminAuthContext = {
  user?: { id: string } | null
}

export function requireAdminUserId(
  context: AdminAuthContext,
  user: { isAdmin: boolean } | null | undefined,
  createError: AdminDashboardErrorFactory
) {
  if (!context.user) {
    throw createError(401, "You must be logged in.")
  }
  if (!user?.isAdmin) {
    throw createError(403, "Admin access required.")
  }
  return context.user.id
}

export function requireAdminStatusChangeAllowed(
  adminUserId: string,
  targetUser: { id: string; isAdmin: boolean },
  nextIsAdmin: boolean | undefined,
  createError: AdminDashboardErrorFactory
) {
  if (nextIsAdmin !== undefined && targetUser.id === adminUserId && nextIsAdmin !== targetUser.isAdmin) {
    throw createError(400, "Admins cannot change their own admin status.")
  }
}
