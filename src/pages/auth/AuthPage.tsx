import { useState } from "react"
import type { ComponentProps, FormEvent, ReactNode } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { api, handleApiError } from "wasp/client/api"
import {
  login,
  signup,
} from "wasp/client/auth"
import {
  getPublicAppSettings,
  useQuery,
} from "wasp/client/operations"

import { AppLogo } from "../../components/AppLogo"
import { cn } from "../../lib/utils"
import { getPasswordPolicyError, PASSWORD_POLICY_DESCRIPTION, passwordMeetsPolicy } from "../../lib/passwordPolicy"
import { PUBLIC_INTERNAL_ERROR_MESSAGE } from "../../lib/public-errors"
import { Button } from "../../components/ui/button"
import {
  Card,
  CardContent,
} from "../../components/ui/card"
import { Alert, AlertDescription } from "../../components/ui/alert"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field"
import { Input } from "../../components/ui/input"
import { TextLink } from "../../components/ui/text-link"

const PUBLIC_LOGIN_ERROR_MESSAGE = "Email or password is incorrect."
const PUBLIC_SIGNUP_ERROR_MESSAGE = "We couldn't create that account."
const PUBLIC_PASSWORD_RESET_ERROR_MESSAGE = "We couldn't complete that password reset request."

export function LoginPage() {
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  )
}

export function SignupPage() {
  return (
    <AuthShell>
      <SignupForm />
    </AuthShell>
  )
}

export function RequestPasswordResetPage() {
  return (
    <AuthShell>
      <RequestPasswordResetForm />
    </AuthShell>
  )
}

export function PasswordResetPage() {
  return (
    <AuthShell>
      <PasswordResetForm />
    </AuthShell>
  )
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex h-full min-h-0 overflow-y-auto bg-background px-4 py-8 sm:px-6">
      <div className="m-auto flex w-full max-w-md items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            {children}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

export function LoginForm({
  className,
  ...props
}: ComponentProps<"div">) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const nextPath = getSafeNextPath(searchParams.get("next"))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    const normalizedEmail = email.trim().toLowerCase()

    try {
      await login({ email: normalizedEmail, password })
      await continueAfterAuth(navigate, nextPath)
    } catch (authError) {
      setError(getAuthErrorMessage(authError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <Link
              to="/"
              className="flex flex-col items-center gap-2 font-medium"
            >
              <AppLogo />
            </Link>
            <h1 className="text-xl font-bold">Welcome to RuleLab</h1>
            <FieldDescription>
              Don&apos;t have an account?{" "}
              <TextLink asChild><Link to={getAuthLink("/signup", nextPath)}>Sign up</Link></TextLink>
            </FieldDescription>
          </div>
          {error ? (
            <Field>
              <Alert variant="destructive" className="grid-cols-1">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              autoComplete="email"
              autoFocus
              id="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              required
              type="email"
              value={email}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <div className="flex items-center justify-between gap-3">
              <span className="sr-only">Password</span>
              <TextLink asChild className="ml-auto text-xs">
                <Link to="/request-password-reset">Forgot password?</Link>
              </TextLink>
            </div>
            <Input
              autoComplete="current-password"
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••"
              required
              type="password"
              value={password}
            />
          </Field>
          <Field>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Signing in" : "Log in"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
      <FieldDescription className="px-6 text-center">
        Read the{" "}
        <TextLink asChild><Link to="/terms">Project information</Link></TextLink>{" "}
        and{" "}
        <TextLink asChild><Link to="/privacy-policy">Data and privacy</Link></TextLink>
        .
      </FieldDescription>
    </div>
  )
}

export function SignupForm({
  className,
  ...props
}: ComponentProps<"div">) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: settings } = useQuery(getPublicAppSettings)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false)
  const nextPath = getSafeNextPath(searchParams.get("next"))
  const passwordError = getPasswordPolicyError(password)
  const passwordMeetsRequirements = passwordMeetsPolicy(password)
  const showPasswordError = passwordTouched && !passwordMeetsRequirements
  const showConfirmPasswordError = confirmPasswordTouched && password !== confirmPassword

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPasswordTouched(true)
    setConfirmPasswordTouched(true)
    const normalizedEmail = email.trim().toLowerCase()

    if (settings?.signupsEnabled === false) {
      setError("New signups are currently disabled.")
      return
    }

    if (!passwordMeetsRequirements) {
      return
    }

    if (password !== confirmPassword) {
      return
    }

    setIsSubmitting(true)
    try {
      await signup({ email: normalizedEmail, password })
      await login({ email: normalizedEmail, password })
      await continueAfterAuth(navigate, nextPath)
    } catch (authError) {
      setError(getSignupErrorMessage(authError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <Link
              to="/"
              className="flex flex-col items-center gap-2 font-medium"
            >
              <AppLogo />
            </Link>
            <h1 className="text-xl font-bold">Create an account</h1>
            <FieldDescription>
              Already have an account?{" "}
              <TextLink asChild><Link to={getAuthLink("/login", nextPath)}>Sign in</Link></TextLink>
            </FieldDescription>
          </div>
          {error ? (
            <Field>
              <Alert variant="destructive" className="grid-cols-1">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </Field>
          ) : null}
          {settings?.signupsEnabled === false ? (
            <Field>
              <Alert variant="destructive" className="grid-cols-1">
                <AlertDescription>New signups are currently disabled.</AlertDescription>
              </Alert>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="name">Full name</FieldLabel>
            <Input
              id="name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Your full name"
              required
              type="text"
              value={name}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              autoComplete="email"
              id="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              required
              type="email"
              value={email}
            />
            <FieldDescription>
              We&apos;ll use this email for your RuleLab account.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              aria-describedby="password-requirements"
              aria-invalid={showPasswordError}
              autoComplete="new-password"
              id="password"
              placeholder="Create a password"
              onBlur={() => setPasswordTouched(true)}
              onChange={(event) => {
                setPassword(event.target.value)
                if (!passwordTouched) {
                  setPasswordTouched(true)
                }
              }}
              required
              type="password"
              value={password}
            />
            {showPasswordError ? (
              <FieldError id="password-requirements">{passwordError}</FieldError>
            ) : (
              <FieldDescription id="password-requirements">
                {PASSWORD_POLICY_DESCRIPTION}
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">
              Confirm password
            </FieldLabel>
            <Input
              aria-invalid={showConfirmPasswordError}
              autoComplete="new-password"
              id="confirm-password"
              placeholder="Re-enter password"
              onBlur={() => setConfirmPasswordTouched(true)}
              onChange={(event) => {
                setConfirmPassword(event.target.value)
                if (!confirmPasswordTouched) {
                  setConfirmPasswordTouched(true)
                }
              }}
              required
              type="password"
              value={confirmPassword}
            />
            {showConfirmPasswordError ? (
              <FieldError>Passwords must match.</FieldError>
            ) : (
              <FieldDescription>Please confirm your password.</FieldDescription>
            )}
          </Field>
          <Field>
            <Button disabled={isSubmitting || settings?.signupsEnabled === false} type="submit">
              {isSubmitting ? "Creating account" : "Create account"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
      <FieldDescription className="px-6 text-center">
        Read the{" "}
        <TextLink asChild><Link to="/terms">Project information</Link></TextLink>{" "}
        and{" "}
        <TextLink asChild><Link to="/privacy-policy">Data and privacy</Link></TextLink>
        .
      </FieldDescription>
    </div>
  )
}

function RequestPasswordResetForm({
  className,
  ...props
}: ComponentProps<"div">) {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [requestComplete, setRequestComplete] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await requestRulelabPasswordReset({ email: email.trim().toLowerCase() })
      setRequestComplete(true)
    } catch {
      setError(PUBLIC_PASSWORD_RESET_ERROR_MESSAGE)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (requestComplete) {
    return (
      <div className={cn("flex flex-col gap-6 text-center", className)} {...props}>
        <Link to="/" className="mx-auto flex flex-col items-center gap-2 font-medium">
          <AppLogo />
        </Link>
        <div className="space-y-2">
          <h1 className="text-xl font-bold">Check your email</h1>
          <FieldDescription>
            If that email exists, we sent a password reset link.
          </FieldDescription>
        </div>
        <Button asChild type="button">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <Link to="/" className="flex flex-col items-center gap-2 font-medium">
              <AppLogo />
            </Link>
            <h1 className="text-xl font-bold">Reset your password</h1>
            <FieldDescription>
              Enter your email and we&apos;ll send a reset link.
            </FieldDescription>
          </div>
          {error ? (
            <Field>
              <Alert variant="destructive" className="grid-cols-1">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="reset-email">Email</FieldLabel>
            <Input
              autoComplete="email"
              autoFocus
              id="reset-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              required
              type="email"
              value={email}
            />
          </Field>
          <Field>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Sending reset link" : "Send reset link"}
            </Button>
          </Field>
          <FieldDescription className="text-center">
            Remembered it?{" "}
            <TextLink asChild><Link to="/login">Sign in</Link></TextLink>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  )
}

function PasswordResetForm({
  className,
  ...props
}: ComponentProps<"div">) {
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [resetComplete, setResetComplete] = useState(false)
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false)
  const passwordError = getPasswordPolicyError(password)
  const passwordMeetsRequirements = passwordMeetsPolicy(password)
  const showPasswordError = passwordTouched && !passwordMeetsRequirements
  const passwordsMismatch = confirmPasswordTouched && password !== confirmPassword

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPasswordTouched(true)
    setConfirmPasswordTouched(true)

    if (!token) {
      setError("Password reset link is missing a token.")
      return
    }

    if (!passwordMeetsRequirements) {
      return
    }

    if (password !== confirmPassword) {
      return
    }

    setIsSubmitting(true)
    try {
      await resetRulelabPassword({ token, password })
      setResetComplete(true)
    } catch {
      setError("Password reset link is invalid or expired.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (resetComplete) {
    return (
      <div className={cn("flex flex-col gap-6 text-center", className)} {...props}>
        <Link to="/" className="mx-auto flex flex-col items-center gap-2 font-medium">
          <AppLogo />
        </Link>
        <div className="space-y-2">
          <h1 className="text-xl font-bold">Password updated</h1>
          <FieldDescription>You can now sign in with your new password.</FieldDescription>
        </div>
        <Button asChild type="button">
          <Link to="/login">Sign in</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <Link to="/" className="flex flex-col items-center gap-2 font-medium">
              <AppLogo />
            </Link>
            <h1 className="text-xl font-bold">Choose a new password</h1>
          </div>
          {error ? (
            <Field>
              <Alert variant="destructive" className="grid-cols-1">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              aria-describedby="new-password-requirements"
              aria-invalid={showPasswordError}
              autoComplete="new-password"
              autoFocus
              id="new-password"
              onBlur={() => setPasswordTouched(true)}
              onChange={(event) => {
                setPassword(event.target.value)
                if (!passwordTouched) {
                  setPasswordTouched(true)
                }
              }}
              placeholder="Create a password"
              required
              type="password"
              value={password}
            />
            {showPasswordError ? (
              <FieldError id="new-password-requirements">{passwordError}</FieldError>
            ) : (
              <FieldDescription id="new-password-requirements">
                {PASSWORD_POLICY_DESCRIPTION}
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-new-password">Confirm password</FieldLabel>
            <Input
              aria-invalid={passwordsMismatch}
              autoComplete="new-password"
              id="confirm-new-password"
              onBlur={() => setConfirmPasswordTouched(true)}
              onChange={(event) => {
                setConfirmPassword(event.target.value)
                if (!confirmPasswordTouched) {
                  setConfirmPasswordTouched(true)
                }
              }}
              placeholder="Re-enter password"
              required
              type="password"
              value={confirmPassword}
            />
            {passwordsMismatch ? <FieldError>Passwords must match.</FieldError> : null}
          </Field>
          <Field>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Updating password" : "Update password"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  )
}

function getAuthErrorMessage(error: unknown) {
  if (isExpectedLoginFailure(error)) {
    return PUBLIC_LOGIN_ERROR_MESSAGE
  }
  return PUBLIC_INTERNAL_ERROR_MESSAGE
}

function getSignupErrorMessage(error: unknown) {
  if (isExpectedSignupFailure(error)) {
    return PUBLIC_SIGNUP_ERROR_MESSAGE
  }
  return PUBLIC_INTERNAL_ERROR_MESSAGE
}

function isExpectedLoginFailure(error: unknown) {
  return error instanceof Error && /invalid|password|credential|unauthori[sz]ed/i.test(error.message)
}

function isExpectedSignupFailure(error: unknown) {
  return error instanceof Error && /already|duplicate|exists|save failed|invalid/i.test(error.message)
}

async function continueAfterAuth(
  navigate: ReturnType<typeof useNavigate>,
  nextPath: string | null
) {
  navigate(getSafeNextPath(nextPath) ?? "/editor")
}

async function requestRulelabPasswordReset(data: { email: string }) {
  try {
    await api.post("/auth/email/request-rulelab-password-reset", {
      json: data,
    })
  } catch (error) {
    throw handleApiError(error)
  }
}

async function resetRulelabPassword(data: { password: string; token: string }) {
  try {
    await api.post("/auth/email/reset-rulelab-password", {
      json: data,
    })
  } catch (error) {
    throw handleApiError(error)
  }
}

function getAuthLink(
  path: "/login" | "/signup",
  nextPath: string | null
) {
  const params = new URLSearchParams()
  if (nextPath) {
    params.set("next", nextPath)
  }

  const query = params.toString()
  return query ? `${path}?${query}` : path
}

function getSafeNextPath(value: string | null) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null
  }

  const path = trimmed.split(/[?#]/, 1)[0]
  if (path === "/editor" || path === "/profile" || path.startsWith("/profile/") || path === "/admin") {
    return trimmed
  }

  return null
}
