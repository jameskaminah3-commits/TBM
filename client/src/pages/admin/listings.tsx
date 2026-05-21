import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Briefcase,
  CarFront,
  Copy,
  CookingPot,
  Edit,
  ExternalLink,
  Eye,
  EyeOff,
  Home,
  MapPin,
  Plus,
  Search,
  Share2,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getShortShareUrl, type ShareServiceType } from "@/lib/share-links";
import { getCookCustomMenuRequestFee, getCookExtraGuestInclusivePrice, getCookExtraGuestServiceFee, getCookInclusivePrice, getCookMinimumGuests, getCookServiceFee } from "@shared/cook-pricing";
import { getHelpMamaStartingPrice, hasHelpMamaPricing } from "@shared/errand-pricing";
import type { Stay, Car as CarType, Cook as CookType, Errand as ErrandType, Experience as ExperienceType } from "@shared/schema";

type ServiceCategory = "stays" | "cars" | "cooks" | "errands" | "experiences";
type VisibilityFilter = "all" | "public" | "private";

const shareServiceTypeByCategory: Record<ServiceCategory, ShareServiceType> = {
  stays: "stay",
  cars: "car",
  cooks: "cook",
  errands: "errand",
  experiences: "experience",
};

const serviceMeta: Record<ServiceCategory, {
  label: string;
  pluralLabel: string;
  description: string;
  addLabel: string;
  addPath: string;
  emptyDescription: string;
  icon: LucideIcon;
}> = {
  stays: {
    label: "Stay",
    pluralLabel: "Stays",
    description: "Accommodation listings, visibility, and occupancy details.",
    addLabel: "Add Stay",
    addPath: "/admin/stays/new",
    emptyDescription: "No stays yet. Create your first stay to get started.",
    icon: Home,
  },
  cars: {
    label: "Car",
    pluralLabel: "Cars",
    description: "Rental vehicles, pricing, and availability details.",
    addLabel: "Add Car",
    addPath: "/admin/cars/new",
    emptyDescription: "No cars yet. Create your first car to get started.",
    icon: CarFront,
  },
  cooks: {
    label: "Chef",
    pluralLabel: "Cooks",
    description: "Chef profiles, guest limits, and pricing settings.",
    addLabel: "Add Chef",
    addPath: "/admin/cooks/new",
    emptyDescription: "No chefs yet. Create your first chef to get started.",
    icon: CookingPot,
  },
  errands: {
    label: "Errand",
    pluralLabel: "Errands",
    description: "Errand service offerings, add-ons, and descriptions.",
    addLabel: "Add Errand",
    addPath: "/admin/errands/new",
    emptyDescription: "No errands yet. Create your first errand to get started.",
    icon: Briefcase,
  },
  experiences: {
    label: "Experience",
    pluralLabel: "Experiences",
    description: "Experience packages, guest ranges, and visibility controls.",
    addLabel: "Add Experience",
    addPath: "/admin/experiences/new",
    emptyDescription: "No experiences yet. Create your first experience to get started.",
    icon: Sparkles,
  },
};

function AdminStatCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string | number;
  description: string;
}) {
  return (
    <Card className="border-stone-200/80 bg-white shadow-sm">
      <CardContent className="space-y-1.5 p-4 sm:p-5">
        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </div>
        <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function ListingSkeletonGrid() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="border-stone-200/80 bg-white shadow-sm">
          <CardContent className="space-y-4 p-5">
            <div className="h-5 w-40 rounded bg-stone-200/80" />
            <div className="h-4 w-56 rounded bg-stone-100" />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="h-16 rounded-2xl bg-stone-100" />
              <div className="h-16 rounded-2xl bg-stone-100" />
              <div className="h-16 rounded-2xl bg-stone-100" />
            </div>
            <div className="h-10 rounded-xl bg-stone-100" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ListingEmptyState({
  description,
  actionLabel,
  onAction,
  testId,
}: {
  description: string;
  actionLabel: string;
  onAction: () => void;
  testId?: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-stone-300 bg-stone-50/60 px-5 py-12 text-center">
      <p className="mx-auto mb-4 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      <Button onClick={onAction} data-testid={testId}>
        <Plus className="mr-2 h-4 w-4" />
        {actionLabel}
      </Button>
    </div>
  );
}

function matchesVisibility(isPublic: boolean, filter: VisibilityFilter) {
  return filter === "all"
    || (filter === "public" && isPublic)
    || (filter === "private" && !isPublic);
}

function getDescriptionPreview(value: string | null | undefined) {
  if (!value) {
    return "No description added yet.";
  }

  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function getPublicListingPath(category: ServiceCategory, id: string) {
  switch (category) {
    case "stays":
      return `/accommodation/${id}`;
    case "cars":
      return `/book/car/${id}`;
    case "cooks":
      return `/book/cook/${id}`;
    case "errands":
      return `/book/errand/${id}`;
    case "experiences":
      return `/book/experience/${id}`;
  }
}

function getPublicListingUrl(category: ServiceCategory, id: string) {
  const path = getPublicListingPath(category, id);
  if (typeof window === "undefined") {
    return path;
  }

  return new URL(path, window.location.origin).toString();
}

function getPublicShareUrl(category: ServiceCategory, id: string, currency: "USD" | "KES") {
  return getShortShareUrl(
    shareServiceTypeByCategory[category],
    id,
    typeof window === "undefined" ? undefined : window.location.origin,
    currency,
  );
}

export default function AdminListings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { formatAmount, usdToKes, selectedCurrency } = useCurrency();
  const [activeTab, setActiveTab] = useState<ServiceCategory>("stays");
  const [searchTerm, setSearchTerm] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");

  // Fetch data for each service type
  const { data: stays = [], isLoading: isLoadingStays } = useQuery<Stay[]>({
    queryKey: ["/api/admin/stays"],
  });

  const { data: cars = [], isLoading: isLoadingCars } = useQuery<CarType[]>({
    queryKey: ["/api/admin/cars"],
  });

  const { data: cooks = [], isLoading: isLoadingCooks } = useQuery<CookType[]>({
    queryKey: ["/api/admin/cooks"],
  });

  const { data: errands = [], isLoading: isLoadingErrands } = useQuery<ErrandType[]>({
    queryKey: ["/api/admin/errands"],
  });

  const { data: experiences = [], isLoading: isLoadingExperiences } = useQuery<ExperienceType[]>({
    queryKey: ["/api/admin/experiences"],
  });

  const deleteStayMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/stays/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stays"] });
      toast({ title: "Success", description: "Stay deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete stay", variant: "destructive" });
    },
  });

  const deleteCarMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/cars/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cars"] });
      toast({ title: "Success", description: "Car deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete car", variant: "destructive" });
    },
  });

  const deleteCookMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/cooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cooks"] });
      toast({ title: "Success", description: "Cook deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete cook", variant: "destructive" });
    },
  });

  const deleteErrandMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/errands/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/errands"] });
      toast({ title: "Success", description: "Errand deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete errand", variant: "destructive" });
    },
  });

  const deleteExperienceMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/experiences/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/experiences"] });
      toast({ title: "Success", description: "Experience deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete experience", variant: "destructive" });
    },
  });

  const updateExperienceVisibilityMutation = useMutation({
    mutationFn: async ({ id, isPublic }: { id: string; isPublic: boolean }) =>
      apiRequest("PATCH", `/api/admin/experiences/${id}`, { isPublic }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/experiences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/experiences"] });
      toast({ title: "Success", description: "Experience visibility updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update experience visibility", variant: "destructive" });
    },
  });

  const normalizedQuery = searchTerm.trim().toLowerCase();

  const filteredStays = useMemo(
    () => stays.filter((stay) =>
      matchesVisibility(stay.isPublic, visibilityFilter)
      && [
        stay.title,
        stay.location,
        stay.description,
      ].join(" ").toLowerCase().includes(normalizedQuery)),
    [normalizedQuery, stays, visibilityFilter],
  );

  const filteredCars = useMemo(
    () => cars.filter((car) =>
      matchesVisibility(car.isPublic, visibilityFilter)
      && [
        car.model,
        car.location,
        car.transmission,
        car.description,
      ].join(" ").toLowerCase().includes(normalizedQuery)),
    [cars, normalizedQuery, visibilityFilter],
  );

  const filteredCooks = useMemo(
    () => cooks.filter((cook) =>
      matchesVisibility(cook.isPublic, visibilityFilter)
      && [
        cook.title,
        cook.location,
        cook.serviceType,
        cook.speciality,
      ].join(" ").toLowerCase().includes(normalizedQuery)),
    [cooks, normalizedQuery, visibilityFilter],
  );

  const filteredErrands = useMemo(
    () => errands.filter((errand) =>
      matchesVisibility(errand.isPublic, visibilityFilter)
      && [
        errand.serviceName,
        errand.location,
        errand.description,
      ].join(" ").toLowerCase().includes(normalizedQuery)),
    [errands, normalizedQuery, visibilityFilter],
  );

  const filteredExperiences = useMemo(
    () => experiences.filter((experience) =>
      matchesVisibility(experience.isPublic, visibilityFilter)
      && [
        experience.title,
        experience.location,
        experience.experienceLocation,
        experience.experienceType,
        experience.description,
      ].join(" ").toLowerCase().includes(normalizedQuery)),
    [experiences, normalizedQuery, visibilityFilter],
  );

  const activeCounts = {
    total: {
      stays: filteredStays.length,
      cars: filteredCars.length,
      cooks: filteredCooks.length,
      errands: filteredErrands.length,
      experiences: filteredExperiences.length,
    },
    public: {
      stays: filteredStays.filter((stay) => stay.isPublic).length,
      cars: filteredCars.filter((car) => car.isPublic).length,
      cooks: filteredCooks.filter((cook) => cook.isPublic).length,
      errands: filteredErrands.filter((errand) => errand.isPublic).length,
      experiences: filteredExperiences.filter((experience) => experience.isPublic).length,
    },
  };

  const activeTotal = activeCounts.total[activeTab];
  const activePublic = activeCounts.public[activeTab];
  const activePrivate = activeTotal - activePublic;
  const activeMeta = serviceMeta[activeTab];

  const handleDelete = async (id: string, category: ServiceCategory) => {
    switch (category) {
      case "stays":
        await deleteStayMutation.mutateAsync(id);
        break;
      case "cars":
        await deleteCarMutation.mutateAsync(id);
        break;
      case "cooks":
        await deleteCookMutation.mutateAsync(id);
        break;
      case "errands":
        await deleteErrandMutation.mutateAsync(id);
        break;
      case "experiences":
        await deleteExperienceMutation.mutateAsync(id);
        break;
    }
  };

  const handlePreviewListing = (category: ServiceCategory, id: string, isPublic: boolean) => {
    if (!isPublic) {
      toast({
        title: "Listing is private",
        description: "Make it public before previewing the client-facing link.",
      });
      return;
    }

    window.open(getPublicListingUrl(category, id), "_blank", "noopener,noreferrer");
  };

  const handleShareListing = async (category: ServiceCategory, id: string, title: string, isPublic: boolean) => {
    if (!isPublic) {
      toast({
        title: "Listing is private",
        description: "Make it public before sharing the client-facing link.",
      });
      return;
    }

    const url = getPublicShareUrl(category, id, selectedCurrency);
    const webNavigator = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      clipboard?: Clipboard;
    };
    try {
      if (typeof webNavigator.share === "function") {
        await webNavigator.share({ title, url });
        return;
      }

      if (!webNavigator.clipboard) {
        throw new Error("Clipboard is unavailable");
      }

      await webNavigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "The listing link is ready to paste." });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      try {
        if (!webNavigator.clipboard) {
          throw new Error("Clipboard is unavailable");
        }

        await webNavigator.clipboard.writeText(url);
        toast({ title: "Link copied", description: "The listing link is ready to paste." });
      } catch {
        toast({ title: "Could not share link", description: url, variant: "destructive" });
      }
    }
  };

  const renderListingShareActions = (
    category: ServiceCategory,
    id: string,
    title: string,
    isPublic: boolean,
  ) => (
    <>
      <Button
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => handlePreviewListing(category, id, isPublic)}
      >
        <ExternalLink className="mr-2 h-4 w-4" />
        Preview
      </Button>
      <Button
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => handleShareListing(category, id, title, isPublic)}
      >
        {typeof navigator !== "undefined" && typeof (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share === "function" ? (
          <Share2 className="mr-2 h-4 w-4" />
        ) : (
          <Copy className="mr-2 h-4 w-4" />
        )}
        Share
      </Button>
    </>
  );

  return (
    <AdminLayout>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:gap-6 lg:px-8">
        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Service Listings</h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Keep the catalog clean, review visibility, and jump into edits without digging through heavy tables.
                </p>
              </div>
              <Badge variant="outline" className="w-fit rounded-full border-stone-200 bg-stone-50 text-stone-700">
                {stays.length + cars.length + cooks.length + errands.length + experiences.length} total listings
              </Badge>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AdminStatCard
            title={`${activeMeta.pluralLabel} in view`}
            value={activeTotal}
            description={`Listings matching the current ${activeMeta.label.toLowerCase()} filters.`}
          />
          <AdminStatCard
            title="Public"
            value={activePublic}
            description="Listings currently visible to clients."
          />
          <AdminStatCard
            title="Private"
            value={activePrivate}
            description="Listings kept internal or hidden from search."
          />
          <AdminStatCard
            title="Current focus"
            value={activeMeta.pluralLabel}
            description={activeMeta.description}
          />
        </section>

        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardHeader className="space-y-4">
            <div className="space-y-1">
              <CardTitle>Search and Filter</CardTitle>
              <CardDescription>Trim the current tab down to the listings you want to review right now.</CardDescription>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={`Search ${activeMeta.pluralLabel.toLowerCase()} by title, location, or details`}
                  className="pl-9"
                />
              </div>
              <Select value={visibilityFilter} onValueChange={(value) => setVisibilityFilter(value as VisibilityFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by visibility" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All visibility</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
        </Card>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ServiceCategory)} className="space-y-6">
          <TabsList className="flex h-auto w-full gap-2 overflow-x-auto rounded-2xl border border-border/60 bg-background/90 p-2">
            <TabsTrigger className="min-w-[120px]" value="stays" data-testid="tab-stays">Stays ({stays.length})</TabsTrigger>
            <TabsTrigger className="min-w-[120px]" value="cars" data-testid="tab-cars">Cars ({cars.length})</TabsTrigger>
            <TabsTrigger className="min-w-[120px]" value="cooks" data-testid="tab-cooks">Cooks ({cooks.length})</TabsTrigger>
            <TabsTrigger className="min-w-[120px]" value="errands" data-testid="tab-errands">Errands ({errands.length})</TabsTrigger>
            <TabsTrigger className="min-w-[140px]" value="experiences" data-testid="tab-experiences">Experiences ({experiences.length})</TabsTrigger>
          </TabsList>

          {/* Stays Tab */}
          <TabsContent value="stays">
            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <CardTitle>Accommodation Stays</CardTitle>
                  <CardDescription>Review pricing, occupancy, and visibility for every stay.</CardDescription>
                </div>
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => setLocation("/admin/stays/new")}
                  data-testid="button-add-stay"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Stay
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingStays ? (
                  <ListingSkeletonGrid />
                ) : filteredStays.length === 0 ? (
                  <ListingEmptyState
                    description={normalizedQuery || visibilityFilter !== "all"
                      ? "No stays match the current search and visibility filters."
                      : serviceMeta.stays.emptyDescription}
                    actionLabel={normalizedQuery || visibilityFilter !== "all" ? "Clear filters" : "Add First Stay"}
                    onAction={() => {
                      if (normalizedQuery || visibilityFilter !== "all") {
                        setSearchTerm("");
                        setVisibilityFilter("all");
                        return;
                      }
                      setLocation("/admin/stays/new");
                    }}
                    testId={normalizedQuery || visibilityFilter !== "all" ? undefined : "button-add-first-stay"}
                  />
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {filteredStays.map((stay) => (
                      <Card key={stay.id} className="border-stone-200/80 bg-stone-50/60 shadow-none" data-testid={`row-stay-${stay.id}`}>
                        <CardContent className="space-y-4 p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-1">
                              <div className="text-lg font-semibold tracking-tight text-foreground">{stay.title}</div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-4 w-4 shrink-0" />
                                <span>{stay.location || "Location not set"}</span>
                              </div>
                            </div>
                            <Badge variant={stay.isPublic ? "default" : "secondary"}>
                              {stay.isPublic ? "Public" : "Private"}
                            </Badge>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Price / night</div>
                              <div className="mt-2 text-lg font-semibold text-foreground">{formatAmount(stay.price)}</div>
                            </div>
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Occupancy</div>
                              <div className="mt-2 text-lg font-semibold text-foreground">{stay.maxOccupancy} guests</div>
                            </div>
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Rooms</div>
                              <div className="mt-2 text-lg font-semibold text-foreground">{stay.bedrooms} bd | {stay.bathrooms} ba</div>
                            </div>
                          </div>

                          <p className="text-sm leading-6 text-muted-foreground">{getDescriptionPreview(stay.description)}</p>

                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            {renderListingShareActions("stays", stay.id, stay.title, stay.isPublic)}
                            <Button
                              variant="outline"
                              className="w-full sm:w-auto"
                              onClick={() => setLocation(`/admin/stays/${stay.id}/edit`)}
                              data-testid={`button-edit-stay-${stay.id}`}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit stay
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="w-full border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:w-auto"
                                  data-testid={`button-delete-stay-${stay.id}`}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete stay
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Stay</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{stay.title}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel data-testid="button-cancel-delete-stay">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(stay.id, "stays")}
                                    className="bg-destructive hover:bg-destructive/90"
                                    data-testid={`button-confirm-delete-stay-${stay.id}`}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Cars Tab */}
          <TabsContent value="cars">
            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <CardTitle>Car Rentals</CardTitle>
                  <CardDescription>Scan pricing, seats, and transmission details at a glance.</CardDescription>
                </div>
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => setLocation("/admin/cars/new")}
                  data-testid="button-add-car"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Car
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingCars ? (
                  <ListingSkeletonGrid />
                ) : filteredCars.length === 0 ? (
                  <ListingEmptyState
                    description={normalizedQuery || visibilityFilter !== "all"
                      ? "No cars match the current search and visibility filters."
                      : serviceMeta.cars.emptyDescription}
                    actionLabel={normalizedQuery || visibilityFilter !== "all" ? "Clear filters" : "Add First Car"}
                    onAction={() => {
                      if (normalizedQuery || visibilityFilter !== "all") {
                        setSearchTerm("");
                        setVisibilityFilter("all");
                        return;
                      }
                      setLocation("/admin/cars/new");
                    }}
                    testId={normalizedQuery || visibilityFilter !== "all" ? undefined : "button-add-first-car"}
                  />
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {filteredCars.map((car) => (
                      <Card key={car.id} className="border-stone-200/80 bg-stone-50/60 shadow-none" data-testid={`row-car-${car.id}`}>
                        <CardContent className="space-y-4 p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-1">
                              <div className="text-lg font-semibold tracking-tight text-foreground">{car.model}</div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-4 w-4 shrink-0" />
                                <span>{car.location || "Location not set"}</span>
                              </div>
                            </div>
                            <Badge variant={car.isPublic ? "default" : "secondary"}>
                              {car.isPublic ? "Public" : "Private"}
                            </Badge>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Price / day</div>
                              <div className="mt-2 text-lg font-semibold text-foreground">
                                {car.pricePerDay ? formatAmount(car.pricePerDay) : "N/A"}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">With driver</div>
                              <div className="mt-2 text-lg font-semibold text-foreground">
                                {car.priceWithDriver ? formatAmount(car.priceWithDriver) : "N/A"}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Specs</div>
                              <div className="mt-2 text-lg font-semibold text-foreground">{car.seats} seats</div>
                              <div className="text-sm capitalize text-muted-foreground">{car.transmission}</div>
                            </div>
                          </div>

                          <p className="text-sm leading-6 text-muted-foreground">{getDescriptionPreview(car.description)}</p>

                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            {renderListingShareActions("cars", car.id, car.model, car.isPublic)}
                            <Button
                              variant="outline"
                              className="w-full sm:w-auto"
                              onClick={() => setLocation(`/admin/cars/${car.id}/edit`)}
                              data-testid={`button-edit-car-${car.id}`}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit car
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="w-full border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:w-auto"
                                  data-testid={`button-delete-car-${car.id}`}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete car
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Car</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{car.model}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel data-testid="button-cancel-delete-car">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(car.id, "cars")}
                                    className="bg-destructive hover:bg-destructive/90"
                                    data-testid={`button-confirm-delete-car-${car.id}`}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Cooks Tab */}
          <TabsContent value="cooks">
            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <CardTitle>Personal Chefs</CardTitle>
                  <CardDescription>Check cuisine focus, guest limits, and pricing without opening each listing.</CardDescription>
                </div>
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => setLocation("/admin/cooks/new")}
                  data-testid="button-add-cook"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Chef
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingCooks ? (
                  <ListingSkeletonGrid />
                ) : filteredCooks.length === 0 ? (
                  <ListingEmptyState
                    description={normalizedQuery || visibilityFilter !== "all"
                      ? "No chefs match the current search and visibility filters."
                      : serviceMeta.cooks.emptyDescription}
                    actionLabel={normalizedQuery || visibilityFilter !== "all" ? "Clear filters" : "Add First Chef"}
                    onAction={() => {
                      if (normalizedQuery || visibilityFilter !== "all") {
                        setSearchTerm("");
                        setVisibilityFilter("all");
                        return;
                      }
                      setLocation("/admin/cooks/new");
                    }}
                    testId={normalizedQuery || visibilityFilter !== "all" ? undefined : "button-add-first-cook"}
                  />
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {filteredCooks.map((cook) => (
                      <Card key={cook.id} className="border-stone-200/80 bg-stone-50/60 shadow-none" data-testid={`row-cook-${cook.id}`}>
                        <CardContent className="space-y-4 p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-1">
                              <div className="text-lg font-semibold tracking-tight text-foreground">{cook.title}</div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-4 w-4 shrink-0" />
                                <span>{cook.location || "Location not set"}</span>
                              </div>
                              <div className="text-sm text-muted-foreground">{cook.serviceType} | {cook.speciality || "Speciality not set"}</div>
                            </div>
                            <Badge variant={cook.isPublic ? "default" : "secondary"}>
                              {cook.isPublic ? "Public" : "Private"}
                            </Badge>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Guests</div>
                              <div className="mt-2 text-lg font-semibold text-foreground">{getCookMinimumGuests(cook)} min</div>
                              <div className="text-sm text-muted-foreground">Up to {cook.maxGuests} guests</div>
                            </div>
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Base fee</div>
                              <div className="mt-2 text-lg font-semibold text-foreground">{formatAmount(getCookServiceFee(cook))}</div>
                              <div className="text-sm text-muted-foreground">Inclusive {formatAmount(getCookInclusivePrice(cook))}</div>
                            </div>
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Extras</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatAmount(getCookExtraGuestServiceFee(cook))} extra guest</div>
                              <div className="text-sm text-muted-foreground">{formatAmount(getCookCustomMenuRequestFee(cook, usdToKes))} custom menu request</div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-muted-foreground">
                            Extra inclusive guest: {formatAmount(getCookExtraGuestInclusivePrice(cook))}
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            {renderListingShareActions("cooks", cook.id, cook.title, cook.isPublic)}
                            <Button
                              variant="outline"
                              className="w-full sm:w-auto"
                              onClick={() => setLocation(`/admin/cooks/${cook.id}/edit`)}
                              data-testid={`button-edit-cook-${cook.id}`}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit chef
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="w-full border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:w-auto"
                                  data-testid={`button-delete-cook-${cook.id}`}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete chef
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Chef</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{cook.title}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel data-testid="button-cancel-delete-cook">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(cook.id, "cooks")}
                                    className="bg-destructive hover:bg-destructive/90"
                                    data-testid={`button-confirm-delete-cook-${cook.id}`}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          {/* Errands Tab */}
          <TabsContent value="errands">
            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <CardTitle>Errand Services</CardTitle>
                  <CardDescription>See pricing, enabled services, and descriptions in a cleaner admin view.</CardDescription>
                </div>
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => setLocation("/admin/errands/new")}
                  data-testid="button-add-errand"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Errand
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingErrands ? (
                  <ListingSkeletonGrid />
                ) : filteredErrands.length === 0 ? (
                  <ListingEmptyState
                    description={normalizedQuery || visibilityFilter !== "all"
                      ? "No errands match the current search and visibility filters."
                      : serviceMeta.errands.emptyDescription}
                    actionLabel={normalizedQuery || visibilityFilter !== "all" ? "Clear filters" : "Add First Errand"}
                    onAction={() => {
                      if (normalizedQuery || visibilityFilter !== "all") {
                        setSearchTerm("");
                        setVisibilityFilter("all");
                        return;
                      }
                      setLocation("/admin/errands/new");
                    }}
                    testId={normalizedQuery || visibilityFilter !== "all" ? undefined : "button-add-first-errand"}
                  />
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {filteredErrands.map((errand) => (
                      <Card key={errand.id} className="border-stone-200/80 bg-stone-50/60 shadow-none" data-testid={`row-errand-${errand.id}`}>
                        <CardContent className="space-y-4 p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-1">
                              <div className="text-lg font-semibold tracking-tight text-foreground">{errand.serviceName}</div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-4 w-4 shrink-0" />
                                <span>{errand.location || "Location not set"}</span>
                              </div>
                            </div>
                            <Badge variant={errand.isPublic ? "default" : "secondary"}>
                              {errand.isPublic ? "Public" : "Private"}
                            </Badge>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Base fee</div>
                              <div className="mt-2 text-lg font-semibold text-foreground">
                                {hasHelpMamaPricing(errand)
                                  ? `From ${formatAmount(getHelpMamaStartingPrice(errand.helpMamaPricing))}`
                                  : formatAmount(errand.basePrice)}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Enabled</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{errand.shoppingEnabled ? "Shopping" : "No shopping"}</div>
                              <div className="text-sm text-muted-foreground">{errand.laundryEnabled ? "Laundry on" : "Laundry off"}</div>
                            </div>
                            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Cleaning</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{errand.houseCleaningEnabled ? "House cleaning on" : "House cleaning off"}</div>
                              <div className="text-sm text-muted-foreground">{errand.shoppingEnabled ? `${errand.shoppingCommissionPercent}% shopping commission` : "No shopping commission"}</div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-muted-foreground">
                            {errand.laundryEnabled ? `Laundry add-ons: ${(errand.laundryAddons || []).length}` : "Laundry add-ons disabled"}
                            {" | "}
                            {errand.houseCleaningEnabled ? `Cleaning add-ons: ${(errand.houseCleaningAddons || []).length}` : "Cleaning add-ons disabled"}
                          </div>

                          <p className="text-sm leading-6 text-muted-foreground">{getDescriptionPreview(errand.description)}</p>

                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            {renderListingShareActions("errands", errand.id, errand.serviceName, errand.isPublic)}
                            <Button
                              variant="outline"
                              className="w-full sm:w-auto"
                              onClick={() => setLocation(`/admin/errands/${errand.id}/edit`)}
                              data-testid={`button-edit-errand-${errand.id}`}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit errand
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="w-full border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:w-auto"
                                  data-testid={`button-delete-errand-${errand.id}`}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete errand
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Errand</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{errand.serviceName}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel data-testid="button-cancel-delete-errand">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(errand.id, "errands")}
                                    className="bg-destructive hover:bg-destructive/90"
                                    data-testid={`button-confirm-delete-errand-${errand.id}`}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="experiences">
            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <CardTitle>Experiences</CardTitle>
                  <CardDescription>Manage packages, prices, and public visibility from one place.</CardDescription>
                </div>
                <Button className="w-full sm:w-auto" onClick={() => setLocation("/admin/experiences/new")} data-testid="button-add-experience">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Experience
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingExperiences ? (
                  <ListingSkeletonGrid />
                ) : filteredExperiences.length === 0 ? (
                  <ListingEmptyState
                    description={normalizedQuery || visibilityFilter !== "all"
                      ? "No experiences match the current search and visibility filters."
                      : serviceMeta.experiences.emptyDescription}
                    actionLabel={normalizedQuery || visibilityFilter !== "all" ? "Clear filters" : "Add First Experience"}
                    onAction={() => {
                      if (normalizedQuery || visibilityFilter !== "all") {
                        setSearchTerm("");
                        setVisibilityFilter("all");
                        return;
                      }
                      setLocation("/admin/experiences/new");
                    }}
                  />
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {filteredExperiences.map((experience) => (
                      <Card key={experience.id} className="border-stone-200/80 bg-stone-50/60 shadow-none">
                        <CardContent className="space-y-4 p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-1">
                              <div className="text-lg font-semibold tracking-tight text-foreground">{experience.title}</div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-4 w-4 shrink-0" />
                                <span>{experience.location || "Location not set"}</span>
                              </div>
                              <div className="text-sm text-muted-foreground">{experience.experienceType || "Type not set"} | {experience.experienceLocation || "Package not set"}</div>
                            </div>
                            <Badge variant={experience.isPublic ? "default" : "secondary"}>
                              {experience.isPublic ? "Public" : "Private"}
                            </Badge>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Private</div>
                              <div className="mt-2 break-words text-base font-semibold leading-snug text-foreground">
                                {experience.privateEnabled ? formatAmount(experience.privatePricePerPerson) : "Disabled"}
                              </div>
                              {experience.privateEnabled ? <div className="text-xs text-muted-foreground">per person</div> : null}
                            </div>
                            <div className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Shared</div>
                              <div className="mt-2 break-words text-base font-semibold leading-snug text-foreground">
                                {experience.sharedEnabled ? formatAmount(experience.sharedPricePerPerson) : "Disabled"}
                              </div>
                              {experience.sharedEnabled ? <div className="text-xs text-muted-foreground">per person</div> : null}
                            </div>
                            <div className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Guests & time</div>
                              <div className="mt-2 text-lg font-semibold text-foreground">{experience.durationHours}h</div>
                              <div className="text-sm text-muted-foreground">{experience.minGuests} to {experience.maxGuests} guests</div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                {experience.isPublic ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                Visibility
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {experience.isPublic ? "Clients can currently find this experience." : "This experience is hidden from clients."}
                              </p>
                            </div>
                            <Switch
                              checked={experience.isPublic}
                              onCheckedChange={(checked) => updateExperienceVisibilityMutation.mutate({ id: experience.id, isPublic: checked })}
                              disabled={updateExperienceVisibilityMutation.isPending}
                            />
                          </div>

                          <p className="text-sm leading-6 text-muted-foreground">{getDescriptionPreview(experience.description)}</p>

                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            {renderListingShareActions("experiences", experience.id, experience.title, experience.isPublic)}
                            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setLocation(`/admin/experiences/${experience.id}/edit`)}>
                              <Edit className="mr-2 h-4 w-4" />
                              Edit experience
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" className="w-full border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:w-auto">
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete experience
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete experience?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{experience.title}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(experience.id, "experiences")} className="bg-destructive hover:bg-destructive/90">
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}




