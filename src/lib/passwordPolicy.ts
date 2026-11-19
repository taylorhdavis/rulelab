export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128
export const PASSWORD_POLICY_DESCRIPTION = `${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters, including one number.`

export function getPasswordPolicyError(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`
  }
  if (!/\d/.test(password)) {
    return "Password must contain a number."
  }
  return null
}

export function passwordMeetsPolicy(password: string) {
  return getPasswordPolicyError(password) == null
}
