import { Suspense, lazy, type ReactNode, useEffect, useRef } from "react";
import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider, useIsFetching } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import { ConciergeSearchBar } from "@/components/concierge-search-bar";
import { SiteFooter } from "@/components/site-footer";
import { TembeaLoader } from "@/components/tembea-loader";
import { CurrencyProvider } from "@/lib/currency";
import { ConciergeSearchProvider, getSectionFromPath } from "@/lib/concierge-search";
import { useRouteMediaReady } from "@/hooks/use-route-media-ready";
import Home from "@/pages/home";

const Accommodations = lazy(() => import("@/pages/accommodations"));
const AccommodationDetail = lazy(() => import("@/pages/accommodation-detail"));
const Booking = lazy(() => import("@/pages/booking"));
const ServiceBooking = lazy(() => import("@/pages/service-booking"));
const ShortBookingLink = lazy(() => import("@/pages/short-booking-link"));
const Bookings = lazy(() => import("@/pages/bookings"));
const DrivePage = lazy(() => import("@/pages/services/drive"));
const DinePage = lazy(() => import("@/pages/services/dine"));
const RelaxPage = lazy(() => import("@/pages/services/relax"));
const ExperiencePage = lazy(() => import("@/pages/services/experience"));
const AdminDashboard = lazy(() => import("@/pages/admin/dashboard"));
const AdminBookings = lazy(() => import("@/pages/admin/bookings"));
const AdminClients = lazy(() => import("@/pages/admin/clients"));
const AdminPayments = lazy(() => import("@/pages/admin/payments"));
const AdminProviders = lazy(() => import("@/pages/admin/providers"));
const AdminListings = lazy(() => import("@/pages/admin/listings"));
const AdminMarketing = lazy(() => import("@/pages/admin/marketing"));
const AdminStaysNew = lazy(() => import("@/pages/admin/stays-new"));
const AdminStaysEdit = lazy(() => import("@/pages/admin/stays-edit"));
const AdminCarsNew = lazy(() => import("@/pages/admin/cars-new"));
const AdminCarsEdit = lazy(() => import("@/pages/admin/cars-edit"));
const AdminCooksNew = lazy(() => import("@/pages/admin/cooks-new"));
const AdminCooksEdit = lazy(() => import("@/pages/admin/cooks-edit"));
const AdminErrandsNew = lazy(() => import("@/pages/admin/errands-new"));
const AdminErrandsEdit = lazy(() => import("@/pages/admin/errands-edit"));
const AdminExperiencesNew = lazy(() => import("@/pages/admin/experiences-new"));
const AdminExperiencesEdit = lazy(() => import("@/pages/admin/experiences-edit"));
const AdminBlog = lazy(() => import("@/pages/admin/blog"));
const Blog = lazy(() => import("@/pages/blog"));
const BlogPost = lazy(() => import("@/pages/blog-post"));
const AboutPage = lazy(async () => ({ default: (await import("@/pages/about")).AboutPage }));
const ContactPage = lazy(async () => ({ default: (await import("@/pages/about")).ContactPage }));
const FaqPage = lazy(async () => ({ default: (await import("@/pages/about")).FaqPage }));
const PrivacyPage = lazy(async () => ({ default: (await import("@/pages/about")).PrivacyPage }));
const TermsPage = lazy(async () => ({ default: (await import("@/pages/about")).TermsPage }));
const RefundCancellationPage = lazy(async () => ({ default: (await import("@/pages/about")).RefundCancellationPage }));
const AuthPage = lazy(() => import("@/pages/auth"));
const InboxPage = lazy(() => import("@/pages/inbox"));
const ProviderDashboard = lazy(() => import("@/pages/provider/dashboard"));
const ProviderStayAvailability = lazy(() => import("@/pages/provider/stay-availability"));
const ProviderStayNew = lazy(() => import("@/pages/provider/stay-new"));
const ProviderCarAvailability = lazy(() => import("@/pages/provider/car-availability"));
const ProviderCarNew = lazy(() => import("@/pages/provider/car-new"));
const ProviderCookNew = lazy(() => import("@/pages/provider/cook-new"));
const ProviderCookEdit = lazy(() => import("@/pages/provider/cook-edit"));
const ProviderErrandNew = lazy(() => import("@/pages/provider/errand-new"));
const ProviderErrandEdit = lazy(() => import("@/pages/provider/errand-edit"));
const ProviderExperienceNew = lazy(() => import("@/pages/provider/experience-new"));
const ProviderExperienceEdit = lazy(() => import("@/pages/provider/experience-edit"));
const CustomServiceRequestPage = lazy(() => import("@/pages/custom-service-request"));
const NotFound = lazy(() => import("@/pages/not-found"));

function AppRoute({ path, element }: { path?: string; element: ReactNode }) {
  return <Route path={path}>{() => element}</Route>;
}

function RouteFallback() {
  return <div data-route-fallback="true" aria-hidden="true" className="hidden" />;
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <AppRoute path="/" element={<Home />} />
        <AppRoute path="/accommodations" element={<Accommodations />} />
        <AppRoute path="/accommodation/:id" element={<AccommodationDetail />} />
        <AppRoute path="/book/:id" element={<Booking />} />
        <AppRoute path="/book/:serviceType/:id" element={<ServiceBooking />} />
        <AppRoute path="/b/:shortType/:code" element={<ShortBookingLink />} />
        <AppRoute path="/bookings" element={<Bookings />} />
        <AppRoute path="/inbox" element={<InboxPage />} />
        <AppRoute path="/request-custom-service" element={<CustomServiceRequestPage />} />
        <AppRoute path="/services/drive" element={<DrivePage />} />
        <AppRoute path="/services/dine" element={<DinePage />} />
        <AppRoute path="/services/relax" element={<RelaxPage />} />
        <AppRoute path="/services/experience" element={<ExperiencePage />} />
        <AppRoute path="/auth" element={<AuthPage />} />
        <AppRoute path="/articles/:slug" element={<BlogPost />} />
        <AppRoute path="/articles" element={<Blog />} />
        <AppRoute path="/blog/:slug" element={<BlogPost />} />
        <AppRoute path="/blog" element={<Blog />} />
        <AppRoute path="/about" element={<AboutPage />} />
        <AppRoute path="/contact" element={<ContactPage />} />
        <AppRoute path="/faq" element={<FaqPage />} />
        <AppRoute path="/privacy" element={<PrivacyPage />} />
        <AppRoute path="/terms" element={<TermsPage />} />
        <AppRoute path="/refund-cancellation" element={<RefundCancellationPage />} />
        <AppRoute path="/admin/dashboard" element={<AdminDashboard />} />
        <AppRoute path="/admin/bookings" element={<AdminBookings />} />
        <AppRoute path="/admin/clients" element={<AdminClients />} />
        <AppRoute path="/admin/payments" element={<AdminPayments />} />
        <AppRoute path="/admin/providers" element={<AdminProviders />} />
        <AppRoute path="/admin/stays/new" element={<AdminStaysNew />} />
        <AppRoute path="/admin/stays/:id/edit" element={<AdminStaysEdit />} />
        <AppRoute path="/admin/cars/new" element={<AdminCarsNew />} />
        <AppRoute path="/admin/cars/:id/edit" element={<AdminCarsEdit />} />
        <AppRoute path="/admin/cooks/new" element={<AdminCooksNew />} />
        <AppRoute path="/admin/cooks/:id/edit" element={<AdminCooksEdit />} />
        <AppRoute path="/admin/errands/new" element={<AdminErrandsNew />} />
        <AppRoute path="/admin/errands/:id/edit" element={<AdminErrandsEdit />} />
        <AppRoute path="/admin/experiences/new" element={<AdminExperiencesNew />} />
        <AppRoute path="/admin/experiences/:id/edit" element={<AdminExperiencesEdit />} />
        <AppRoute path="/admin/listings" element={<AdminListings />} />
        <AppRoute path="/admin/marketing" element={<AdminMarketing />} />
        <AppRoute path="/admin/blog" element={<AdminBlog />} />
        <AppRoute path="/provider/dashboard" element={<ProviderDashboard />} />
        <AppRoute path="/provider/stays/new" element={<ProviderStayNew />} />
        <AppRoute path="/provider/stays/:id/availability" element={<ProviderStayAvailability />} />
        <AppRoute path="/provider/cars/new" element={<ProviderCarNew />} />
        <AppRoute path="/provider/cars/:id/availability" element={<ProviderCarAvailability />} />
        <AppRoute path="/provider/cooks/new" element={<ProviderCookNew />} />
        <AppRoute path="/provider/cooks/:id/edit" element={<ProviderCookEdit />} />
        <AppRoute path="/provider/errands/new" element={<ProviderErrandNew />} />
        <AppRoute path="/provider/errands/:id/edit" element={<ProviderErrandEdit />} />
        <AppRoute path="/provider/experiences/new" element={<ProviderExperienceNew />} />
        <AppRoute path="/provider/experiences/:id/edit" element={<ProviderExperienceEdit />} />
        <AppRoute element={<NotFound />} />
      </Switch>
    </Suspense>
  );
}

function AppShell() {
  const [location] = useLocation();
  const routeContainerRef = useRef<HTMLDivElement | null>(null);
  const blockingFetchCount = useIsFetching();
  const isRouteMediaReady = useRouteMediaReady(location, routeContainerRef, blockingFetchCount);
  const currentSection = getSectionFromPath(location);
  const isAdminRoute = location.startsWith("/admin/");
  const isProviderRoute = location.startsWith("/provider/");
  const isDashboardRoute = isAdminRoute || isProviderRoute;
  const isAuthRoute = location.startsWith("/auth");
  const shouldShowHeader = !isAuthRoute && !isProviderRoute;
  const shouldShowSiteChrome = !isAuthRoute && !isDashboardRoute;

  useEffect(() => {
    if (typeof window === "undefined" || location.includes("#")) {
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location]);

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col">
        {shouldShowHeader ? <Header /> : null}
        {shouldShowSiteChrome && currentSection ? <ConciergeSearchBar currentSection={currentSection} /> : null}
        <main className="relative flex-1">
          <div ref={routeContainerRef}>
            <Router />
          </div>

          {!isRouteMediaReady ? (
            <div className="fixed inset-0 z-[140] bg-[rgba(255,250,244,0.94)] backdrop-blur-[2px]">
              <TembeaLoader className="min-h-screen" />
            </div>
          ) : null}
        </main>
        {!isDashboardRoute && !isAuthRoute ? <SiteFooter /> : null}
      </div>
      <Toaster />
    </TooltipProvider>
  );
}

function App() {
  const [location] = useLocation();
  const isDashboardRoute = location.startsWith("/admin/") || location.startsWith("/provider/");

  return (
    <QueryClientProvider client={queryClient}>
      <CurrencyProvider preferredCurrency={isDashboardRoute ? "KES" : undefined}>
        <ConciergeSearchProvider>
          <ThemeProvider defaultTheme="light">
            <AppShell />
          </ThemeProvider>
        </ConciergeSearchProvider>
      </CurrencyProvider>
    </QueryClientProvider>
  );
}

export default App;
