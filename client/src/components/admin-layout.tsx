import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Calendar,
  FileText,
  List,
  Plus,
  ChevronDown,
  Home,
  Car,
  ChefHat,
  Briefcase,
  Users,
  Handshake,
  Compass,
  Wallet,
  Megaphone,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEffect } from "react";

const menuItems = [
  {
    title: "Dashboard",
    url: "/admin/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Bookings",
    url: "/admin/bookings",
    icon: Calendar,
  },
  {
    title: "Clients",
    url: "/admin/clients",
    icon: Users,
  },
  {
    title: "Payments",
    url: "/admin/payments",
    icon: Wallet,
  },
  {
    title: "Providers",
    url: "/admin/providers",
    icon: Handshake,
  },
  {
    title: "Listings",
    url: "/admin/listings",
    icon: List,
  },
  {
    title: "Marketing",
    url: "/admin/marketing",
    icon: Megaphone,
  },
  {
    title: "Blog",
    url: "/admin/blog",
    icon: FileText,
  },
];

const addListingOptions = [
  {
    title: "Add Stay",
    url: "/admin/stays/new",
    icon: Home,
    testId: "link-add-stay",
  },
  {
    title: "Add Car",
    url: "/admin/cars/new",
    icon: Car,
    testId: "link-add-car",
  },
  {
    title: "Add Cook",
    url: "/admin/cooks/new",
    icon: ChefHat,
    testId: "link-add-cook",
  },
  {
    title: "Add Errand",
    url: "/admin/errands/new",
    icon: Briefcase,
    testId: "link-add-errand",
  },
  {
    title: "Add Experience",
    url: "/admin/experiences/new",
    icon: Compass,
    testId: "link-add-experience",
  },
];

function AdminSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LayoutDashboard className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Admin Panel</span>
            <span className="text-xs text-muted-foreground">Management</span>
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
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`link-admin-${item.title.toLowerCase()}`}
                  >
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton data-testid="button-add-listing">
                      <Plus />
                      <span>Add Listing</span>
                      <ChevronDown className="ml-auto h-4 w-4" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start" className="w-48">
                    {addListingOptions.map((option) => (
                      <DropdownMenuItem key={option.title} asChild>
                        <Link href={option.url} data-testid={option.testId}>
                          <option.icon className="mr-2 h-4 w-4" />
                          {option.title}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

interface AdminLayoutProps {
  children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
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
      <div className="flex h-[calc(100svh-4.7rem)] min-h-[calc(100svh-4.7rem)] w-full overflow-hidden bg-background">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center border-b px-3 py-3 sm:px-4">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <main className="flex-1 overflow-auto overflow-x-hidden">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
