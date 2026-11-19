export const PUBLIC_INTERNAL_ERROR_MESSAGE = "Internal server error."

export function getPublicErrorMessage(error: unknown, fallback = PUBLIC_INTERNAL_ERROR_MESSAGE) {
  const message = getErrorMessage(error)
  if (!message || isInternalErrorMessage(message)) {
    return fallback
  }

  return message
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }

  return null
}

function isInternalErrorMessage(message: string) {
  const normalizedMessage = message.trim().toLowerCase()
  return (
    normalizedMessage.length === 0 ||
    normalizedMessage === PUBLIC_INTERNAL_ERROR_MESSAGE.toLowerCase() ||
    normalizedMessage.includes("5xx") ||
    normalizedMessage.includes("failed to fetch") ||
    /\b5\d\d\b/.test(normalizedMessage)
  )
}
