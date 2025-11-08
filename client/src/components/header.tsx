import { Link, useLocation } from "wouter";
import { Menu, LogIn, LogOut, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export function Header() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const { isAuthenticated, isLoading } = useAuth();

  const navLinks = [
    { href: "/", label: "Home", testId: "link-nav-home" },
    { href: "/accommodations", label: "Stay", testId: "link-nav-stay" },
    { href: "/services/drive", label: "Drive", testId: "link-nav-drive" },
    { href: "/services/dine", label: "Dine", testId: "link-nav-dine" },
    { href: "/services/relax", label: "Relax", testId: "link-nav-relax" },
    { href: "/blog", label: "Blog", testId: "link-nav-blog" },
    { href: "/bookings", label: "My Bookings", testId: "link-nav-bookings" },
  ];

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    if (href === "/accommodations") return location === "/accommodations" || location.startsWith("/accommodation/");
    if (href.startsWith("/blog")) return location.startsWith("/blog");
    return location === href;
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-8">
        <Link
          href="/"
          className="flex items-center space-x-2"
          data-testid="link-home"
        >
          <span className="font-serif text-xl md:text-2xl font-semibold">Tembea Bila Matata</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center space-x-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-primary ${
                isActive(link.href) ? "text-foreground" : "text-muted-foreground"
              }`}
              data-testid={link.testId}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* Auth Buttons - Desktop */}
          <div className="hidden md:flex items-center gap-2">
            {!isLoading && isAuthenticated && (
              <Button
                variant="ghost"
                size="sm"
                asChild
                data-testid="button-admin"
              >
                <Link href="/admin/dashboard">
                  <Shield className="h-4 w-4 mr-2" />
                  Admin
                </Link>
              </Button>
            )}
            {!isLoading && !isAuthenticated && (
              <Button
                variant="default"
                size="sm"
                asChild
                data-testid="button-login"
              >
                <a href="/api/login">
                  <LogIn className="h-4 w-4 mr-2" />
                  Log In
                </a>
              </Button>
            )}
            {!isLoading && isAuthenticated && (
              <Button
                variant="ghost"
                size="sm"
                asChild
                data-testid="button-logout"
              >
                <a href="/api/logout">
                  <LogOut className="h-4 w-4 mr-2" />
                  Log Out
                </a>
              </Button>
            )}
          </div>
          
          <ThemeToggle />
          
          {/* Mobile Menu */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] sm:w-[350px]">
              <SheetHeader>
                <SheetTitle className="font-serif text-xl">Menu</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col space-y-4 mt-8">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`text-base font-medium transition-colors hover:text-primary py-2 ${
                      isActive(link.href) ? "text-primary font-semibold" : "text-muted-foreground"
                    }`}
                    data-testid={`mobile-${link.testId}`}
                  >
                    {link.label}
                  </Link>
                ))}
                
                {/* Auth Links - Mobile */}
                <div className="pt-4 border-t flex flex-col space-y-3">
                  {!isLoading && isAuthenticated && (
                    <Button
                      variant="outline"
                      className="justify-start"
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
                  {!isLoading && !isAuthenticated && (
                    <Button
                      variant="default"
                      className="justify-start"
                      asChild
                      data-testid="mobile-button-login"
                    >
                      <a href="/api/login">
                        <LogIn className="h-4 w-4 mr-2" />
                        Log In
                      </a>
                    </Button>
                  )}
                  {!isLoading && isAuthenticated && (
                    <Button
                      variant="ghost"
                      className="justify-start"
                      asChild
                      data-testid="mobile-button-logout"
                    >
                      <a href="/api/logout">
                        <LogOut className="h-4 w-4 mr-2" />
                        Log Out
                      </a>
                    </Button>
                  )}
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
