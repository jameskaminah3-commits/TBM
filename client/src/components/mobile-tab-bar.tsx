import { Link, useLocation } from "wouter";
import { House, Building2, Compass, CalendarDays, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavSheet } from "@/hooks/use-nav-sheet";

const TABS = [
  {
    href: "/",
    label: "Home",
    icon: House,
    match: (loc: string) => loc === "/",
  },
  {
    href: "/accommodations",
    label: "Stay",
    icon: Building2,
    match: (loc: string) => loc === "/accommodations" || loc.startsWith("/accommodation/"),
  },
  {
    href: "/services",
    label: "Explore",
    icon: Compass,
    match: (loc: string) =>
      loc === "/services" ||
      loc.startsWith("/services/") ||
      loc.startsWith("/book/experience/") ||
      loc.startsWith("/book/drive/") ||
      loc.startsWith("/book/dine/") ||
      loc.startsWith("/book/relax/"),
  },
  {
    href: "/bookings",
    label: "Trips",
    icon: CalendarDays,
    match: (loc: string) => loc === "/bookings",
  },
] as const;

export function MobileTabBar() {
  const [location] = useLocation();
  const { setOpen } = useNavSheet();

  const isMoreActive =
    !TABS.some((t) => t.match(location)) &&
    !location.startsWith("/auth") &&
    !location.startsWith("/admin") &&
    !location.startsWith("/provider");

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 inset-x-0 z-50 xl:hidden border-t border-border/60 bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/88"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-16 items-stretch">
        {TABS.map(({ href, label, icon: Icon, match }) => {
          const active = match(location);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-1 pt-1 transition-colors duration-150",
                active ? "text-primary" : "text-muted-foreground/80 hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              {active ? (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-primary" />
              ) : null}
              <Icon
                className="h-[1.35rem] w-[1.35rem] transition-transform duration-150"
                strokeWidth={active ? 2.25 : 1.75}
              />
              <span
                className={cn(
                  "text-[0.6rem] font-semibold leading-none tracking-[0.04em]",
                  active ? "text-primary" : "text-muted-foreground/70",
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}

        {/* More — opens the hamburger sheet */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "relative flex flex-1 flex-col items-center justify-center gap-1 pt-1 transition-colors duration-150",
            isMoreActive ? "text-primary" : "text-muted-foreground/80 hover:text-foreground",
          )}
          aria-label="More navigation options"
        >
          {isMoreActive ? (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-primary" />
          ) : null}
          <MoreHorizontal
            className="h-[1.35rem] w-[1.35rem]"
            strokeWidth={isMoreActive ? 2.25 : 1.75}
          />
          <span
            className={cn(
              "text-[0.6rem] font-semibold leading-none tracking-[0.04em]",
              isMoreActive ? "text-primary" : "text-muted-foreground/70",
            )}
          >
            More
          </span>
        </button>
      </div>
    </nav>
  );
}
