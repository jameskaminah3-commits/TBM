import { useEffect, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowUpRight,
  CalendarCheck2,
  CalendarClock,
  ClipboardList,
  FileText,
  House,
  LifeBuoy,
  Menu,
  MessagesSquare,
  ReceiptText,
  Share2,
  UserRound,
  Wallet,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { InboxQuickPanel } from "@/components/inbox-quick-panel";
import { CountBadge, HubAvatar, VerificationBadge, workspaceIcons } from "@/components/provider-hub/hub-ui";
import { useAuth } from "@/hooks/useAuth";
import { useInbox } from "@/hooks/use-inbox";
import { useProviderHub } from "@/hooks/use-provider-hub";
import { useCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { providerWorkspaces, workspacesHaveCustomQuotes } from "@shared/provider-workspaces";
import type { ProviderCategory } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Editor pages belong to the service they edit, so the sidebar keeps that service lit.
const editorPathWorkspaces: Array<[prefix: string, workspace: ProviderCategory]> = [
  ["/provider/stays/", "stays"],
  ["/provider/cars/", "cars"],
  ["/provider/cooks/", "cooks"],
  ["/provider/errands/", "errands"],
  ["/provider/experiences/", "experiences"],
];

function useHubRoute() {
  const [path] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const tab = path === "/provider/dashboard" ? params.get("tab") ?? "overview" : null;
  const workspace = path === "/provider/dashboard" && tab === "listings"
    ? (params.get("workspace") as ProviderCategory | null)
    : editorPathWorkspaces.find(([prefix]) => path.startsWith(prefix))?.[1] ?? null;
  return { path, tab, workspace };
}

type NavLinkProps = {
  href: string;
  icon: typeof House;
  label: string;
  active: boolean;
  badge?: number;
  badgeTone?: "amber" | "teal" | "stone";
  testId?: string;
  children?: ReactNode;
};

function NavLink({ href, icon: Icon, label, active, badge = 0, badgeTone = "amber", testId, children }: NavLinkProps) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} className="h-10 rounded-xl data-[active=true]:bg-white data-[active=true]:shadow-sm data-[active=true]:ring-1 data-[active=true]:ring-stone-200">
        <Link href={href} onClick={() => setOpenMobile(false)} data-testid={testId} aria-current={active ? "page" : undefined}>
          <Icon className={cn(active ? "text-teal-700" : "text-stone-500")} />
          <span className="flex-1 truncate">{label}</span>
          <CountBadge count={badge} tone={badgeTone} />
        </Link>
      </SidebarMenuButton>
      {children}
    </SidebarMenuItem>
  );
}

function ProviderSidebar() {
  const { user, isAdmin } = useAuth();
  const hub = useProviderHub();
  const route = useHubRoute();
  const { setOpenMobile } = useSidebar();
  const { unreadCount } = useInbox({ enabled: Boolean(user && (user.role === "provider" || user.role === "admin")) });
  const displayName = hub.profile?.businessName?.trim()
    || [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim()
    || "Your business";
  const showQuotes = workspacesHaveCustomQuotes(hub.workspaces);
  const onDashboard = route.path === "/provider/dashboard";

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 px-3 pb-2 pt-4">
        <Link href="/provider/profile" onClick={() => setOpenMobile(false)} className="flex items-center gap-3 rounded-2xl p-1.5 transition-colors hover:bg-white/70" data-testid="link-hub-profile-card">
          <HubAvatar photoUrl={hub.profile?.photoUrl} name={displayName} className="h-11 w-11" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-stone-950">{displayName}</span>
            <span className="mt-0.5 block">
              {isAdmin ? (
                <span className="text-xs text-muted-foreground">TBM admin view</span>
              ) : (
                <VerificationBadge status={hub.profile?.verificationStatus} />
              )}
            </span>
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-0 pb-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavLink href="/provider/dashboard" icon={House} label="Home" active={onDashboard && route.tab === "overview"} testId="nav-hub-home" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{hub.workspaces.length === 1 ? "Your service" : "Your services"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {hub.workspaces.map((key) => {
                const workspace = providerWorkspaces[key];
                const active = route.workspace === key;
                return (
                  <NavLink
                    key={key}
                    href={`/provider/dashboard?tab=listings&workspace=${key}`}
                    icon={workspaceIcons[key]}
                    label={workspace.label}
                    active={active}
                    badge={hub.listingCounts[key] ?? 0}
                    badgeTone="stone"
                    testId={`nav-workspace-${key}`}
                  >
                    {/* Vehicle status and documents only exist for vehicles. */}
                    {key === "cars" ? (
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={route.path === "/provider/availability"}>
                            <Link href="/provider/availability" onClick={() => setOpenMobile(false)} data-testid="nav-vehicle-status">
                              <CalendarClock />
                              <span>Vehicle status</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={route.path === "/provider/documents"}>
                            <Link href="/provider/documents" onClick={() => setOpenMobile(false)} data-testid="nav-vehicle-documents">
                              <FileText />
                              <span>Vehicle documents</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    ) : null}
                  </NavLink>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Work</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavLink href="/provider/service-requests" icon={ClipboardList} label="Job requests" active={route.path === "/provider/service-requests"} badge={hub.awaitingResponseCount} testId="nav-job-requests" />
              <NavLink href="/provider/dashboard?tab=bookings" icon={CalendarCheck2} label="Bookings" active={onDashboard && route.tab === "bookings"} testId="nav-bookings" />
              {showQuotes ? (
                <NavLink href="/provider/dashboard?tab=custom-requests" icon={ReceiptText} label="Custom quotes" active={onDashboard && route.tab === "custom-requests"} badge={hub.quotesNeededCount} testId="nav-custom-quotes" />
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Grow</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavLink href="/provider/share" icon={Share2} label="Share & grow" active={route.path === "/provider/share"} testId="nav-share" />
              <NavLink href="/provider/earnings" icon={Wallet} label="Earnings" active={route.path === "/provider/earnings"} testId="nav-earnings" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavLink href="/provider/messages" icon={MessagesSquare} label="Messages" active={route.path === "/provider/messages"} badge={unreadCount} testId="nav-messages" />
              <NavLink href="/provider/profile" icon={UserRound} label="Profile & payouts" active={route.path === "/provider/profile"} testId="nav-profile" />
              <NavLink href="/provider/support" icon={LifeBuoy} label="Help" active={route.path === "/provider/support"} testId="nav-support" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-3 py-3">
        <Link href="/" className="flex items-center justify-between rounded-xl px-2 py-2 text-sm text-stone-600 hover:bg-white/70 hover:text-stone-950">
          Tembea Bila Matata site
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </SidebarFooter>
    </Sidebar>
  );
}

// Phones: the four things providers do most, a thumb's reach away, and More
// for everything else.
function ProviderBottomNav() {
  const hub = useProviderHub();
  const route = useHubRoute();
  const { setOpenMobile } = useSidebar();
  const items = [
    { href: "/provider/dashboard", label: "Home", icon: House, active: route.path === "/provider/dashboard" && route.tab === "overview", badge: 0, testId: "tab-hub-home" },
    { href: "/provider/service-requests", label: "Requests", icon: ClipboardList, active: route.path === "/provider/service-requests", badge: hub.awaitingResponseCount, testId: "tab-hub-requests" },
    { href: "/provider/dashboard?tab=bookings", label: "Bookings", icon: CalendarCheck2, active: route.path === "/provider/dashboard" && route.tab === "bookings", badge: 0, testId: "tab-hub-bookings" },
    { href: "/provider/share", label: "Share", icon: Share2, active: route.path === "/provider/share", badge: 0, testId: "tab-hub-share" },
  ];

  return (
    <nav
      aria-label="Provider Hub"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_30px_-24px_rgba(28,25,23,0.45)] backdrop-blur md:hidden"
      data-testid="provider-bottom-nav"
    >
      <div className="grid h-16 grid-cols-5">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            data-testid={item.testId}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1 text-[0.7rem] font-medium",
              item.active ? "text-teal-800" : "text-stone-500",
            )}
          >
            {item.active ? <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-teal-700" aria-hidden="true" /> : null}
            <span className="relative">
              <item.icon className="h-5 w-5" aria-hidden="true" />
              {item.badge ? <CountBadge count={item.badge} className="absolute -right-3 -top-2 h-4 min-w-4 px-1 text-[10px]" /> : null}
            </span>
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className="flex flex-col items-center justify-center gap-1 text-[0.7rem] font-medium text-stone-500"
          data-testid="tab-hub-more"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
          More
        </button>
      </div>
    </nav>
  );
}

function ProviderCurrencySelect() {
  const { selectedCurrency, setSelectedCurrency } = useCurrency();

  return (
    <Select value={selectedCurrency} onValueChange={(value) => setSelectedCurrency(value as "USD" | "KES")}>
      <SelectTrigger className="h-9 w-[86px] rounded-full bg-background" aria-label="Currency">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="KES">KSh</SelectItem>
        <SelectItem value="USD">USD</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function ProviderLayout({ children, title }: { children: ReactNode; title?: string }) {
  const { user } = useAuth();
  const { unreadCount } = useInbox({ enabled: Boolean(user && (user.role === "provider" || user.role === "admin")), refetchInterval: 15000 });
  const style = {
    "--sidebar-width": "16.5rem",
    "--sidebar-width-icon": "3rem",
  };

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.classList.contains("dark") ? "dark" : "light";

    root.classList.remove("light", "dark");
    root.classList.add("light");

    return () => {
      root.classList.remove("light", "dark");
      root.classList.add(previousTheme);
    };
  }, []);

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-[100dvh] w-full overflow-hidden bg-[#fbf8f3]">
        <ProviderSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-stone-200/80 bg-[#fbf8f3]/95 px-3 backdrop-blur sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="hidden md:inline-flex" />
              <Link href="/provider/dashboard" className="flex min-w-0 items-center gap-2 md:hidden" aria-label="Provider Hub home">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-teal-800 font-serif text-sm font-semibold text-white">T</span>
              </Link>
              <span className="truncate text-sm font-semibold text-stone-900">{title ?? "Provider Hub"}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ProviderCurrencySelect />
              {user ? <InboxQuickPanel unreadCount={unreadCount} userRole={user.role} /> : null}
            </div>
          </header>
          {/* The app shell already provides the page's <main>. Phones leave room for the tab bar. */}
          <div className="flex-1 overflow-auto overflow-x-hidden pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0" data-provider-scroll>{children}</div>
        </div>
      </div>
      <ProviderBottomNav />
    </SidebarProvider>
  );
}
