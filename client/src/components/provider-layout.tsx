import { Link, useLocation } from "wouter";
import { Bell, BriefcaseBusiness, CalendarRange } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { InboxQuickPanel } from "@/components/inbox-quick-panel";
import { useAuth } from "@/hooks/useAuth";
import { useInbox } from "@/hooks/use-inbox";
import { useCurrency } from "@/lib/currency";
import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function ProviderSidebar() {
  const [location] = useLocation();
  const { user, isAdmin } = useAuth();
  const { unreadCount } = useInbox({ enabled: Boolean(user && (user.role === "provider" || user.role === "admin")) });
  const providerTypes = user?.providerTypes ?? [];

  const menuItems = [
    {
      title: "Dashboard",
      url: "/provider/dashboard",
      icon: BriefcaseBusiness,
    },
    {
      title: "Inbox",
      url: "/inbox",
      icon: Bell,
    },
  ];

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <CalendarRange className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Partner</span>
            <span className="text-xs text-muted-foreground">
              {isAdmin || providerTypes.length === 0 ? "Assigned work" : `${providerTypes.length} workspace${providerTypes.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} className="flex w-full items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <item.icon />
                        <span>{item.title}</span>
                      </span>
                      {item.url === "/inbox" && unreadCount ? (
                        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      ) : null}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
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
        <SelectItem value="KES">KSH</SelectItem>
        <SelectItem value="USD">USD</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function ProviderLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { unreadCount } = useInbox({ enabled: Boolean(user && (user.role === "provider" || user.role === "admin")), refetchInterval: 15000 });
  const style = {
    "--sidebar-width": "16rem",
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
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <ProviderSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-background/95 px-3 py-3 backdrop-blur sm:px-4">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <ProviderCurrencySelect />
              {user ? <InboxQuickPanel unreadCount={unreadCount} userRole={user.role} /> : null}
            </div>
          </header>
          <main className="flex-1 overflow-auto overflow-x-hidden">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
