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
import AdminClients from "@/pages/admin/clients";
import AdminListings from "@/pages/admin/listings";
import AdminStaysNew from "@/pages/admin/stays-new";
import AdminStaysEdit from "@/pages/admin/stays-edit";
import AdminCarsNew from "@/pages/admin/cars-new";
import AdminCarsEdit from "@/pages/admin/cars-edit";
import AdminCooksNew from "@/pages/admin/cooks-new";
import AdminCooksEdit from "@/pages/admin/cooks-edit";
import AdminErrandsNew from "@/pages/admin/errands-new";
import AdminErrandsEdit from "@/pages/admin/errands-edit";
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
      <Route path="/book/:serviceType/:id" component={ServiceBooking} />
      <Route path="/bookings" component={Bookings} />
      <Route path="/services/drive" component={DrivePage} />
      <Route path="/services/dine" component={DinePage} />
      <Route path="/services/relax" component={RelaxPage} />
      <Route path="/blog/:slug" component={BlogPost} />
      <Route path="/blog" component={Blog} />
      <Route path="/admin/dashboard" component={AdminDashboard} />
      <Route path="/admin/bookings" component={AdminBookings} />
      <Route path="/admin/clients" component={AdminClients} />
      <Route path="/admin/stays/new" component={AdminStaysNew} />
      <Route path="/admin/stays/:id/edit" component={AdminStaysEdit} />
      <Route path="/admin/cars/new" component={AdminCarsNew} />
      <Route path="/admin/cars/:id/edit" component={AdminCarsEdit} />
      <Route path="/admin/cooks/new" component={AdminCooksNew} />
      <Route path="/admin/cooks/:id/edit" component={AdminCooksEdit} />
      <Route path="/admin/errands/new" component={AdminErrandsNew} />
      <Route path="/admin/errands/:id/edit" component={AdminErrandsEdit} />
      <Route path="/admin/listings" component={AdminListings} />
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
