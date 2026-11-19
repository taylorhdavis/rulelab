import {
  BadgeCheck,
  ChevronsUpDown,
  LayoutDashboard,
  KeyRound,
  LogOut,
  PanelsTopLeft,
  ShieldCheck,
} from "lucide-react"
import { useLocation, useNavigate } from "react-router"
import { logout } from "wasp/client/auth"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "./ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./ui/sidebar"

export function NavUser({
  onMenuOpenChange,
  user,
}: {
  onMenuOpenChange?: (open: boolean) => void
  user: {
    name: string
    email: string
    avatar: string
    isAdmin: boolean
  }
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isMobile } = useSidebar()
  const fallback = (user.name || user.email || "Y").slice(0, 2).toUpperCase()
  const isAdminDashboard = location.pathname === "/admin"
  const showEmail = Boolean(user.email && user.email !== user.name)

  async function handleLogout() {
    await logout()
    navigate("/login")
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">{fallback}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                {showEmail ? <span className="truncate text-xs">{user.email}</span> : null}
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-lg">{fallback}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  {showEmail ? <span className="truncate text-xs">{user.email}</span> : null}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {user.isAdmin ? (
                <DropdownMenuItem onSelect={() => navigate(isAdminDashboard ? "/editor" : "/admin")}>
                  {isAdminDashboard ? <PanelsTopLeft /> : <LayoutDashboard />}
                  {isAdminDashboard ? "Back to app" : "Admin Dashboard"}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => navigate("/profile")}>
                <BadgeCheck />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/profile/api")}>
                <KeyRound />
                API
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/profile/security")}>
                <ShieldCheck />
                Security
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void handleLogout()
              }}
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
