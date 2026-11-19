export const PASSWORD_RESET_RESEND_INTERVAL_MS = 60 * 1000

export function getPasswordResetResendStatus(sentAt: string | null) {
  if (!sentAt) {
    return { isAllowed: true, timeLeftSeconds: 0 }
  }

  const diffMs = Date.now() - new Date(sentAt).getTime()
  const timeLeftMs = PASSWORD_RESET_RESEND_INTERVAL_MS - diffMs
  return {
    isAllowed: timeLeftMs <= 0,
    timeLeftSeconds: Math.max(0, Math.round(timeLeftMs / 1000)),
  }
}
