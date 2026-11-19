import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import type { LucideIcon } from "lucide-react"
import {
  CopyIcon,
  DatabaseIcon,
  FileCode2Icon,
  FlaskConicalIcon,
  KeyRoundIcon,
  Loader2Icon,
  Trash2Icon,
  UserCircleIcon,
} from "lucide-react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { logout } from "wasp/client/auth"
import {
  createApiKey,
  deleteAccount,
  getProfileData,
  listApiKeys,
  renameApiKey,
  revokeApiKey,
  updatePassword,
  useQuery,
} from "wasp/client/operations"

import { AppShell } from "../../components/AppShell"
import { AuthGate } from "../../components/AuthGate"
import { getPublicErrorMessage } from "../../lib/public-errors"
import { PASSWORD_POLICY_DESCRIPTION } from "../../lib/passwordPolicy"
import {
  ErrorState,
  PageSkeleton,
} from "../../components/layout"
import { Avatar, AvatarFallback } from "../../components/ui/avatar"
import { Alert, AlertDescription } from "../../components/ui/alert"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field"
import { EmptyState } from "../../components/ui/empty-state"
import { Input } from "../../components/ui/input"
import { ScrollArea } from "../../components/ui/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs"
import { formatLimit } from "../../domain/workspace"
import { cn } from "../../lib/utils"

type Profile = Awaited<ReturnType<typeof getProfileData>>
type ApiKeySummary = Awaited<ReturnType<typeof listApiKeys>>[number]

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
})

export function ProfilePage() {
  return (
    <AuthGate>
      <ProfileContent />
    </AuthGate>
  )
}

function ProfileContent() {
  const { data: profile, isLoading, error, refetch } = useQuery(getProfileData)
  const {
    data: apiKeys = [],
    error: apiKeysError,
    refetch: refetchApiKeys,
  } = useQuery(listApiKeys)
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = getProfileTabFromPath(location.pathname)

  useEffect(() => {
    const legacyTab = searchParams.get("tab")
    if (!legacyTab) {
      return
    }
    navigate(getProfileTabPath(getProfileTab(legacyTab)), { replace: true })
  }, [navigate, searchParams])

  return (
    <AppShell
      breadcrumb="Profile"
      compactHeader
      className="overflow-hidden"
      section="Workspace"
      title="Profile"
    >
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="@container/profile grid w-full gap-5 px-4 py-4 sm:px-6 lg:px-8">
          {error ? (
            <ErrorState message={getPublicErrorMessage(error)} onRetry={() => void refetch()} />
          ) : null}

          {isLoading ? (
            <PageSkeleton />
          ) : profile ? (
            <>
              <ProfileHeader profile={profile} />
              <Tabs
                className="flex min-w-0 flex-col gap-5"
                onValueChange={(value) => {
                  const nextTab = getProfileTab(value)
                  navigate(getProfileTabPath(nextTab))
                }}
                value={activeTab}
              >
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-2xl bg-sidebar p-1 shadow-sm sm:grid-cols-3 xl:w-fit">
                  <TabsTrigger value="overview" className="gap-2 rounded-xl">Overview</TabsTrigger>
                  <TabsTrigger value="api" className="gap-2 rounded-xl">API</TabsTrigger>
                  <TabsTrigger value="security" className="gap-2 rounded-xl">Security</TabsTrigger>
                </TabsList>
                <TabsContent className="mt-0 min-w-0 outline-none" value="overview">
                  <OverviewTab profile={profile} />
                </TabsContent>
                <TabsContent className="mt-0 min-w-0 outline-none" value="api">
                  <ApiKeysPanel
                    apiKeys={apiKeys as ApiKeySummary[]}
                    error={apiKeysError}
                    onChanged={() => void refetchApiKeys()}
                  />
                </TabsContent>
                <TabsContent className="mt-0 min-w-0 outline-none" value="security">
                  <SecurityTab email={profile.email} onDeleted={() => navigate("/")} />
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </div>
      </ScrollArea>
    </AppShell>
  )
}

function ProfileHeader({ profile }: { profile: Profile }) {
  const email = profile.email ?? "Signed in user"
  const totalSavedItems = profile.usage.rules + profile.usage.testCases + profile.usage.dataTables
  const accountLabel = profile.isAdmin ? "Administrator" : "Workspace account"

  return (
    <section className="overflow-hidden rounded-2xl border border-sidebar-border bg-sidebar shadow-sm">
      <div className="grid gap-5 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_34%),linear-gradient(135deg,hsl(var(--muted)/0.42),hsl(var(--card))_44%,hsl(var(--background)))] p-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.4fr)] lg:p-6">
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar className="size-16 shrink-0 rounded-2xl border border-sidebar-border shadow-sm" size="lg">
            <AvatarFallback className="rounded-2xl text-xl font-semibold">{getInitials(email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant={profile.isAdmin ? "default" : "secondary"} className="h-6 px-2">
                {accountLabel}
              </Badge>
            </div>
            <h1 className="mt-3 min-w-0 truncate text-2xl font-semibold tracking-normal sm:text-3xl" title={email}>
              {email}
            </h1>
          </div>
        </div>
        <div className="grid content-center gap-2 text-sm sm:grid-cols-3 lg:min-w-[24rem] lg:grid-cols-1 xl:grid-cols-3">
          <ProfileStat label="Saved items" value={formatLimit(totalSavedItems)} />
          <ProfileStat label="Joined" value={formatDate(profile.joinedAt)} />
        </div>
      </div>
    </section>
  )
}

function OverviewTab({ profile }: { profile: Profile }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,0.42fr)]">
      <Card className="border-sidebar-border bg-sidebar shadow-sm">
        <CardHeader>
          <CardTitle>Workspace Usage</CardTitle>
          <CardDescription>Saved resources in your workspace.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <UsageItem icon={FileCode2Icon} label="Saved rules" limit={profile.limits.rules} value={profile.usage.rules} />
          <UsageItem icon={FlaskConicalIcon} label="Test cases" limit={profile.limits.fixtures} value={profile.usage.testCases} />
          <UsageItem icon={DatabaseIcon} label="Data tables" limit={profile.limits.dataTables} value={profile.usage.dataTables} />
        </CardContent>
      </Card>

      <Card className="border-sidebar-border bg-sidebar shadow-sm">
        <CardHeader>
          <CardTitle>Resource Limits</CardTitle>
          <CardDescription>Quota details not shown in the account summary.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <InfoRow icon={FlaskConicalIcon} label="Events per test case" value={formatLimit(profile.limits.fixtureEventsPerSet)} />
          <InfoRow icon={FileCode2Icon} label="Rule slots" value={formatLimit(profile.limits.rules)} />
          <InfoRow icon={FlaskConicalIcon} label="Test case slots" value={formatLimit(profile.limits.fixtures)} />
          <InfoRow icon={DatabaseIcon} label="Data table slots" value={formatLimit(profile.limits.dataTables)} />
        </CardContent>
      </Card>
    </div>
  )
}

function ApiKeysPanel({
  apiKeys,
  error,
  onChanged,
}: {
  apiKeys: ApiKeySummary[]
  error: unknown
  onChanged: () => void
}) {
  return (
    <Card className="min-w-0 border-sidebar-border bg-sidebar shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between xl:flex-col">
          <div>
            <CardTitle>API Access</CardTitle>
            <CardDescription>
              Create and manage API keys for automation.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ApiKeyCreator
          onChanged={onChanged}
        />
        <ApiKeyList
          apiKeys={apiKeys}
          error={error}
          onChanged={onChanged}
        />
      </CardContent>
    </Card>
  )
}

function ApiKeyCreator({
  onChanged,
}: {
  onChanged: () => void
}) {
  const [keyName, setKeyName] = useState("RuleLab API key")
  const [createdKey, setCreatedKey] = useState<{ key: string; prefix: string } | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  async function handleCreateApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsCreating(true)
    try {
      const result = await createApiKey({ name: keyName })
      setCreatedKey({ key: result.key, prefix: result.prefix })
      setKeyName("RuleLab API key")
      toast.success("API key created.")
      onChanged()
    } catch (createError) {
      toast.error(getPublicErrorMessage(createError, "API access is currently unavailable."))
    } finally {
      setIsCreating(false)
    }
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success("Copied.")
    } catch {
      toast.error("Copy failed.")
    }
  }

  return (
    <form className="grid gap-4 rounded-xl border border-sidebar-border bg-sidebar-accent/20 p-4" onSubmit={handleCreateApiKey}>
      <Field>
        <FieldLabel htmlFor="api-key-name">Key name</FieldLabel>
        <Input
          id="api-key-name"
          maxLength={80}
          onChange={(event) => setKeyName(event.target.value)}
          placeholder="CI validation"
          value={keyName}
        />
        <FieldDescription>Use one key per script, CI job, or integration.</FieldDescription>
      </Field>
      <Button className="w-fit" disabled={isCreating} type="submit">
        {isCreating ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
        Create Key
      </Button>

      {createdKey ? (
        <div className="grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div>
            <div className="text-sm font-medium">Copy this key now</div>
            <p className="mt-1 text-sm text-muted-foreground">
              RuleLab stores only a hash, so this value cannot be shown again.
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate rounded-md bg-background px-3 py-2 text-sm"
              data-testid="created-api-key"
            >
              {createdKey.key}
            </code>
            <Button
              aria-label="Copy API key"
              onClick={() => void handleCopy(createdKey.key)}
              size="icon"
              type="button"
              variant="outline"
            >
              <CopyIcon />
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  )
}

function ApiKeyList({
  apiKeys,
  error,
  onChanged,
}: {
  apiKeys: ApiKeySummary[]
  error: unknown
  onChanged: () => void
}) {
  const [editedNames, setEditedNames] = useState<Record<string, string>>({})
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null)

  async function handleRename(key: ApiKeySummary) {
    const nextName = (editedNames[key.id] ?? key.name).trim()
    if (!nextName || nextName === key.name) {
      return
    }

    setPendingKeyId(key.id)
    try {
      await renameApiKey({ id: key.id, name: nextName })
      setEditedNames((current) => {
        const next = { ...current }
        delete next[key.id]
        return next
      })
      toast.success("API key renamed.")
      onChanged()
    } catch (renameError) {
      toast.error(getPublicErrorMessage(renameError))
    } finally {
      setPendingKeyId(null)
    }
  }

  async function handleRevoke(key: ApiKeySummary) {
    setPendingKeyId(key.id)
    try {
      await revokeApiKey({ id: key.id })
      toast.success("API key revoked.")
      onChanged()
    } catch (revokeError) {
      toast.error(getPublicErrorMessage(revokeError))
    } finally {
      setPendingKeyId(null)
    }
  }

  if (error) {
    return (
      <Alert variant="destructive" className="grid-cols-1">
        <AlertDescription>{getPublicErrorMessage(error)}</AlertDescription>
      </Alert>
    )
  }

  if (apiKeys.length === 0) {
    return (
      <EmptyState className="py-5" title="No API keys yet." />
    )
  }

  return (
    <div className="grid gap-3">
      {apiKeys.map((key) => {
        const isRevoked = Boolean(key.revokedAt)
        const editedName = editedNames[key.id] ?? key.name
        const hasNameChange = editedName.trim() !== key.name && editedName.trim().length > 0

        return (
          <div
            className="grid gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/20 p-3"
            data-testid="api-key-row"
            key={key.id}
          >
            <div className="grid min-w-0 gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Input
                  className="h-8 min-w-0"
                  disabled={isRevoked}
                  maxLength={80}
                  onChange={(event) =>
                    setEditedNames((current) => ({ ...current, [key.id]: event.target.value }))
                  }
                  title={editedName}
                  value={editedName}
                />
                {isRevoked ? <Badge variant="outline">Revoked</Badge> : null}
              </div>
              <div className="truncate font-mono text-xs text-muted-foreground" title={key.prefix}>{key.prefix}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isRevoked || !hasNameChange || pendingKeyId === key.id}
                onClick={() => void handleRename(key)}
                size="sm"
                type="button"
                variant="outline"
              >
                {pendingKeyId === key.id && hasNameChange ? <Loader2Icon className="animate-spin" /> : null}
                Save
              </Button>
              <Button
                disabled={isRevoked || pendingKeyId === key.id}
                onClick={() => void handleRevoke(key)}
                size="sm"
                type="button"
                variant="destructive"
              >
                {pendingKeyId === key.id && !hasNameChange ? <Loader2Icon className="animate-spin" /> : null}
                Revoke
              </Button>
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span>Created {formatDate(key.createdAt)}</span>
              <span>Last used {formatDate(key.lastUsedAt)}</span>
              <span>Expires {formatDate(key.expiresAt)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SecurityTab({
  email,
  onDeleted,
}: {
  email: string | null
  onDeleted: () => void
}) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState("")
  const [deletePassword, setDeletePassword] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const confirmationTarget = email ?? ""

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error("Passwords must match.")
      return
    }

    setIsSaving(true)
    try {
      await updatePassword({ currentPassword, newPassword })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      toast.success("Password updated.")
    } catch (error) {
      toast.error(getPublicErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!confirmationTarget || deleteConfirmation.trim().toLowerCase() !== confirmationTarget.toLowerCase()) {
      toast.error("Type your account email to confirm deletion.")
      return
    }

    setIsDeleting(true)
    try {
      await deleteAccount({
        confirmation: deleteConfirmation,
        currentPassword: deletePassword,
      })
      toast.success("Account deleted.")
      await logout()
      onDeleted()
    } catch (error) {
      toast.error(getPublicErrorMessage(error))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="border-sidebar-border bg-sidebar shadow-sm">
        <CardHeader>
          <CardTitle>Sign-in Password</CardTitle>
          <CardDescription>Update the password used for this account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="current-password">Current password</FieldLabel>
                <Input
                  autoComplete="current-password"
                  id="current-password"
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                  type="password"
                  value={currentPassword}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-password">New password</FieldLabel>
                <Input
                  autoComplete="new-password"
                  id="new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  type="password"
                  value={newPassword}
                />
                <FieldDescription>{PASSWORD_POLICY_DESCRIPTION}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
                <Input
                  autoComplete="new-password"
                  id="confirm-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  type="password"
                  value={confirmPassword}
                />
              </Field>
              <Button className="w-fit" disabled={isSaving} type="submit">
                {isSaving ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
                Update Password
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/30 bg-sidebar shadow-sm">
        <CardHeader>
          <CardTitle>Delete Account</CardTitle>
          <CardDescription>Delete the account, saved rules, test cases, data tables, and API keys.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleDeleteAccount}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="delete-confirmation">Type your email to confirm</FieldLabel>
                <Input
                  autoComplete="off"
                  id="delete-confirmation"
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  placeholder="Type your account email"
                  required
                  value={deleteConfirmation}
                />
                <FieldDescription>
                  This permanently removes your account data.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="delete-password">Current password</FieldLabel>
                <Input
                  autoComplete="current-password"
                  id="delete-password"
                  onChange={(event) => setDeletePassword(event.target.value)}
                  required
                  type="password"
                  value={deletePassword}
                />
              </Field>
              <Button
                className="w-fit"
                disabled={
                  isDeleting ||
                  !confirmationTarget ||
                  deleteConfirmation.trim().toLowerCase() !== confirmationTarget.toLowerCase()
                }
                type="submit"
                variant="destructive"
              >
                {isDeleting ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                Delete Account
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon?: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-sidebar-border bg-sidebar-accent/25 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-2 text-muted-foreground">
        {Icon ? <Icon className="size-4" /> : null}
        {label}
      </span>
      <span className="min-w-0 break-all font-medium">{value}</span>
    </div>
  )
}

function ProfileStat({
  label,
  tone = "default",
  value,
}: {
  label: string
  tone?: "default" | "primary"
  value: string
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-muted/20 px-3 py-2",
        tone === "primary" ? "border-primary/40 bg-primary/5" : undefined,
      )}
    >
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  )
}

function UsageItem({
  icon: Icon,
  label,
  limit,
  value,
}: {
  icon: typeof FileCode2Icon
  label: string
  limit: number
  value: number
}) {
  const percentage = limit > 0 ? Math.min(100, Math.round((value / limit) * 100)) : value > 0 ? 100 : 0
  const overLimit = value > limit

  return (
    <Card className={cn("border-sidebar-border bg-sidebar-accent/25 py-0", overLimit ? "border-destructive/50" : undefined)}>
      <CardContent className="grid gap-3 px-4 py-3 text-sm">
        <div className="flex min-w-0 items-center justify-between gap-4">
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <span className="truncate">{label}</span>
          </span>
          <span className="shrink-0 text-muted-foreground">
            {formatLimit(value)} / {formatLimit(limit)}
          </span>
        </div>
        {overLimit ? (
          <Badge className="w-fit" variant="destructive">
            Over limit
          </Badge>
        ) : null}
        <div className="h-2 overflow-hidden rounded-full bg-background">
          <div
            className={cn("h-full rounded-full", overLimit ? "bg-destructive" : "bg-primary")}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function getInitials(value: string) {
  const words = value.split(/[\s._-]+/).filter(Boolean)
  const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("")
  return initials || "DS"
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return "Not available"
  }
  return dateFormatter.format(new Date(value))
}

function getProfileTab(value: string | null | undefined) {
  if (value === "api" || value === "security") {
    return value
  }
  return "overview"
}

function getProfileTabFromPath(pathname: string) {
  if (pathname.endsWith("/api")) {
    return "api"
  }
  if (pathname.endsWith("/security")) {
    return "security"
  }
  return "overview"
}

function getProfileTabPath(tab: string) {
  if (tab === "api" || tab === "security") {
    return `/profile/${tab}`
  }
  return "/profile"
}
