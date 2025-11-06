import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import Home from "@/pages/home";
import Accommodations from "@/pages/accommodations";
import AccommodationDetail from "@/pages/accommodation-detail";
import Booking from "@/pages/booking";
import ServiceBooking from "@/pages/service-booking";
import Bookings from "@/pages/bookings";
import DrivePage from "@/pages/services/drive";
import DinePage from "@/pages/services/dine";
import RelaxPage from "@/pages/services/relax";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminBookings from "@/pages/admin/bookings";
import AdminBlog from "@/pages/admin/blog";
import Blog from "@/pages/blog";
import BlogPost from "@/pages/blog-post";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/accommodations" component={Accommodations} />
      <Route path="/accommodation/:id" component={AccommodationDetail} />
      <Route path="/book/:id" component={Booking} />
      <Route path="/book/service/:id" component={ServiceBooking} />
      <Route path="/bookings" component={Bookings} />
      <Route path="/services/drive" component={DrivePage} />
      <Route path="/services/dine" component={DinePage} />
      <Route path="/services/relax" component={RelaxPage} />
      <Route path="/blog/:slug" component={BlogPost} />
      <Route path="/blog" component={Blog} />
      <Route path="/admin/dashboard" component={AdminDashboard} />
      <Route path="/admin/bookings" component={AdminBookings} />
      <Route path="/admin/blog" component={AdminBlog} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">
              <Router />
            </main>
          </div>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
