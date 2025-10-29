import { Link, useLocation } from "wouter";
import { Home, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";

export function Header() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-8">
        <Link href="/">
          <a className="flex items-center space-x-2" data-testid="link-home">
            <span className="font-serif text-2xl font-semibold">Luxescape</span>
          </a>
        </Link>

        <nav className="hidden md:flex items-center space-x-6">
          <Link href="/">
            <a
              className={`text-sm font-medium transition-colors hover:text-primary ${
                location === "/" ? "text-foreground" : "text-muted-foreground"
              }`}
              data-testid="link-nav-home"
            >
              Home
            </a>
          </Link>
          <Link href="/accommodations">
            <a
              className={`text-sm font-medium transition-colors hover:text-primary ${
                location === "/accommodations" ? "text-foreground" : "text-muted-foreground"
              }`}
              data-testid="link-nav-accommodations"
            >
              Accommodations
            </a>
          </Link>
          <Link href="/bookings">
            <a
              className={`text-sm font-medium transition-colors hover:text-primary ${
                location === "/bookings" ? "text-foreground" : "text-muted-foreground"
              }`}
              data-testid="link-nav-bookings"
            >
              My Bookings
            </a>
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="md:hidden">
            <Button variant="ghost" size="icon" data-testid="button-menu">
              <User className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
