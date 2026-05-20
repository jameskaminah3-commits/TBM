import { Link, useLocation } from "wouter";
import {
  Menu,
  LogIn,
  LogOut,
  Shield,
  BriefcaseBusiness,
  Bell,
  House,
  Building2,
  CarFront,
  UtensilsCrossed,
  Sparkles,
  Compass,
  CalendarDays,
  Newspaper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InboxQuickPanel } from "@/components/inbox-quick-panel";
import { ThemeToggle } from "./theme-toggle";
import { BrandMark } from "./brand-mark";
import { useCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useInbox } from "@/hooks/use-inbox";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";

export function Header() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const { user, isAuthenticated, isLoading, isAdmin, isProvider } = useAuth();
  const { selectedCurrency, setSelectedCurrency } = useCurrency();
  const { unreadCount } = useInbox({ enabled: isAuthenticated, refetchInterval: 15000 });
  const isInboxRoute = location === "/inbox";

  const handleLogout = async () => {
    await apiRequest("POST", "/api/logout");
    await supabase?.auth.signOut({ scope: "local" });
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    window.location.href = "/";
  };

  const navLinks = [
    { href: "/", label: "Home", description: "Featured stays and services", icon: House, testId: "link-nav-home" },
    { href: "/accommodations", label: "Stay", description: "Villas, suites, and homes", icon: Building2, testId: "link-nav-stay" },
    { href: "/services/drive", label: "Drive", description: "Airport transfers and rides", icon: CarFront, testId: "link-nav-drive" },
    { href: "/services/dine", label: "Dine", description: "Private chefs and dining", icon: UtensilsCrossed, testId: "link-nav-dine" },
    { href: "/services/relax", label: "Relax", description: "Errands, laundry, and support", icon: Sparkles, testId: "link-nav-relax" },
    { href: "/services/experience", label: "Experience", description: "Curated outings and moments", icon: Compass, testId: "link-nav-experience" },
    { href: "/blog", label: "Articles", description: "Coast travel guides and tips", icon: Newspaper, testId: "link-nav-blog" },
    ...(isAuthenticated
      ? [{ href: "/bookings", label: "My Bookings", shortLabel: "Bookings", description: "Trips, updates, and status", icon: CalendarDays, testId: "link-nav-bookings" }]
      : []),
  ];

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    if (href === "/accommodations") return location === "/accommodations" || location.startsWith("/accommodation/");
    if (href === "/services/experience") return location === "/services/experience" || location.startsWith("/book/experience/");
    if (href.startsWith("/blog")) return location.startsWith("/blog");
    return location === href;
  };

  const currencyOptions = [
    { value: "USD" as const, label: "USD" },
    { value: "KES" as const, label: "KSH" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/94 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.28)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/84">
      <div className="container mx-auto flex h-[4.7rem] min-w-0 items-center gap-2 px-4 md:gap-3 md:px-6 xl:gap-4 xl:px-8">
        <div className="flex min-w-0 flex-1 items-center xl:min-w-[18rem] xl:flex-none xl:pr-2 2xl:min-w-[20rem]">
          <Link
            href="/"
            className="group flex min-w-0 flex-1 items-center gap-3 xl:flex-none xl:gap-3.5 xl:rounded-[1.4rem] xl:border xl:border-border/70 xl:bg-[linear-gradient(180deg,hsl(var(--background)/0.98),hsl(var(--muted)/0.45))] xl:px-3.5 xl:py-2 xl:shadow-[0_18px_34px_-30px_rgba(15,23,42,0.45)]"
            data-testid="link-home"
          >
            <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.18),hsl(var(--card)/0.95)_72%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] xl:flex">
              <BrandMark className="h-8" />
            </div>
            <BrandMark className="h-7 shrink-0 sm:h-9 xl:hidden" />
            <div className="min-w-0 flex-1 xl:flex-none xl:pr-1">
              <div className="max-w-[13.25rem] font-serif text-[1.08rem] font-semibold leading-[0.88] tracking-[0.045em] text-foreground sm:max-w-none sm:text-[1.02rem] sm:font-medium sm:leading-[0.92] xl:whitespace-nowrap xl:text-[1rem] xl:font-semibold xl:leading-none xl:tracking-[0.035em] 2xl:text-[1.08rem]">
                Tembea Bila Matata
              </div>
              <div className="hidden text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/75 xl:block">
                Travel without worries
              </div>
            </div>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 px-2 xl:flex 2xl:gap-1 2xl:px-5">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-full px-2.5 py-2 text-[0.9rem] font-medium transition-colors 2xl:px-3.5 2xl:text-[0.96rem]",
                isActive(link.href)
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
              data-testid={link.testId}
            >
              {"shortLabel" in link ? (
                <>
                  <span className="2xl:hidden">{link.shortLabel}</span>
                  <span className="hidden 2xl:inline">{link.label}</span>
                </>
              ) : (
                link.label
              )}
            </Link>
          ))}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2 xl:flex-none xl:gap-1.5 xl:shrink-0">
          <div className="hidden items-center rounded-full border border-border/70 bg-gradient-to-b from-background via-background to-muted/60 p-[3px] shadow-[0_10px_30px_-18px_rgba(15,23,42,0.9)] xl:flex">
            {currencyOptions.map((option) => {
              const isSelected = selectedCurrency === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedCurrency(option.value)}
                  className={cn(
                    "min-w-[68px] rounded-full px-3.5 py-2 text-[0.68rem] font-semibold tracking-[0.18em] transition-all duration-200",
                    isSelected
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={option.value === "USD" ? "select-currency-usd" : "select-currency-kes"}
                  aria-pressed={isSelected}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {!isLoading && isAuthenticated && !isInboxRoute && !isMobile ? (
            <InboxQuickPanel unreadCount={unreadCount} userRole={user?.role} />
          ) : null}

          {/* Auth Buttons - Desktop */}
          <div className="hidden items-center gap-1.5 xl:flex">
            {!isLoading && isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="min-h-10 rounded-full px-3 text-[0.9rem] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                data-testid="button-admin"
              >
                <Link href="/admin/dashboard">
                  <Shield className="h-4 w-4 mr-2" />
                  Admin
                </Link>
              </Button>
            )}
            {!isLoading && isProvider && !isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="min-h-10 rounded-full px-3 text-[0.9rem] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                data-testid="button-provider"
              >
                <Link href="/provider/dashboard">
                  <BriefcaseBusiness className="h-4 w-4 mr-2" />
                  Partner
                </Link>
              </Button>
            )}
            {!isLoading && !isAuthenticated && (
              <Button
                variant="default"
                size="sm"
                asChild
                className="min-h-10 rounded-full px-4 text-[0.9rem] shadow-[0_14px_30px_-20px_rgba(15,23,42,0.55)]"
                data-testid="button-login"
              >
                <Link href={`/auth?next=${encodeURIComponent(location)}`}>
                  <LogIn className="h-4 w-4 mr-2" />
                  Log In
                </Link>
              </Button>
            )}
            {!isLoading && isAuthenticated && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-10 rounded-full px-3 text-[0.9rem] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                onClick={handleLogout}
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Log Out
              </Button>
            )}
          </div>

          <div className="hidden xl:block">
            <ThemeToggle />
          </div>
          
          {/* Mobile Menu */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild className="xl:hidden">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full border border-border/70 bg-gradient-to-b from-background via-background to-muted/50 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.7)]"
                data-testid="button-mobile-menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="surface-drawer inset-y-3 right-3 flex h-[calc(100vh-1.5rem)] w-[calc(100vw-1.25rem)] max-w-[360px] flex-col overflow-hidden rounded-[2rem] border p-3.5 sm:w-[86vw] sm:p-4"
            >
              <SheetHeader className="surface-panel rounded-[1.5rem] border px-4 py-4 text-left">
                <div className="flex items-center gap-3 pr-10">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.15rem] bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.18),hsl(var(--card)/0.96)_68%)]">
                    <BrandMark className="h-7" />
                  </div>
                  <div className="min-w-0">
                    <SheetTitle className="truncate font-serif text-[1.02rem] tracking-[0.05em] text-foreground">
                      Tembea Bila Matata
                    </SheetTitle>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      Plan your Coast, without the chaos
                    </p>
                  </div>
                </div>
              </SheetHeader>
              <nav className="mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto pb-4 pr-1">
                <div className="mb-3 px-2 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Explore
                </div>
                <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2">
                  {navLinks.map((link) => {
                    const Icon = link.icon;
                    const active = isActive(link.href);

                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "rounded-[1.35rem] border p-4 transition-all duration-200",
                          active
                            ? "border-primary/40 bg-primary/10 shadow-[0_18px_34px_-28px_rgba(13,148,136,0.7)]"
                            : "border-border/70 bg-card/75 hover:border-border hover:bg-card/90 hover:shadow-[0_18px_34px_-30px_rgba(15,23,42,0.25)]",
                        )}
                        data-testid={`mobile-${link.testId}`}
                      >
                        <div
                          className={cn(
                            "mb-5 flex h-10 w-10 items-center justify-center rounded-xl",
                            active ? "bg-card/85 text-primary" : "bg-muted/75 text-muted-foreground",
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="text-[1rem] font-semibold text-foreground">
                          {link.label}
                        </div>
                        <div className={cn("mt-1 text-xs leading-5", active ? "text-foreground/72" : "text-muted-foreground")}>
                          {link.description}
                        </div>
                      </Link>
                    );
                  })}
                </div>
                
                {/* Auth Links - Mobile */}
                <div className="mt-5 space-y-4">
                  <div className="surface-panel rounded-[1.5rem] border p-4">
                    <div className="mb-3 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Preferences
                    </div>
                    <Select value={selectedCurrency} onValueChange={(value) => setSelectedCurrency(value as "USD" | "KES")}>
                      <SelectTrigger className="h-12 rounded-[1rem] border-border/70 bg-background/75 shadow-sm" data-testid="mobile-select-currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="KES">KSH</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="mt-3 flex items-center justify-between rounded-[1rem] border border-border/70 bg-background/75 px-4 py-3 shadow-sm">
                      <div>
                        <div className="text-sm font-medium text-foreground">Theme</div>
                        <div className="text-xs text-muted-foreground">Light and dark mode</div>
                      </div>
                      <ThemeToggle testId="mobile-button-theme-toggle" />
                    </div>
                  </div>

                  <div className="surface-panel rounded-[1.5rem] border p-4">
                    <div className="mb-3 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Account
                    </div>
                    <div className="space-y-3">
                      {!isLoading && isAdmin && (
                        <Button
                          variant="outline"
                          className="h-12 justify-start rounded-[1rem] border-border/70 bg-background/75"
                          asChild
                          data-testid="mobile-button-admin"
                          onClick={() => setOpen(false)}
                        >
                          <Link href="/admin/dashboard">
                            <Shield className="h-4 w-4 mr-2" />
                            Admin
                          </Link>
                        </Button>
                      )}
                      {!isLoading && isAuthenticated && (
                        <Button
                          variant="outline"
                          className="h-12 justify-start rounded-[1rem] border-border/70 bg-background/75"
                          asChild
                          data-testid="mobile-button-inbox"
                          onClick={() => setOpen(false)}
                        >
                          <Link href="/inbox">
                            <Bell className="h-4 w-4 mr-2" />
                            Inbox
                            {unreadCount ? ` (${unreadCount > 99 ? "99+" : unreadCount})` : ""}
                          </Link>
                        </Button>
                      )}
                      {!isLoading && isProvider && !isAdmin && (
                        <Button
                          variant="outline"
                          className="h-12 justify-start rounded-[1rem] border-border/70 bg-background/75"
                          asChild
                          data-testid="mobile-button-provider"
                          onClick={() => setOpen(false)}
                        >
                          <Link href="/provider/dashboard">
                            <BriefcaseBusiness className="h-4 w-4 mr-2" />
                            Partner
                          </Link>
                        </Button>
                      )}
                      {!isLoading && !isAuthenticated && (
                        <Button
                          variant="default"
                          className="h-12 justify-start rounded-[1rem]"
                          asChild
                          data-testid="mobile-button-login"
                        >
                          <Link href={`/auth?next=${encodeURIComponent(location)}`} onClick={() => setOpen(false)}>
                            <LogIn className="h-4 w-4 mr-2" />
                            Log In
                          </Link>
                        </Button>
                      )}
                      {!isLoading && isAuthenticated && (
                        <Button
                          variant="ghost"
                          className="h-12 justify-start rounded-[1rem]"
                          onClick={async () => {
                            setOpen(false);
                            await handleLogout();
                          }}
                          data-testid="mobile-button-logout"
                        >
                          <LogOut className="h-4 w-4 mr-2" />
                          Log Out
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
