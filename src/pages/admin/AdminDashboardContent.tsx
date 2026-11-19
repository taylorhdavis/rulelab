import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { FormEvent, ReactNode, SelectHTMLAttributes } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import {
  ArrowDownUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  DatabaseIcon,
  FileCode2Icon,
  FlaskConicalIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  PanelsTopLeftIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon,
  TrendingDownIcon,
  TrendingUpIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, Pie, PieChart, XAxis, YAxis } from "recharts"
import { toast } from "sonner"
import { logout, useAuth } from "wasp/client/auth"
import {
  createAdminUser,
  deleteAdminDataTable,
  deleteAdminSavedRule,
  deleteAdminUdmEventSet,
  deleteAdminUser,
  getAdminDashboardData,
  updateAdminAppSettings,
  updateAdminUser,
  useQuery,
} from "wasp/client/operations"

import { RuleLabMark } from "../../components/AppLogo"
import { PASSWORD_POLICY_DESCRIPTION, passwordMeetsPolicy } from "../../lib/passwordPolicy"
import { getPublicErrorMessage } from "../../lib/public-errors"
import { cn } from "../../lib/utils"
import type {
  AdminApiKeySummary,
  AdminDataTableSummary,
  AdminDashboardData,
  AdminSavedRuleSummary,
  AdminUdmEventSetSummary,
  AdminUserSummary,
} from "../../server/adminDashboard"
import type { AppSettings } from "../../server/appSettings"
import { Alert, AlertDescription } from "../../components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar"
import { Badge } from "../../components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../components/ui/breadcrumb"
import { Button } from "../../components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "../../components/ui/chart"
import { Checkbox } from "../../components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu"
import { Input } from "../../components/ui/input"
import { LoadingIndicator } from "../../components/ui/loading-indicator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "../../components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table"

type UserDraft = {
  isAdmin: boolean
}

type NewUserDraft = {
  isAdmin: boolean
  password: string
  username: string
}

type PendingDelete = {
  id: string
  kind: "fixture" | "rule" | "table" | "user"
  name: string
}

type PendingPreview =
  | { kind: "fixture"; record: AdminUdmEventSetSummary }
  | { kind: "rule"; record: AdminSavedRuleSummary }
  | { kind: "table"; record: AdminDataTableSummary }

const EMPTY_VALUE = "none"
const ADMIN_TABS = new Set(["overview", "users", "rules", "fixtures", "tables", "apiKeys", "settings"])

const DASHBOARD_QUERY_OPTIONS = {
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: 1,
  staleTime: 20_000,
} as const

const activityChartConfig = {
  assets: { color: "hsl(var(--chart-2))", label: "Assets" },
  signups: { color: "hsl(var(--primary))", label: "Signups" },
  users: { color: "hsl(var(--chart-3))", label: "Users" },
} satisfies ChartConfig

const assetChartConfig = {
  rules: { color: "hsl(var(--chart-1))", label: "Rules" },
  tests: { color: "hsl(var(--chart-2))", label: "Test cases" },
  tables: { color: "hsl(var(--chart-3))", label: "Data tables" },
} satisfies ChartConfig

const apiChartConfig = {
  active: { color: "hsl(var(--primary))", label: "Active keys" },
  inactive: { color: "hsl(var(--chart-4))", label: "Inactive keys" },
} satisfies ChartConfig

export function AdminDashboardContent() {
  const location = useLocation()
  const {
    data,
    error,
    isFetching,
    refetch,
  } = useQuery(getAdminDashboardData, undefined, DASHBOARD_QUERY_OPTIONS)
  const dashboard = data as AdminDashboardData | undefined
  const [activeTab, setActiveTab] = useState(getAdminTabFromHash(location.hash))
  const [searchQuery, setSearchQuery] = useState("")
  const [userDrafts, setUserDrafts] = useState<Record<string, UserDraft>>({})
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [newUserDraft, setNewUserDraft] = useState<NewUserDraft>(() => createEmptyNewUserDraft())
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null)
  const stats = dashboard?.stats
  const totalAssets = (stats?.savedRuleCount ?? 0) + (stats?.udmEventSetCount ?? 0) + (stats?.dataTableCount ?? 0)
  const pageMeta = getAdminPageMeta(activeTab)

  useEffect(() => {
    setActiveTab(getAdminTabFromHash(location.hash))
  }, [location.hash])

  useEffect(() => {
    setSearchQuery("")
  }, [activeTab])

  useEffect(() => {
    if (!dashboard) {
      return
    }
    setSettingsDraft(dashboard.settings)
    setUserDrafts((current) => {
      const next = { ...current }
      for (const user of dashboard.users) {
        if (!next[user.id]) {
          next[user.id] = toUserDraft(user)
        }
      }
      return next
    })
  }, [dashboard])

  async function refreshDashboard() {
    await refetch()
  }

  async function saveSettings() {
    if (!settingsDraft) {
      return
    }
    setIsSavingSettings(true)
    try {
      await updateAdminAppSettings(settingsDraft)
      toast.success("Updated app settings.")
      await refreshDashboard()
    } catch (settingsError) {
      toast.error(getPublicErrorMessage(settingsError, "Could not update app settings."))
    } finally {
      setIsSavingSettings(false)
    }
  }

  async function saveUser(user: AdminUserSummary) {
    const draft = userDrafts[user.id] ?? toUserDraft(user)
    setSavingUserId(user.id)
    try {
      await updateAdminUser({
        isAdmin: draft.isAdmin,
        userId: user.id,
      })
      toast.success(`Updated ${user.username}.`)
      await refreshDashboard()
    } catch (saveError) {
      toast.error(getPublicErrorMessage(saveError, "Could not update user."))
    } finally {
      setSavingUserId(null)
    }
  }

  async function createUser() {
    try {
      const created = await createAdminUser({
        isAdmin: newUserDraft.isAdmin,
        password: newUserDraft.password,
        username: newUserDraft.username,
      })
      toast.success(`Created ${created.username}.`)
      setNewUserDraft(createEmptyNewUserDraft())
      await refreshDashboard()
    } catch (createError) {
      toast.error(getPublicErrorMessage(createError, "Could not create user."))
    }
  }

  async function deleteRecord(record: PendingDelete) {
    try {
      if (record.kind === "user") {
        await deleteAdminUser({ id: record.id })
      } else if (record.kind === "rule") {
        await deleteAdminSavedRule({ id: record.id })
      } else if (record.kind === "fixture") {
        await deleteAdminUdmEventSet({ id: record.id })
      } else {
        await deleteAdminDataTable({ id: record.id })
      }
      toast.success(`Deleted ${record.name}.`)
      setPendingDelete(null)
      await refreshDashboard()
    } catch (deleteError) {
      toast.error(getPublicErrorMessage(deleteError, "Could not delete item."))
    }
  }

  function renderSection() {
    if (activeTab === "users") {
      return (
        <UsersFeature
          drafts={userDrafts}
          isLoading={!dashboard && !error}
          newUserDraft={newUserDraft}
          onCreate={createUser}
          onDelete={(user) => deleteRecord({ id: user.id, kind: "user", name: user.username })}
          onDraftChange={(userId, patch) =>
            setUserDrafts((current) => ({
              ...current,
              [userId]: { ...(current[userId] ?? createFallbackUserDraft()), ...patch },
            }))
          }
          onNewUserDraftChange={(patch) => setNewUserDraft((current) => ({ ...current, ...patch }))}
          onSave={saveUser}
          onSearch={setSearchQuery}
          savingUserId={savingUserId}
          searchQuery={searchQuery}
          users={dashboard?.users ?? []}
        />
      )
    }
    if (activeTab === "rules") {
      return (
        <RulesTable
          isLoading={!dashboard && !error}
          onDelete={(rule) => setPendingDelete({ id: rule.id, kind: "rule", name: rule.name })}
          onPreview={(rule) => setPendingPreview({ kind: "rule", record: rule })}
          onSearch={setSearchQuery}
          rules={dashboard?.savedRules ?? []}
          searchQuery={searchQuery}
        />
      )
    }
    if (activeTab === "fixtures") {
      return (
        <FixturesTable
          fixtures={dashboard?.udmEventSets ?? []}
          isLoading={!dashboard && !error}
          onDelete={(fixture) => setPendingDelete({ id: fixture.id, kind: "fixture", name: fixture.name })}
          onPreview={(fixture) => setPendingPreview({ kind: "fixture", record: fixture })}
          onSearch={setSearchQuery}
          searchQuery={searchQuery}
        />
      )
    }
    if (activeTab === "tables") {
      return (
        <DataTablesTable
          dataTables={dashboard?.dataTables ?? []}
          isLoading={!dashboard && !error}
          onDelete={(table) => setPendingDelete({ id: table.id, kind: "table", name: table.name })}
          onPreview={(table) => setPendingPreview({ kind: "table", record: table })}
          onSearch={setSearchQuery}
          searchQuery={searchQuery}
        />
      )
    }
    if (activeTab === "apiKeys") {
      return (
        <ApiKeysTable
          apiKeys={dashboard?.apiKeys ?? []}
          isLoading={!dashboard && !error}
          onSearch={setSearchQuery}
          searchQuery={searchQuery}
          users={dashboard?.users ?? []}
        />
      )
    }
    if (activeTab === "settings") {
      return (
        <SettingsPanel
          isLoading={!dashboard && !error}
          isSaving={isSavingSettings}
          onChange={(patch) => setSettingsDraft((current) => current ? { ...current, ...patch } : current)}
          onSave={saveSettings}
          settings={settingsDraft}
        />
      )
    }
    return <DashboardOverview dashboard={dashboard} totalAssets={totalAssets} />
  }

  return (
    <AdminShell activeTab={activeTab} onTabChange={setActiveTab}>
      <Main fixed={false} fluid className="flex flex-1 flex-col gap-4 sm:gap-6">
        {error ? <AdminError message={getPublicErrorMessage(error)} /> : null}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight">{pageMeta.title}</h2>
            {pageMeta.description ? <p className="text-muted-foreground">{pageMeta.description}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeTab !== "overview" ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void refreshDashboard()} disabled={isFetching}>
                {isFetching ? <LoadingIndicator markClassName="size-4" /> : <RefreshCwIcon className="size-4" />}
                Refresh
              </Button>
            ) : null}
          </div>
        </div>
        {renderSection()}
      </Main>

      <PlainConfirmDialog
        confirmLabel="Delete"
        description={pendingDelete ? `This permanently deletes ${pendingDelete.name}. This cannot be undone.` : ""}
        isDestructive
        isOpen={Boolean(pendingDelete)}
        onConfirm={() => {
          if (pendingDelete) {
            void deleteRecord(pendingDelete)
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null)
          }
        }}
        title="Delete item?"
      />
      <AdminAssetPreviewDialog
        preview={pendingPreview}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPreview(null)
          }
        }}
      />
    </AdminShell>
  )
}

function AdminShell({
  activeTab,
  children,
  onTabChange,
}: {
  activeTab: string
  children: ReactNode
  onTabChange: (tab: string) => void
}) {
  const pageMeta = getAdminPageMeta(activeTab)

  return (
    <SidebarProvider defaultOpen>
      <AdminSidebar activeTab={activeTab} onTabChange={onTabChange} />
      <SidebarInset className="@container/content h-svh overflow-hidden">
        <Header fixed breadcrumb={pageMeta.title} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}

function Header({
  breadcrumb,
  className,
  fixed,
}: {
  breadcrumb: string
  className?: string
  fixed?: boolean
}) {
  return (
    <header
      className={cn(
        "z-50 flex h-16 w-full shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear",
        fixed ? "sticky top-0 bg-background/95 shadow-none backdrop-blur" : null,
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-4">
        <SidebarTrigger className="md:hidden" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink asChild>
                <Link to="/admin">Admin</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>{breadcrumb}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-4">
        <Button asChild size="sm" variant="ghost" className="gap-1.5 px-2 sm:px-3">
          <Link to="/editor">
            <PanelsTopLeftIcon className="size-4" />
            <span className="hidden sm:inline">Return to app</span>
          </Link>
        </Button>
        <AdminProfileDropdown />
      </div>
    </header>
  )
}

function Main({
  className,
  fixed,
  fluid,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  fixed?: boolean
  fluid?: boolean
}) {
  return (
    <div
      data-layout={fixed ? "fixed" : "auto"}
      className={cn(
        "min-h-0 overflow-auto px-4 py-6",
        fixed ? "flex grow flex-col" : null,
        !fluid ? "@7xl/content:mx-auto @7xl/content:w-full @7xl/content:max-w-7xl" : null,
        className
      )}
      {...props}
    />
  )
}

function AdminSidebar({
  activeTab,
  onTabChange,
}: {
  activeTab: string
  onTabChange: (tab: string) => void
}) {
  const groups = [
    {
      items: [
        { icon: LayoutDashboardIcon, tab: "overview", title: "Dashboard" },
        { icon: UsersIcon, tab: "users", title: "Users" },
      ],
      title: "General",
    },
    {
      items: [
        { icon: FileCode2Icon, tab: "rules", title: "Saved Rules" },
        { icon: FlaskConicalIcon, tab: "fixtures", title: "Test Cases" },
        { icon: DatabaseIcon, tab: "tables", title: "Data Tables" },
      ],
      title: "Workspace",
    },
    {
      items: [
        { icon: KeyRoundIcon, tab: "apiKeys", title: "API Keys" },
        { icon: Settings2Icon, tab: "settings", title: "Settings" },
      ],
      title: "System",
    },
  ]

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent hover:text-sidebar-foreground">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
                <RuleLabMark className="size-8" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">RuleLab</span>
                <span className="truncate text-xs">Admin Dashboard</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.tab}>
                  <SidebarMenuButton
                    isActive={activeTab === item.tab}
                    tooltip={item.title}
                    onClick={() => {
                      onTabChange(item.tab)
                      window.location.hash = item.tab === "overview" ? "" : item.tab
                    }}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  )
}

function AdminProfileDropdown() {
  const navigate = useNavigate()
  const { data: user } = useAuth()
  const email = getUserEmail(user)
  const fallback = (email || "RL").slice(0, 2).toUpperCase()
  const [isOpen, setIsOpen] = useState(false)

  async function handleLogout() {
    await logout()
    navigate("/login")
  }

  return (
    <div className="relative">
      <Button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={email || "Open profile menu"}
        type="button"
        variant="ghost"
        className="relative h-8 w-8 rounded-full"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Avatar className="h-8 w-8">
          <AvatarImage src="" alt={email} />
          <AvatarFallback>{fallback}</AvatarFallback>
        </Avatar>
      </Button>
      {isOpen ? (
        <>
          <button className="fixed inset-0 z-40 bg-transparent" type="button" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-56 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <div className="px-1.5 py-1">
              <p className="text-sm font-medium leading-none">{email || "RuleLab Admin"}</p>
              <p className="mt-1 text-xs leading-none text-muted-foreground">Administrator</p>
            </div>
            <div className="-mx-1 my-1 h-px bg-border" />
            <MenuButton onClick={() => navigate("/editor")}>Back to app</MenuButton>
            <MenuButton onClick={() => navigate("/profile")}>Profile</MenuButton>
            <MenuButton onClick={() => void handleLogout()} destructive>Log out</MenuButton>
          </div>
        </>
      ) : null}
    </div>
  )
}

function DashboardOverview({
  dashboard,
  totalAssets,
}: {
  dashboard: AdminDashboardData | undefined
  totalAssets: number
}) {
  const users = dashboard?.users ?? []

  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <div className="w-full overflow-x-auto pb-1">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="overview" className="space-y-4">
        <DashboardStats dashboard={dashboard} totalAssets={totalAssets} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-7">
          <ActivityChart dashboard={dashboard} />
          <RecentUsersCard users={users} />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-7">
          <AssetBreakdownChart dashboard={dashboard} />
        </div>
      </TabsContent>
      <TabsContent value="analytics" className="space-y-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-7">
          <ApiFootprintChart users={users} />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-7">
          <WorkspaceLeadersCard users={users} />
          <OperationalSnapshotCard dashboard={dashboard} />
        </div>
      </TabsContent>
    </Tabs>
  )
}

function DashboardStats({
  dashboard,
  totalAssets,
}: {
  dashboard: AdminDashboardData | undefined
  totalAssets: number
}) {
  const stats = dashboard?.stats
  const cards = [
    {
      description: "Accounts under management",
      icon: UsersIcon,
      label: "Total Users",
      note: `${stats?.adminCount ?? 0} admins`,
      trend: `${Math.round(getRatio(stats?.adminCount ?? 0, stats?.userCount ?? 0))}% admin coverage`,
      value: stats?.userCount ?? 0,
    },
    {
      description: "Recent account creation",
      icon: TrendingUpIcon,
      label: "New Signups",
      note: `${stats?.newSignups30d ?? 0} this month`,
      trend: `${stats?.newSignups7d ?? 0} in 7 days`,
      value: stats?.newSignups7d ?? 0,
    },
    {
      description: "Rules, tests, and tables",
      icon: DatabaseIcon,
      label: "Stored Assets",
      note: "Workspace inventory",
      trend: `${stats?.savedRuleCount ?? 0} rules`,
      value: totalAssets,
    },
    {
      description: "Public API credentials",
      icon: KeyRoundIcon,
      label: "API Keys",
      note: `${stats?.activeApiKeyCount ?? 0} active`,
      trend: `${stats?.apiRateLimitBucketCount ?? 0} rate-limit windows`,
      value: stats?.apiKeyCount ?? 0,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="grid grid-cols-[1fr_auto] items-start space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
            <CardAction>
              <card.icon className="size-4 text-muted-foreground" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">{card.note}</p>
          </CardContent>
          <CardFooter className="flex-col items-start gap-2 text-xs text-muted-foreground">
            <span>{card.description}</span>
            <Badge variant="secondary" className="gap-1 rounded-md px-1.5 font-normal">
              <ArrowDownUpIcon className="size-3" />
              {card.trend}
            </Badge>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}

function ActivityChart({ dashboard }: { dashboard: AdminDashboardData | undefined }) {
  const data = buildAdminDailyChartData(dashboard)

  return (
    <Card className="col-span-1 xl:col-span-4">
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Signups, user total, and workspace assets over the last 90 days.</CardDescription>
      </CardHeader>
      <CardContent className="ps-2">
        <ChartContainer config={activityChartConfig} className="aspect-auto h-[320px] w-full">
          <ComposedChart data={data}>
            <defs>
              <linearGradient id="fillSignups" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-signups)" stopOpacity={0.9} />
                <stop offset="95%" stopColor="var(--color-signups)" stopOpacity={0.08} />
              </linearGradient>
              <linearGradient id="fillAssets" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-assets)" stopOpacity={0.7} />
                <stop offset="95%" stopColor="var(--color-assets)" stopOpacity={0.06} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={formatChartDate} />
            <YAxis hide />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Area dataKey="assets" type="natural" fill="url(#fillAssets)" stroke="var(--color-assets)" strokeWidth={2} />
            <Area dataKey="signups" type="natural" fill="url(#fillSignups)" stroke="var(--color-signups)" strokeWidth={2} />
            <Line dataKey="users" type="monotone" stroke="var(--color-users)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function RecentUsersCard({ users }: { users: AdminUserSummary[] }) {
  const recentUsers = [...users]
    .sort((first, second) => getTime(second.createdAt) - getTime(first.createdAt))
    .slice(0, 5)

  return (
    <Card className="col-span-1 lg:col-span-3">
      <CardHeader>
        <CardTitle>Recent Users</CardTitle>
        <CardDescription>{recentUsers.length.toLocaleString()} latest accounts in RuleLab.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {recentUsers.length > 0 ? (
            recentUsers.map((user) => (
              <div key={user.id} className="flex items-center gap-4">
                <Avatar className="h-9 w-9">
                  <AvatarImage src="" alt={user.username} />
                  <AvatarFallback>{(user.username || "RL").slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium leading-none">{user.username}</p>
                    <p className="truncate text-sm text-muted-foreground">{user.isAdmin ? "Admin" : "User"} · {formatDate(user.createdAt)}</p>
                  </div>
                  <div className="font-medium tabular-nums">{getUserAssetCount(user).toLocaleString()} assets</div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">No users yet.</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AssetBreakdownChart({ dashboard }: { dashboard: AdminDashboardData | undefined }) {
  const stats = dashboard?.stats
  const data = [
    {
      label: "Assets",
      rules: stats?.savedRuleCount ?? 0,
      tables: stats?.dataTableCount ?? 0,
      tests: stats?.udmEventSetCount ?? 0,
    },
  ]

  return (
    <Card className="col-span-1 xl:col-span-4">
      <CardHeader>
        <CardTitle>Stored Assets</CardTitle>
        <CardDescription>Saved rule-authoring records across the workspace.</CardDescription>
      </CardHeader>
      <CardContent className="ps-2">
        <ChartContainer config={assetChartConfig} className="aspect-auto h-[260px] w-full">
          <BarChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis hide />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="rules" fill="var(--color-rules)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="tests" fill="var(--color-tests)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="tables" fill="var(--color-tables)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function ApiFootprintChart({ users }: { users: AdminUserSummary[] }) {
  const data = getApiKeyBreakdown(users)

  return (
    <Card className="col-span-1 xl:col-span-4">
      <CardHeader>
        <CardTitle>API Footprint</CardTitle>
        <CardDescription>Active and inactive API keys by user role.</CardDescription>
      </CardHeader>
      <CardContent className="ps-2">
        <ChartContainer config={apiChartConfig} className="aspect-auto h-[300px] w-full">
          <BarChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="role" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis hide />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="active" stackId="keys" fill="var(--color-active)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="inactive" stackId="keys" fill="var(--color-inactive)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function WorkspaceLeadersCard({ users }: { users: AdminUserSummary[] }) {
  const leaders = [...users]
    .sort((first, second) => getUserAssetCount(second) - getUserAssetCount(first))
    .slice(0, 6)

  return (
    <Card className="col-span-1 xl:col-span-4">
      <CardHeader>
        <CardTitle>Workspace Leaders</CardTitle>
        <CardDescription>Accounts with the most saved rules, test cases, and tables.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {leaders.length > 0 ? leaders.map((user) => (
          <div key={user.id} className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="truncate font-medium">{user.username}</div>
              <div className="text-xs text-muted-foreground">
                {user.savedRuleCount} rules · {user.udmEventSetCount} test cases · {user.dataTableCount} tables
              </div>
            </div>
            <Badge variant="secondary" className="w-fit gap-1">
              <DatabaseIcon className="size-3" />
              {getUserAssetCount(user).toLocaleString()} assets
            </Badge>
          </div>
        )) : (
          <div className="py-8 text-center text-sm text-muted-foreground">No workspace assets yet.</div>
        )}
      </CardContent>
    </Card>
  )
}

function OperationalSnapshotCard({ dashboard }: { dashboard: AdminDashboardData | undefined }) {
  const settings = dashboard?.settings
  const stats = dashboard?.stats
  const rows = [
    { icon: UsersIcon, label: "New signups", value: settings?.signupsEnabled ? "Enabled" : "Disabled" },
    { icon: KeyRoundIcon, label: "API access", value: settings?.apiAccessEnabled ? "Enabled" : "Disabled" },
  ]

  return (
    <Card className="col-span-1 xl:col-span-3">
      <CardHeader>
        <CardTitle>Operational Snapshot</CardTitle>
        <CardDescription>Current product switches and growth signals.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <row.icon className="size-4 text-muted-foreground" />
              <span className="truncate text-sm">{row.label}</span>
            </div>
            <Badge variant={row.value === "Enabled" ? "default" : "secondary"}>{row.value}</Badge>
          </div>
        ))}
      </CardContent>
      <CardFooter className="gap-2 text-xs text-muted-foreground">
        {(stats?.newSignups30d ?? 0) >= (stats?.newSignups7d ?? 0) ? <TrendingUpIcon className="size-4" /> : <TrendingDownIcon className="size-4" />}
        {(stats?.newSignups30d ?? 0).toLocaleString()} signups in the last 30 days.
      </CardFooter>
    </Card>
  )
}

type UsersDialogType = "add" | "delete" | "edit"

type UsersContextType = {
  currentRow: AdminUserSummary | null
  open: UsersDialogType | null
  setCurrentRow: (user: AdminUserSummary | null) => void
  setOpen: (open: UsersDialogType | null) => void
}

const UsersContext = createContext<UsersContextType | null>(null)

function UsersProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<UsersDialogType | null>(null)
  const [currentRow, setCurrentRow] = useState<AdminUserSummary | null>(null)

  return (
    <UsersContext.Provider value={{ currentRow, open, setCurrentRow, setOpen }}>
      {children}
    </UsersContext.Provider>
  )
}

function useUsers() {
  const context = useContext(UsersContext)
  if (!context) {
    throw new Error("useUsers has to be used within <UsersProvider>")
  }
  return context
}

type SectionStat = {
  detail: string
  icon: LucideIcon
  label: string
  value: number | string
}

function SectionStatsGrid({ stats }: { stats: SectionStat[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
              <p className="mt-2 truncate text-2xl font-bold tabular-nums">
                {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{stat.detail}</p>
            </div>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <stat.icon className="size-4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function UsersFeature({
  drafts,
  isLoading,
  newUserDraft,
  onCreate,
  onDelete,
  onDraftChange,
  onNewUserDraftChange,
  onSave,
  onSearch,
  savingUserId,
  searchQuery,
  users,
}: {
  drafts: Record<string, UserDraft>
  isLoading: boolean
  newUserDraft: NewUserDraft
  onCreate: () => Promise<void>
  onDelete: (user: AdminUserSummary) => Promise<void>
  onDraftChange: (userId: string, patch: Partial<UserDraft>) => void
  onNewUserDraftChange: (patch: Partial<NewUserDraft>) => void
  onSave: (user: AdminUserSummary) => Promise<void>
  onSearch: (query: string) => void
  savingUserId: string | null
  searchQuery: string
  users: AdminUserSummary[]
}) {
  const userStats = getUserSectionStats(users)

  return (
    <UsersProvider>
      <div className="grid gap-4">
        <SectionStatsGrid stats={userStats} />
        <UsersTable isLoading={isLoading} onSearch={onSearch} searchQuery={searchQuery} users={users} />
      </div>
      <UsersDialogs
        drafts={drafts}
        newUserDraft={newUserDraft}
        onCreate={onCreate}
        onDelete={onDelete}
        onDraftChange={onDraftChange}
        onNewUserDraftChange={onNewUserDraftChange}
        onSave={onSave}
        savingUserId={savingUserId}
      />
    </UsersProvider>
  )
}

function UsersPrimaryButtons() {
  const { setOpen } = useUsers()

  return (
    <div className="flex gap-2">
      <Button type="button" className="space-x-1" onClick={() => setOpen("add")}>
        <span>Add User</span>
        <UserPlusIcon className="size-[18px]" />
      </Button>
    </div>
  )
}

function UsersDialogs({
  drafts,
  newUserDraft,
  onCreate,
  onDelete,
  onDraftChange,
  onNewUserDraftChange,
  onSave,
  savingUserId,
}: {
  drafts: Record<string, UserDraft>
  newUserDraft: NewUserDraft
  onCreate: () => Promise<void>
  onDelete: (user: AdminUserSummary) => Promise<void>
  onDraftChange: (userId: string, patch: Partial<UserDraft>) => void
  onNewUserDraftChange: (patch: Partial<NewUserDraft>) => void
  onSave: (user: AdminUserSummary) => Promise<void>
  savingUserId: string | null
}) {
  const { currentRow, open, setCurrentRow, setOpen } = useUsers()

  return (
    <>
      <CreateUserDialog
        draft={newUserDraft}
        open={open === "add"}
        onChange={onNewUserDraftChange}
        onCreate={async () => {
          await onCreate()
          setOpen(null)
        }}
        onOpenChange={(nextOpen) => setOpen(nextOpen ? "add" : null)}
      />

      {currentRow ? (
        <UserEditDialog
          key={`user-edit-${currentRow.id}`}
          draft={drafts[currentRow.id] ?? toUserDraft(currentRow)}
          isSaving={savingUserId === currentRow.id}
          open={open === "edit"}
          onDraftChange={(patch) => onDraftChange(currentRow.id, patch)}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen ? "edit" : null)
            if (!nextOpen) {
              setCurrentRow(null)
            }
          }}
          onSave={async () => {
            await onSave(currentRow)
            setOpen(null)
            setCurrentRow(null)
          }}
          user={currentRow}
        />
      ) : null}

      {currentRow ? (
        <PlainConfirmDialog
          confirmLabel="Delete"
          description={`Are you sure you want to delete ${currentRow.username}? This cannot be undone.`}
          isDestructive
          isOpen={open === "delete"}
          onConfirm={() => {
            void onDelete(currentRow)
            setOpen(null)
            setCurrentRow(null)
          }}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen ? "delete" : null)
            if (!nextOpen) {
              setCurrentRow(null)
            }
          }}
          title="Delete User"
        />
      ) : null}
    </>
  )
}

function UsersTable({
  isLoading,
  onSearch,
  searchQuery,
  users,
}: {
  isLoading: boolean
  onSearch: (query: string) => void
  searchQuery: string
  users: AdminUserSummary[]
}) {
  const { setCurrentRow, setOpen } = useUsers()
  const filteredUsers = useMemo(
    () =>
      users.filter((user) =>
        matchesSearch(searchQuery, [
          user.id,
          user.username,
          user.isAdmin ? "admin" : "user",
          `${user.apiKeyCount} api keys`,
          `${user.activeApiKeyCount} active api keys`,
          user.lastActiveAt ? formatDate(user.lastActiveAt) : "never active",
          user.lastLoginAt ? formatDate(user.lastLoginAt) : "never logged in",
        ])
      ),
    [searchQuery, users],
  )

  return (
    <PlainDataTable
      columns={[
        { className: "min-w-[13rem]", key: "email", label: "Email" },
        { className: "w-24", key: "role", label: "Role" },
        { className: "hidden lg:table-cell", key: "assets", label: "Assets" },
        { className: "hidden xl:table-cell", key: "api", label: "API Keys" },
        { className: "hidden xl:table-cell", key: "lastActive", label: "Last Active" },
        { className: "hidden lg:table-cell", key: "joined", label: "Joined" },
        { className: "w-14 min-w-14", key: "actions", label: "" },
      ]}
      data={filteredUsers}
      getRowId={(user) => user.id}
      isLoading={isLoading}
      onSearch={onSearch}
      renderRow={(user) => (
        <>
          <TableCell className="max-w-[16rem] whitespace-normal">
            <NameCell id={user.id} name={user.username} />
          </TableCell>
          <TableCell>
            <Badge variant={user.isAdmin ? "default" : "outline"}>{user.isAdmin ? "Admin" : "User"}</Badge>
          </TableCell>
          <TableCell className="hidden lg:table-cell">{getUserAssetCount(user).toLocaleString()}</TableCell>
          <TableCell className="hidden xl:table-cell">{user.activeApiKeyCount} active / {user.apiKeyCount} total</TableCell>
          <TableCell className="hidden text-muted-foreground xl:table-cell">
            {user.lastActiveAt ? formatDate(user.lastActiveAt) : "Never"}
          </TableCell>
          <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(user.createdAt)}</TableCell>
          <TableCell className="w-14 min-w-14 text-right">
            <PlainRowActions
              onDelete={() => {
                setCurrentRow(user)
                setOpen("delete")
              }}
              onEdit={() => {
                setCurrentRow(user)
                setOpen("edit")
              }}
            />
          </TableCell>
        </>
      )}
      searchPlaceholder="Filter users..."
      searchQuery={searchQuery}
      toolbarAction={<UsersPrimaryButtons />}
    />
  )
}

function CreateUserDialog({
  draft,
  onChange,
  onCreate,
  onOpenChange,
  open,
}: {
  draft: NewUserDraft
  onChange: (patch: Partial<NewUserDraft>) => void
  onCreate: () => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const canCreate = draft.username.trim().length > 0 && passwordMeetsPolicy(draft.password)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canCreate) {
      await onCreate()
    }
  }

  return (
    <PlainModal
      contentClassName="sm:w-[min(42rem,calc(100vw-2rem))] sm:max-w-2xl"
      description="Add a user and choose their initial access."
      isOpen={open}
      onOpenChange={onOpenChange}
      title="Add User"
    >
      <div className="h-105 w-[calc(100%+0.75rem)] overflow-y-auto py-1 pe-3">
        <form id="user-create-form" className="space-y-4 px-0.5" onSubmit={handleSubmit}>
          <DialogField label="Email">
            <Input
              autoComplete="off"
              className="col-span-4"
              onChange={(event) => onChange({ username: event.target.value })}
              placeholder="analyst@example.com"
              type="email"
              value={draft.username}
            />
          </DialogField>
          <DialogField label="Password">
            <Input
              autoComplete="new-password"
              className="col-span-4"
              onChange={(event) => onChange({ password: event.target.value })}
              placeholder="Create a password"
              type="password"
              value={draft.password}
            />
            <span className="col-start-3 col-span-4 text-xs text-muted-foreground">
              {PASSWORD_POLICY_DESCRIPTION}
            </span>
          </DialogField>
          <DialogField label="Role">
            <NativeSelect
              aria-label="Role"
              className="col-span-4"
              value={draft.isAdmin ? "admin" : "user"}
              onChange={(event) => onChange({ isAdmin: event.currentTarget.value === "admin" })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </NativeSelect>
          </DialogField>
        </form>
      </div>
      <DialogActions>
        <Button type="submit" form="user-create-form" disabled={!canCreate}>
          Create user
        </Button>
      </DialogActions>
    </PlainModal>
  )
}

function UserEditDialog({
  draft,
  isSaving,
  onDraftChange,
  onOpenChange,
  onSave,
  open,
  user,
}: {
  draft: UserDraft
  isSaving: boolean
  onDraftChange: (patch: Partial<UserDraft>) => void
  onOpenChange: (open: boolean) => void
  onSave: () => Promise<void>
  open: boolean
  user: AdminUserSummary
}) {

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onSave()
  }

  return (
    <PlainModal
      contentClassName="sm:w-[min(42rem,calc(100vw-2rem))] sm:max-w-2xl"
      description="Update the user here. Click save when you're done."
      isOpen={open}
      onOpenChange={onOpenChange}
      title="Edit User"
    >
      <div className="h-105 w-[calc(100%+0.75rem)] overflow-y-auto py-1 pe-3">
        <form id="user-form" className="space-y-4 px-0.5" onSubmit={handleSubmit}>
          <DialogField label="Email">
            <Input className="col-span-4" readOnly value={user.username || "Unknown user"} />
          </DialogField>
          <DialogField label="User ID">
            <Input className="col-span-4" readOnly value={user.id || "Unknown ID"} />
          </DialogField>
          <DialogField label="Role">
            <NativeSelect
              aria-label="Role"
              className="col-span-4"
              value={draft.isAdmin ? "admin" : "user"}
              onChange={(event) => onDraftChange({ isAdmin: event.currentTarget.value === "admin" })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </NativeSelect>
          </DialogField>
          <DialogField label="Created">
            <Input className="col-span-4" readOnly value={formatDate(user.createdAt)} />
          </DialogField>
          <DialogField label="Last login">
            <Input className="col-span-4" readOnly value={user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"} />
          </DialogField>
          <DialogField label="API keys">
            <Input className="col-span-4" readOnly value={`${toNumberInputValue(user.activeApiKeyCount)} active / ${toNumberInputValue(user.apiKeyCount)} total`} />
          </DialogField>
        </form>
      </div>
      <DialogActions>
        <Button type="submit" form="user-form" disabled={isSaving}>
          {isSaving ? "Saving" : "Save changes"}
        </Button>
      </DialogActions>
    </PlainModal>
  )
}

function RulesTable({
  isLoading,
  onDelete,
  onPreview,
  onSearch,
  rules,
  searchQuery,
}: {
  isLoading: boolean
  onDelete: (rule: AdminSavedRuleSummary) => void
  onPreview: (rule: AdminSavedRuleSummary) => void
  onSearch: (query: string) => void
  rules: AdminSavedRuleSummary[]
  searchQuery: string
}) {
  const filteredRules = useMemo(
    () => rules.filter((rule) => matchesSearch(searchQuery, [
      rule.id,
      rule.name,
      rule.ownerId,
      rule.ownerUsername,
      `${rule.sourceLength} chars`,
      formatDate(rule.createdAt),
      formatDate(rule.updatedAt),
    ])),
    [rules, searchQuery],
  )
  const stats = getRuleSectionStats(rules)

  return (
    <div className="grid gap-4">
      <SectionStatsGrid stats={stats} />
      <PlainDataTable
        columns={[
          { className: "min-w-[13rem]", key: "rule", label: "Rule" },
          { className: "hidden md:table-cell", key: "owner", label: "Owner" },
          { className: "hidden lg:table-cell", key: "source", label: "Source" },
          { className: "hidden xl:table-cell", key: "created", label: "Created" },
          { className: "hidden lg:table-cell", key: "updated", label: "Updated" },
          { className: "w-14 min-w-14", key: "actions", label: "" },
        ]}
        data={filteredRules}
        getRowId={(rule) => rule.id}
        isLoading={isLoading}
        onSearch={onSearch}
        renderRow={(rule) => (
          <>
            <TableCell className="max-w-[16rem] whitespace-normal"><NameCell id={rule.id} name={rule.name} /></TableCell>
            <TableCell className="hidden max-w-[14rem] md:table-cell">
              <TruncatedText value={rule.ownerUsername} />
            </TableCell>
            <TableCell className="hidden lg:table-cell">{rule.sourceLength.toLocaleString()} chars</TableCell>
            <TableCell className="hidden text-muted-foreground xl:table-cell">{formatDate(rule.createdAt)}</TableCell>
            <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(rule.updatedAt)}</TableCell>
            <TableCell className="w-14 min-w-14 text-right">
              <PlainRowActions onDelete={() => onDelete(rule)} onPreview={() => onPreview(rule)} />
            </TableCell>
          </>
        )}
        searchPlaceholder="Filter saved rules..."
        searchQuery={searchQuery}
      />
    </div>
  )
}

function FixturesTable({
  fixtures,
  isLoading,
  onDelete,
  onPreview,
  onSearch,
  searchQuery,
}: {
  fixtures: AdminUdmEventSetSummary[]
  isLoading: boolean
  onDelete: (fixture: AdminUdmEventSetSummary) => void
  onPreview: (fixture: AdminUdmEventSetSummary) => void
  onSearch: (query: string) => void
  searchQuery: string
}) {
  const filteredFixtures = useMemo(
    () =>
      fixtures.filter((fixture) =>
        matchesSearch(searchQuery, [
          fixture.id,
          fixture.name,
          fixture.ownerId,
          fixture.ownerUsername,
          fixture.savedRuleId,
          fixture.hasExpectedResults ? "expected results" : "no expected results",
          `${fixture.eventCount} events`,
          formatDate(fixture.createdAt),
          formatDate(fixture.updatedAt),
        ])
      ),
    [fixtures, searchQuery],
  )
  const stats = getFixtureSectionStats(fixtures)

  return (
    <div className="grid gap-4">
      <SectionStatsGrid stats={stats} />
      <PlainDataTable
        columns={[
          { className: "min-w-[13rem]", key: "fixture", label: "Test Case" },
          { className: "hidden md:table-cell", key: "owner", label: "Owner" },
          { className: "hidden lg:table-cell", key: "events", label: "Events" },
          { className: "hidden lg:table-cell", key: "expected", label: "Expected" },
          { className: "hidden 2xl:table-cell", key: "created", label: "Created" },
          { className: "hidden xl:table-cell", key: "updated", label: "Updated" },
          { className: "w-14 min-w-14", key: "actions", label: "" },
        ]}
        data={filteredFixtures}
        getRowId={(fixture) => fixture.id}
        isLoading={isLoading}
        onSearch={onSearch}
        renderRow={(fixture) => (
          <>
            <TableCell className="max-w-[16rem] whitespace-normal"><NameCell id={fixture.id} name={fixture.name} /></TableCell>
            <TableCell className="hidden max-w-[14rem] md:table-cell">
              <TruncatedText value={fixture.ownerUsername} />
            </TableCell>
            <TableCell className="hidden lg:table-cell">{fixture.eventCount.toLocaleString()}</TableCell>
            <TableCell className="hidden lg:table-cell">
              <Badge variant={fixture.hasExpectedResults ? "default" : "secondary"}>{fixture.hasExpectedResults ? "Stored" : "None"}</Badge>
            </TableCell>
            <TableCell className="hidden text-muted-foreground 2xl:table-cell">{formatDate(fixture.createdAt)}</TableCell>
            <TableCell className="hidden text-muted-foreground xl:table-cell">{formatDate(fixture.updatedAt)}</TableCell>
            <TableCell className="w-14 min-w-14 text-right">
              <PlainRowActions onDelete={() => onDelete(fixture)} onPreview={() => onPreview(fixture)} />
            </TableCell>
          </>
        )}
        searchPlaceholder="Filter test cases..."
        searchQuery={searchQuery}
      />
    </div>
  )
}

function DataTablesTable({
  dataTables,
  isLoading,
  onDelete,
  onPreview,
  onSearch,
  searchQuery,
}: {
  dataTables: AdminDataTableSummary[]
  isLoading: boolean
  onDelete: (dataTable: AdminDataTableSummary) => void
  onPreview: (dataTable: AdminDataTableSummary) => void
  onSearch: (query: string) => void
  searchQuery: string
}) {
  const filteredDataTables = useMemo(
    () => dataTables.filter((dataTable) => matchesSearch(searchQuery, [
      dataTable.id,
      dataTable.name,
      dataTable.ownerId,
      dataTable.ownerUsername,
      `${dataTable.rowCount} rows`,
      formatDate(dataTable.createdAt),
      formatDate(dataTable.updatedAt),
    ])),
    [dataTables, searchQuery],
  )
  const stats = getDataTableSectionStats(dataTables)

  return (
    <div className="grid gap-4">
      <SectionStatsGrid stats={stats} />
      <PlainDataTable
        columns={[
          { className: "min-w-[13rem]", key: "table", label: "Data Table" },
          { className: "hidden md:table-cell", key: "owner", label: "Owner" },
          { className: "hidden lg:table-cell", key: "rows", label: "Rows" },
          { className: "hidden xl:table-cell", key: "created", label: "Created" },
          { className: "hidden lg:table-cell", key: "updated", label: "Updated" },
          { className: "w-14 min-w-14", key: "actions", label: "" },
        ]}
        data={filteredDataTables}
        getRowId={(table) => table.id}
        isLoading={isLoading}
        onSearch={onSearch}
        renderRow={(dataTable) => (
          <>
            <TableCell className="max-w-[16rem] whitespace-normal"><NameCell id={dataTable.id} name={dataTable.name} /></TableCell>
            <TableCell className="hidden max-w-[14rem] md:table-cell">
              <TruncatedText value={dataTable.ownerUsername} />
            </TableCell>
            <TableCell className="hidden lg:table-cell">{dataTable.rowCount.toLocaleString()}</TableCell>
            <TableCell className="hidden text-muted-foreground xl:table-cell">{formatDate(dataTable.createdAt)}</TableCell>
            <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(dataTable.updatedAt)}</TableCell>
            <TableCell className="w-14 min-w-14 text-right">
              <PlainRowActions onDelete={() => onDelete(dataTable)} onPreview={() => onPreview(dataTable)} />
            </TableCell>
          </>
        )}
        searchPlaceholder="Filter data tables..."
        searchQuery={searchQuery}
      />
    </div>
  )
}

function AdminAssetPreviewDialog({
  onOpenChange,
  preview,
}: {
  onOpenChange: (open: boolean) => void
  preview: PendingPreview | null
}) {
  if (!preview) {
    return null
  }

  const title = getPreviewTitle(preview)

  return (
    <PlainModal
      contentClassName="w-[min(56rem,calc(100vw-2rem))] sm:max-w-4xl"
      description="Read-only admin preview. This view does not modify the user's saved content."
      isOpen
      onOpenChange={onOpenChange}
      title={title}
    >
      <div className="mt-4 grid gap-4">
        <PreviewMetadata preview={preview} />
        {preview.kind === "rule" ? (
          <>
            <PreviewField label="Description" value={preview.record.description || "No description saved."} />
            {preview.record.tags.length > 0 ? <PreviewField label="Tags" value={preview.record.tags.join(", ")} /> : null}
            {preview.record.folder ? <PreviewField label="Folder" value={preview.record.folder} /> : null}
            <ReadOnlyPreviewBlock label="Rule source" value={preview.record.source} />
          </>
        ) : null}
        {preview.kind === "fixture" ? (
          <>
            <PreviewField label="Description" value={preview.record.description || "No description saved."} />
            <ReadOnlyPreviewBlock label="Events" value={formatJsonPreview(preview.record.events)} />
            <ReadOnlyPreviewBlock
              label="Expected results"
              value={preview.record.expectedResults == null ? "No expected results saved." : formatJsonPreview(preview.record.expectedResults)}
            />
          </>
        ) : null}
        {preview.kind === "table" ? (
          <>
            <PreviewField label="Description" value={preview.record.description || "No description saved."} />
            <ReadOnlyPreviewBlock label="Rows" value={formatJsonPreview(preview.record.rows)} />
          </>
        ) : null}
      </div>
      <DialogActions>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
      </DialogActions>
    </PlainModal>
  )
}

function PreviewMetadata({ preview }: { preview: PendingPreview }) {
  const record = preview.record
  const details = [
    ["Owner", record.ownerUsername],
    ["Created", formatDate(record.createdAt)],
    ["Updated", formatDate(record.updatedAt)],
    ["ID", record.id],
  ]

  if (preview.kind === "rule") {
    details.splice(1, 0, ["Source", `${preview.record.sourceLength.toLocaleString()} chars`])
  }
  if (preview.kind === "fixture") {
    details.splice(1, 0, ["Events", preview.record.eventCount.toLocaleString()])
  }
  if (preview.kind === "table") {
    details.splice(1, 0, ["Rows", preview.record.rowCount.toLocaleString()])
  }

  return (
    <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
      {details.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <div className="font-medium text-muted-foreground">{label}</div>
          <div className="truncate text-foreground" title={value}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-sm">
      <div className="font-medium text-foreground">{label}</div>
      <p className="line-clamp-3 break-words text-muted-foreground" title={value}>{value}</p>
    </div>
  )
}

function ReadOnlyPreviewBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <pre className="max-h-[24rem] overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-5 text-foreground">
        <code>{value}</code>
      </pre>
    </div>
  )
}

function getPreviewTitle(preview: PendingPreview) {
  if (preview.kind === "rule") {
    return `Preview rule: ${preview.record.name}`
  }
  if (preview.kind === "fixture") {
    return `Preview test case: ${preview.record.name}`
  }
  return `Preview data table: ${preview.record.name}`
}

function formatJsonPreview(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ApiKeysTable({
  apiKeys,
  isLoading,
  onSearch,
  searchQuery,
  users,
}: {
  apiKeys: AdminApiKeySummary[]
  isLoading: boolean
  onSearch: (query: string) => void
  searchQuery: string
  users: AdminUserSummary[]
}) {
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users])
  const filteredApiKeys = useMemo(
    () =>
      apiKeys.filter((apiKey) =>
        matchesSearch(searchQuery, [
          apiKey.id,
          apiKey.name,
          apiKey.ownerId,
          apiKey.ownerUsername,
          apiKey.prefix,
          apiKey.status,
          ...apiKey.scopes,
          `${apiKey.recentUsageCount} usage`,
          `${apiKey.rateLimitBucketCount} buckets`,
        ])
      ),
    [apiKeys, searchQuery],
  )
  const stats = getApiKeySectionStats(apiKeys, users)

  return (
    <div className="grid gap-4">
      <SectionStatsGrid stats={stats} />
      <PlainDataTable
        columns={[
          { className: "min-w-[13rem]", key: "key", label: "API Key" },
          { className: "hidden md:table-cell", key: "owner", label: "Owner" },
          { className: "hidden lg:table-cell", key: "status", label: "Status" },
          { className: "hidden xl:table-cell", key: "scopes", label: "Scopes" },
          { className: "hidden lg:table-cell", key: "usage", label: "Usage" },
          { className: "hidden xl:table-cell", key: "limit", label: "Owner Limit" },
          { className: "hidden lg:table-cell", key: "lastUsed", label: "Last Used" },
        ]}
        data={filteredApiKeys}
        getRowId={(apiKey) => apiKey.id}
        isLoading={isLoading}
        onSearch={onSearch}
        renderRow={(apiKey) => {
          const owner = userById.get(apiKey.ownerId)

          return (
            <>
              <TableCell className="max-w-[16rem] whitespace-normal">
                <NameCell id={apiKey.prefix} name={apiKey.name} />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="min-w-0">
                  <TruncatedText className="font-medium" value={apiKey.ownerUsername} />
                  <TruncatedText className="text-xs text-muted-foreground" value={apiKey.ownerId} />
                </div>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Badge variant={apiKey.status === "active" ? "default" : apiKey.status === "revoked" ? "destructive" : "secondary"}>
                  {formatStatusLabel(apiKey.status)}
                </Badge>
              </TableCell>
              <TableCell className="hidden xl:table-cell">
                <ScopeList scopes={apiKey.scopes} />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <div className="text-sm tabular-nums">{apiKey.recentUsageCount.toLocaleString()} requests</div>
                <div className="text-xs text-muted-foreground">{apiKey.rateLimitBucketCount.toLocaleString()} active windows</div>
              </TableCell>
              <TableCell className="hidden xl:table-cell">
                {owner ? `${owner.activeApiKeyCount.toLocaleString()} / ${getUserApiKeyLimitLabel(owner)}` : "Unknown"}
              </TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">
                {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : "Never"}
              </TableCell>
            </>
          )
        }}
        searchPlaceholder="Filter API keys..."
        searchQuery={searchQuery}
      />
    </div>
  )
}

function ScopeList({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) {
    return <span className="text-muted-foreground">No scopes</span>
  }

  return (
    <div className="flex max-w-72 flex-wrap gap-1">
      {scopes.slice(0, 3).map((scope) => (
        <Badge key={scope} variant="secondary" className="max-w-44 truncate">
          {scope}
        </Badge>
      ))}
      {scopes.length > 3 ? <Badge variant="outline">+{scopes.length - 3}</Badge> : null}
    </div>
  )
}

function PlainDataTable<TData>({
  columns,
  data,
  getRowId,
  isLoading,
  onSearch,
  renderRow,
  searchPlaceholder,
  searchQuery,
  toolbarAction,
}: {
  columns: Array<{ className?: string; key: string; label: string }>
  data: TData[]
  getRowId: (row: TData) => string
  isLoading: boolean
  onSearch: (query: string) => void
  renderRow: (row: TData) => ReactNode
  searchPlaceholder: string
  searchQuery: string
  toolbarAction?: ReactNode
}) {
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const pageCount = Math.max(Math.ceil(data.length / pageSize), 1)

  useEffect(() => {
    setPageIndex(0)
  }, [searchQuery, pageSize])

  useEffect(() => {
    setPageIndex((current) => Math.min(current, pageCount - 1))
  }, [pageCount])

  const pageRows = data.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-80">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search records"
            className="h-8 pl-9"
            onChange={(event) => onSearch(event.target.value)}
            placeholder={searchPlaceholder}
            value={searchQuery}
          />
        </div>
        {toolbarAction ? <div className="flex shrink-0 items-center gap-2">{toolbarAction}</div> : null}
      </div>
      {isLoading ? <LoadingIndicator label="Loading records" /> : null}
      <div className="overflow-x-auto rounded-md border">
        <Table className="min-w-full">
          <TableHeader>
            <TableRow className="group/row">
              {columns.map((column) => (
                <TableHead key={column.key} className={cn("bg-background group-hover/row:bg-muted", column.className)}>
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length > 0 ? (
              pageRows.map((row) => (
                <TableRow key={getRowId(row)} className="group/row">
                  {renderRow(row)}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">No results.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-2">
        <div className="hidden flex-1 text-sm text-muted-foreground sm:block">{data.length} row(s)</div>
        <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:justify-end">
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-sm font-medium">Rows per page</span>
            <NativeSelect
              aria-label="Rows per page"
              className="h-8 w-20"
              value={`${pageSize}`}
              onChange={(event) => setPageSize(Number(event.currentTarget.value))}
            >
              {[10, 20, 30, 40, 50].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="text-sm font-medium">Page {pageIndex + 1} of {pageCount}</div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" className="hidden size-8 p-0 sm:flex" onClick={() => setPageIndex(0)} disabled={pageIndex === 0}>
              <span className="sr-only">Go to first page</span>
              <ChevronsLeftIcon className="size-4" />
            </Button>
            <Button type="button" variant="outline" className="size-8 p-0" onClick={() => setPageIndex((current) => Math.max(current - 1, 0))} disabled={pageIndex === 0}>
              <span className="sr-only">Go to previous page</span>
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button type="button" variant="outline" className="size-8 p-0" onClick={() => setPageIndex((current) => Math.min(current + 1, pageCount - 1))} disabled={pageIndex >= pageCount - 1}>
              <span className="sr-only">Go to next page</span>
              <ChevronRightIcon className="size-4" />
            </Button>
            <Button type="button" variant="outline" className="hidden size-8 p-0 sm:flex" onClick={() => setPageIndex(pageCount - 1)} disabled={pageIndex >= pageCount - 1}>
              <span className="sr-only">Go to last page</span>
              <ChevronsRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PlainRowActions({
  onDelete,
  onEdit,
  onPreview,
}: {
  onDelete: () => void
  onEdit?: () => void
  onPreview?: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Open menu"
          className="flex size-8 p-0"
          type="button"
          variant="ghost"
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={6} className="w-40">
        {onPreview ? (
          <>
            <DropdownMenuItem onSelect={onPreview}>Preview</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {onEdit ? (
          <>
            <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SettingsPanel({
  isLoading,
  isSaving,
  onChange,
  onSave,
  settings,
}: {
  isLoading: boolean
  isSaving: boolean
  onChange: (patch: Partial<AppSettings>) => void
  onSave: () => void
  settings: AppSettings | null
}) {
  return (
    <div className="grid gap-4">
      {isLoading ? <LoadingIndicator label="Loading settings" /> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
        <div className="grid gap-3">
          <ToggleSetting checked={settings?.appAccessEnabled ?? true} description="When disabled, normal app operations are blocked for non-admin users." title="App access" onChange={(checked) => onChange({ appAccessEnabled: checked })} />
          <ToggleSetting checked={settings?.signupsEnabled ?? true} description="Controls whether the public signup form accepts new accounts." title="New signups" onChange={(checked) => onChange({ signupsEnabled: checked })} />
          <ToggleSetting checked={settings?.apiAccessEnabled ?? true} description="Enable API keys and authenticated API requests." title="API access" onChange={(checked) => onChange({ apiAccessEnabled: checked })} />
        </div>
        <Card>
          <CardContent className="grid gap-3 p-4">
            <FieldStack label="Maintenance message">
              <Input className="h-9" value={settings?.maintenanceMessage ?? ""} onChange={(event) => onChange({ maintenanceMessage: event.target.value })} />
            </FieldStack>
            <FieldStack label="Support email">
              <Input className="h-9" placeholder="support@example.com" type="email" value={settings?.supportEmail ?? ""} onChange={(event) => onChange({ supportEmail: event.target.value })} />
            </FieldStack>
            <FieldStack label="Status page URL">
              <Input className="h-9" placeholder="https://status.example.com" type="url" value={settings?.statusPageUrl ?? ""} onChange={(event) => onChange({ statusPageUrl: event.target.value })} />
            </FieldStack>
            <Alert variant="destructive" className="grid-cols-1 text-xs">
              <AlertDescription>Turning off app access is maintenance mode. Keep at least one admin account working before using it.</AlertDescription>
            </Alert>
            <Button type="button" className="justify-self-end" disabled={!settings || isSaving} onClick={onSave}>
              {isSaving ? (
                <LoadingIndicator label="Saving" className="text-current" markClassName="size-4 border-current/40 bg-current/10 text-current" />
              ) : "Save settings"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ToggleSetting({
  checked,
  description,
  onChange,
  title,
}: {
  checked: boolean
  description: string
  onChange: (checked: boolean) => void
  title: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40">
      <Checkbox checked={checked} className="mt-1" onCheckedChange={(value) => onChange(value === true)} />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Settings2Icon className="size-4 text-muted-foreground" />
          {title}
          <Badge variant={checked ? "default" : "secondary"}>{checked ? "Enabled" : "Disabled"}</Badge>
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  )
}

function PlainModal({
  children,
  contentClassName,
  description,
  isOpen,
  onOpenChange,
  title,
}: {
  children: ReactNode
  contentClassName?: string
  description: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  title: string
}) {
  if (!isOpen) {
    return null
  }

  return (
    <div data-slot="dialog-portal" className="fixed inset-0 z-50">
      <button
        aria-label={`Close ${title}`}
        className="fixed inset-0 z-50 bg-background/80"
        data-slot="dialog-overlay"
        type="button"
        onClick={() => onOpenChange(false)}
      />
      <section
        aria-describedby={`${slugify(title)}-description`}
        aria-labelledby={`${slugify(title)}-title`}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[min(90vh,calc(100vh-2rem))] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl outline-none sm:max-w-lg",
          contentClassName
        )}
        data-slot="dialog-content"
        role="dialog"
      >
        <div data-slot="dialog-header" className="flex flex-col gap-1.5 pr-8 text-start">
          <h2 id={`${slugify(title)}-title`} data-slot="dialog-title" className="text-sm font-semibold text-foreground">{title}</h2>
          <p id={`${slugify(title)}-description`} data-slot="dialog-description" className="text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
        <Button aria-label="Close" className="absolute right-3 top-3" size="icon-sm" type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          <XIcon />
        </Button>
        {children}
      </section>
    </div>
  )
}

function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div data-slot="dialog-footer" className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      {children}
    </div>
  )
}

function PlainConfirmDialog({
  confirmLabel = "Confirm",
  description,
  isDestructive,
  isOpen,
  onConfirm,
  onOpenChange,
  title,
}: {
  confirmLabel?: string
  description: string
  isDestructive?: boolean
  isOpen: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  title: string
}) {
  return (
    <PlainModal description={description} isOpen={isOpen} onOpenChange={onOpenChange} title={title}>
      <DialogActions>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          type="button"
          variant={isDestructive ? "destructive" : "default"}
          size="sm"
          onClick={() => {
            onConfirm()
            onOpenChange(false)
          }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </PlainModal>
  )
}

function MenuButton({
  children,
  destructive,
  onClick,
}: {
  children: ReactNode
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground",
        destructive ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : null,
      )}
      role="menuitem"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function DialogField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid grid-cols-6 items-center gap-x-4 gap-y-1">
      <span className="col-span-2 text-end text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

function FieldStack({
  children,
  className = "",
  label,
}: {
  children: ReactNode
  className?: string
  label: string
}) {
  return (
    <label className={`grid gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function NativeSelect({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function AdminError({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="grid-cols-1">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function NameCell({ id, name }: { id: string; name: string }) {
  return (
    <div className="min-w-0">
      <TruncatedText className="font-medium" value={name} />
      <TruncatedText className="text-xs text-muted-foreground" value={id} />
    </div>
  )
}

function TruncatedText({ className, value }: { className?: string; value: string }) {
  return (
    <div className={cn("min-w-0 truncate", className)} title={value}>
      {value}
    </div>
  )
}

function createEmptyNewUserDraft(): NewUserDraft {
  return {
    isAdmin: false,
    password: "",
    username: "",
  }
}

function createFallbackUserDraft(): UserDraft {
  return {
    isAdmin: false,
  }
}

function toUserDraft(user: AdminUserSummary): UserDraft {
  return {
    isAdmin: Boolean(user.isAdmin),
  }
}

function toNumberInputValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "0"
}

function getUserAssetCount(user: AdminUserSummary) {
  return (user.savedRuleCount ?? 0) + (user.udmEventSetCount ?? 0) + (user.dataTableCount ?? 0)
}

function getUserSectionStats(users: AdminUserSummary[]): SectionStat[] {
  const apiKeyCount = users.reduce((total, user) => total + (user.apiKeyCount ?? 0), 0)
  const activeApiKeys = users.reduce((total, user) => total + (user.activeApiKeyCount ?? 0), 0)
  const rateLimitBuckets = users.reduce((total, user) => total + (user.apiRateLimitBucketCount ?? 0), 0)

  return [
    { detail: `${users.filter((user) => user.isAdmin).length.toLocaleString()} admin accounts`, icon: UsersIcon, label: "Total users", value: users.length },
    { detail: `${apiKeyCount.toLocaleString()} total keys`, icon: KeyRoundIcon, label: "Active API keys", value: activeApiKeys },
    { detail: "Current API usage windows", icon: ArrowDownUpIcon, label: "Rate-limit buckets", value: rateLimitBuckets },
  ]
}

function getRuleSectionStats(rules: AdminSavedRuleSummary[]): SectionStat[] {
  const sourceLength = rules.reduce((total, rule) => total + rule.sourceLength, 0)

  return [
    { detail: "Persisted rule-authoring records", icon: FileCode2Icon, label: "Saved rules", value: rules.length },
    { detail: "Users with at least one saved rule", icon: UsersIcon, label: "Owners", value: countUniqueOwners(rules) },
    { detail: "Total stored source length", icon: DatabaseIcon, label: "Source size", value: formatCompactNumber(sourceLength) },
    { detail: "Updated in the last 7 days", icon: TrendingUpIcon, label: "Recent updates", value: countRecentUpdates(rules) },
  ]
}

function getFixtureSectionStats(fixtures: AdminUdmEventSetSummary[]): SectionStat[] {
  const eventCount = fixtures.reduce((total, fixture) => total + fixture.eventCount, 0)
  const linkedRuleCount = new Set(fixtures.map((fixture) => fixture.savedRuleId).filter(Boolean)).size

  return [
    { detail: "Saved local evaluator test sets", icon: FlaskConicalIcon, label: "Test cases", value: fixtures.length },
    { detail: "Stored events across all cases", icon: DatabaseIcon, label: "Events", value: eventCount },
    { detail: "Cases with expected results", icon: TrendingUpIcon, label: "Expected results", value: fixtures.filter((fixture) => fixture.hasExpectedResults).length },
    { detail: "Rules referenced by test cases", icon: FileCode2Icon, label: "Linked rules", value: linkedRuleCount },
  ]
}

function getDataTableSectionStats(dataTables: AdminDataTableSummary[]): SectionStat[] {
  const rowCount = dataTables.reduce((total, dataTable) => total + dataTable.rowCount, 0)

  return [
    { detail: "Saved lookup/reference tables", icon: DatabaseIcon, label: "Data tables", value: dataTables.length },
    { detail: "Rows stored across all tables", icon: ArrowDownUpIcon, label: "Rows", value: rowCount },
    { detail: "Users with at least one table", icon: UsersIcon, label: "Owners", value: countUniqueOwners(dataTables) },
    { detail: "Updated in the last 7 days", icon: TrendingUpIcon, label: "Recent updates", value: countRecentUpdates(dataTables) },
  ]
}

function getApiKeySectionStats(apiKeys: AdminApiKeySummary[], users: AdminUserSummary[]): SectionStat[] {
  const activeKeys = apiKeys.filter((apiKey) => apiKey.active).length
  const inactiveKeys = apiKeys.length - activeKeys
  const windowUsage = apiKeys.reduce((total, apiKey) => total + apiKey.recentUsageCount, 0)
  const ownerLimitTotal = users.reduce((total, user) => total + getUserApiKeyLimit(user), 0)

  return [
    { detail: `${activeKeys.toLocaleString()} currently usable`, icon: KeyRoundIcon, label: "API keys", value: apiKeys.length },
    { detail: `${inactiveKeys.toLocaleString()} revoked or expired`, icon: TrendingUpIcon, label: "Active keys", value: activeKeys },
    { detail: "Requests in current rate-limit windows", icon: ArrowDownUpIcon, label: "Window usage", value: windowUsage },
    { detail: "Total active-key allowance across users", icon: UsersIcon, label: "Owner capacity", value: ownerLimitTotal },
  ]
}

function countUniqueOwners(records: Array<{ ownerId: string | null }>) {
  return new Set(records.map((record) => record.ownerId).filter(Boolean)).size
}

function countRecentUpdates(records: Array<{ updatedAt: Date | string }>) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  return records.filter((record) => getTime(record.updatedAt) >= sevenDaysAgo).length
}

function getUserApiKeyLimitLabel(user: AdminUserSummary) {
  return getUserApiKeyLimit(user).toLocaleString()
}

function getUserApiKeyLimit(_user: AdminUserSummary) {
  return 10
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value)
}

function getRatio(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0
}

function buildAdminDailyChartData(dashboard: AdminDashboardData | undefined) {
  const users = dashboard?.users ?? []
  const now = new Date()

  return Array.from({ length: 90 }, (_, index) => {
    const date = new Date(now)
    date.setHours(0, 0, 0, 0)
    date.setDate(now.getDate() - 89 + index)
    const nextDate = new Date(date)
    nextDate.setDate(date.getDate() + 1)
    let signups = 0
    let assets = 0
    let userTotal = 0

    for (const user of users) {
      const createdAt = user.createdAt instanceof Date ? user.createdAt : new Date(user.createdAt)
      if (Number.isNaN(createdAt.getTime())) {
        continue
      }
      if (createdAt < nextDate) {
        userTotal += 1
        assets += getUserAssetCount(user)
      }
      if (createdAt >= date && createdAt < nextDate) {
        signups += 1
      }
    }

    return {
      assets,
      date: date.toISOString().slice(0, 10),
      signups,
      users: userTotal,
    }
  })
}

function getApiKeyBreakdown(users: AdminUserSummary[]) {
  const groups = [
    { active: 0, inactive: 0, role: "Admins" },
    { active: 0, inactive: 0, role: "Users" },
  ]

  for (const user of users) {
    const group = user.isAdmin ? groups[0] : groups[1]
    const active = Math.max(user.activeApiKeyCount ?? 0, 0)
    const total = Math.max(user.apiKeyCount ?? 0, 0)
    group.active += active
    group.inactive += Math.max(total - active, 0)
  }

  return groups
}

function matchesSearch(query: string, values: Array<number | string | null | undefined>) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return true
  }
  return values.some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery))
}

function formatStatusLabel(status: string) {
  if (status === EMPTY_VALUE || status === "No status") {
    return "No status"
  }
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatChartDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  })
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return "Unknown"
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "Unknown"
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function getTime(value: Date | string | null | undefined) {
  if (!value) {
    return 0
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function getUserEmail(user: unknown) {
  if (!user || typeof user !== "object") {
    return ""
  }
  const candidate = user as { identities?: { email?: { id?: string } }; username?: string }
  return candidate.identities?.email?.id ?? candidate.username ?? ""
}

function getAdminTabFromHash(hash: string) {
  const value = hash.replace(/^#/, "")
  return ADMIN_TABS.has(value) ? value : "overview"
}

function getAdminPageMeta(tab: string) {
  if (tab === "users") {
    return {
      description: "Manage your users and their roles here.",
      title: "User List",
    }
  }
  if (tab === "rules") {
    return {
      description: "Review and remove persisted YARA-L rules across all workspaces.",
      title: "Saved Rules",
    }
  }
  if (tab === "fixtures") {
    return {
      description: "Inspect saved test event sets used by local validation workflows.",
      title: "Test Cases",
    }
  }
  if (tab === "tables") {
    return {
      description: "Audit saved reference tables used by table and table.column lookups.",
      title: "Data Tables",
    }
  }
  if (tab === "apiKeys") {
    return {
      description: "Audit public API credentials, owners, current usage windows, and resource limits.",
      title: "API Keys",
    }
  }
  if (tab === "settings") {
    return {
      description: "Control app access, signups, API access, and support links.",
      title: "Settings",
    }
  }
  return {
    description: "",
    title: "Dashboard",
  }
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}
