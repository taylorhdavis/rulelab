import {
  BookOpen,
  ChevronRight,
  Database,
  FileCode2,
  FlaskConical,
  type LucideIcon,
} from "lucide-react"
import type { ComponentProps } from "react"
import { useLocation, useNavigate } from "react-router"
import { useAuth } from "wasp/client/auth"

import { RuleLabMark } from "./AppLogo"
import { NavUser } from "./nav-user"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "./ui/sidebar"

type AppSidebarProps = ComponentProps<typeof Sidebar>
type NavMainItem = {
  icon: LucideIcon
  isActive?: boolean
  items?: {
    title: string
    url: string
  }[]
  studioPanel?: "dataTables" | "fixtureEditor" | "library" | "settings"
  title: string
  url: string
}

export function AppSidebar({ ...props }: AppSidebarProps) {
  const { data: user } = useAuth()
  const location = useLocation()
  const username = user?.identities.email?.id ?? "Signed in"

  const data: {
    navMain: NavMainItem[]
    user: {
      avatar: string
      email: string
      isAdmin: boolean
      name: string
    }
  } = {
    user: {
      name: username,
      email: username,
      avatar: "",
      isAdmin: Boolean(user?.isAdmin),
    },
    navMain: [
      {
        title: "Rule Editor",
        url: "/editor",
        icon: FileCode2,
        isActive: location.pathname === "/editor" && !location.state?.studioPanel,
      },
      {
        title: "Rule Library",
        url: "/editor",
        studioPanel: "library",
        icon: BookOpen,
        isActive: location.state?.studioPanel === "library",
      },
      {
        title: "Test Case Editor",
        url: "/editor",
        studioPanel: "fixtureEditor",
        icon: FlaskConical,
        isActive: location.state?.studioPanel === "fixtureEditor",
      },
      {
        title: "Data Tables",
        url: "/editor",
        studioPanel: "dataTables",
        icon: Database,
        isActive: location.state?.studioPanel === "dataTables",
      },
    ],
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <StaticLogoHeader />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function StaticLogoHeader() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          tabIndex={-1}
          className="cursor-default hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground focus-visible:ring-0"
        >
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
            <RuleLabMark className="size-8" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">RuleLab</span>
            <span className="truncate text-xs">Workspace</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function NavMain({ items }: { items: NavMainItem[] }) {
  const navigate = useNavigate()

  function openItem(item: NavMainItem) {
    navigate(item.url, {
      state: item.studioPanel ? { studioPanel: item.studioPanel } : undefined,
    })
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible key={item.title} asChild defaultOpen={item.isActive} className="group/collapsible">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={item.isActive}
                  onClick={() => openItem(item)}
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                  {item.items?.length ? (
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  ) : null}
                </SidebarMenuButton>
              </CollapsibleTrigger>
              {item.items?.length ? (
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton asChild>
                          <a href={subItem.url}>
                            <span>{subItem.title}</span>
                          </a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              ) : null}
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
