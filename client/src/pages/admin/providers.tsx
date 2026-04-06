import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Briefcase, Mail, Pencil, Phone, Search, ShieldAlert, ShieldCheck, Star, Trash2, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { providerCategories, type ProviderAccountSummary } from "@shared/schema";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

const formSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(7, "Phone is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  providerTypes: z.array(z.enum(providerCategories)).min(1, "Select at least one provider role"),
});

type FormData = z.infer<typeof formSchema>;
type StatusFilter = "all" | "active" | "suspended";

function normalizeProviderTypes(value: string[] | null | undefined) {
  return (value ?? []).filter((entry): entry is FormData["providerTypes"][number] =>
    providerCategories.includes(entry as FormData["providerTypes"][number]));
}

function getProviderRoles(provider: Pick<ProviderAccountSummary, "providerTypes" | "providerType">) {
  return normalizeProviderTypes(
    provider.providerTypes && provider.providerTypes.length > 0
      ? provider.providerTypes
      : provider.providerType
        ? [provider.providerType]
        : [],
  );
}

function AssignmentBadges({ values, emptyLabel }: { values: string[]; emptyLabel: string }) {
  if (values.length === 0) {
    return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <Badge key={value} variant="outline">{value}</Badge>
      ))}
    </div>
  );
}

function getProviderRoleLabel(role: FormData["providerTypes"][number]) {
  switch (role) {
    case "stays":
      return "Stay Provider";
    case "cars":
      return "Car Provider";
    case "cooks":
      return "Chef Provider";
    case "errands":
      return "Errand Provider";
    case "experiences":
      return "Experience Provider";
    default:
      return role;
  }
}

function getProviderDisplayName(provider: ProviderAccountSummary) {
  return [provider.firstName, provider.lastName].filter(Boolean).join(" ") || provider.email;
}

function getAssignedListingCount(provider: ProviderAccountSummary) {
  return provider.assignedStayTitles.length
    + provider.assignedCarTitles.length
    + provider.assignedCookTitles.length
    + provider.assignedErrandTitles.length
    + provider.assignedExperienceTitles.length;
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
  className,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {title}
            </div>
            <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
            <p className="text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-stone-200/80 bg-stone-50 text-stone-700">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProvidersSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index} className="border-stone-200/80 bg-white shadow-sm">
          <CardContent className="space-y-4 p-5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminProviders() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isLoading: authLoading, isAdmin } = useAuth();
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editProviderTypes, setEditProviderTypes] = useState<FormData["providerTypes"]>(["stays"]);
  const [moderationNote, setModerationNote] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      setLocation("/auth?next=/admin/providers");
    }
  }, [authLoading, isAdmin, setLocation]);

  const { data: providers = [], isLoading } = useQuery<ProviderAccountSummary[]>({
    queryKey: ["/api/admin/provider-accounts"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      password: "",
      providerTypes: ["stays"],
    },
  });

  const toggleRole = (
    currentValues: FormData["providerTypes"],
    role: FormData["providerTypes"][number],
  ) => currentValues.includes(role)
    ? currentValues.filter((value) => value !== role)
    : [...currentValues, role];

  const providerSummary = useMemo(() => {
    const activeCount = providers.filter((provider) => !provider.isSuspended).length;
    const suspendedCount = providers.filter((provider) => provider.isSuspended).length;
    const assignedCount = providers.filter((provider) => getAssignedListingCount(provider) > 0).length;
    const ratings = providers.filter((provider) => typeof provider.averageRating === "number");
    const averageRating = ratings.length
      ? (ratings.reduce((sum, provider) => sum + (provider.averageRating ?? 0), 0) / ratings.length).toFixed(1)
      : "0.0";

    return {
      total: providers.length,
      active: activeCount,
      suspended: suspendedCount,
      assigned: assignedCount,
      averageRating,
    };
  }, [providers]);

  const filteredProviders = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return providers.filter((provider) => {
      const statusMatch = statusFilter === "all"
        || (statusFilter === "active" && !provider.isSuspended)
        || (statusFilter === "suspended" && provider.isSuspended);

      if (!statusMatch) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchable = [
        getProviderDisplayName(provider),
        provider.email,
        provider.phone ?? "",
        provider.moderationNote ?? "",
        ...getProviderRoles(provider).map((role) => getProviderRoleLabel(role)),
      ].join(" ").toLowerCase();

      return searchable.includes(query);
    });
  }, [providers, searchTerm, statusFilter]);

  const createProviderMutation = useMutation({
    mutationFn: async (data: FormData) => apiRequest("POST", "/api/admin/provider-accounts", {
      ...data,
      providerType: data.providerTypes[0],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/provider-accounts"] });
      toast({
        title: "Provider created",
        description: "The provider account can now sign in and receive listing assignments.",
      });
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create provider",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const updateProviderMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown> & { id: string }) =>
      apiRequest("PATCH", `/api/admin/provider-accounts/${payload.id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/provider-accounts"] });
      toast({ title: "Provider updated", description: "Provider account changes saved." });
      setEditingProviderId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update provider",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const deleteProviderMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/provider-accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/provider-accounts"] });
      toast({ title: "Provider deleted", description: "The account was removed and its listings were unassigned." });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not delete provider",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  return (
    <AdminLayout>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:gap-6 lg:px-8">
        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Providers</h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Create provider logins, moderate access, and check listing assignments without digging through dense admin cards.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full border-stone-200 bg-stone-50 text-stone-700">
                  {providerSummary.total} accounts
                </Badge>
                <Badge variant="outline" className="rounded-full border-stone-200 bg-stone-50 text-stone-700">
                  {providerSummary.assigned} assigned
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title="Total Providers"
            value={providerSummary.total}
            description="All provider accounts ready for assignment."
            icon={Users}
            className="border-stone-200/80 bg-white shadow-sm"
          />
          <SummaryCard
            title="Active"
            value={providerSummary.active}
            description="Accounts currently able to sign in and work."
            icon={ShieldCheck}
            className="border-emerald-200/80 bg-emerald-50/70 shadow-sm"
          />
          <SummaryCard
            title="Suspended"
            value={providerSummary.suspended}
            description="Accounts currently blocked from provider access."
            icon={ShieldAlert}
            className="border-rose-200/80 bg-rose-50/70 shadow-sm"
          />
          <SummaryCard
            title="Average Rating"
            value={`${providerSummary.averageRating}/5`}
            description="Review score across providers with feedback."
            icon={Star}
            className="border-amber-200/80 bg-amber-50/70 shadow-sm"
          />
        </section>

        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardHeader className="space-y-2">
            <CardTitle>Create Provider Account</CardTitle>
            <CardDescription>
              This creates a provider login. Listing assignment happens from the listing edit forms.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createProviderMutation.mutate(data))} className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl><Input {...field} placeholder="Provider name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input type="email" {...field} placeholder="provider@example.com" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl><Input {...field} placeholder="Provider phone" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="providerTypes"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Provider Roles</FormLabel>
                      <FormControl>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {providerCategories.map((role) => (
                            <button
                              key={role}
                              type="button"
                              className={`rounded-xl border px-3 py-3 text-left text-sm transition-colors ${
                                field.value.includes(role)
                                  ? "border-primary bg-primary/5 text-foreground"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/40"
                              }`}
                              onClick={() => field.onChange(toggleRole(field.value, role))}
                            >
                              <div className="font-medium">{getProviderRoleLabel(role)}</div>
                              <div className="mt-1 text-xs">{field.value.includes(role) ? "Selected" : "Tap to assign"}</div>
                            </button>
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Temporary Password</FormLabel>
                      <FormControl><Input type="password" {...field} placeholder="At least 8 characters" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="md:col-span-2">
                  <Button type="submit" className="w-full sm:w-auto" disabled={createProviderMutation.isPending}>
                    {createProviderMutation.isPending ? "Creating..." : "Create Provider"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardHeader className="space-y-4">
            <div className="space-y-1">
              <CardTitle>Provider Accounts</CardTitle>
              <CardDescription>
                Search and filter provider accounts before you edit, warn, suspend, or review assignments.
              </CardDescription>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by name, email, phone, role, or moderation note"
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
        </Card>

        {isLoading ? (
          <ProvidersSkeleton />
        ) : filteredProviders.length === 0 ? (
          <Card className="border-dashed border-stone-300 bg-white shadow-sm">
            <CardContent className="p-8 text-center sm:p-12">
              <div className="mx-auto max-w-md space-y-3">
                <div className="text-xl font-semibold text-foreground">No providers match this view</div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Try a different search or status filter, or create a new provider account to get started.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredProviders.map((provider) => {
              const providerRoles = getProviderRoles(provider);
              const assignedListingCount = getAssignedListingCount(provider);

              return (
                <Card key={provider.id} className="border-stone-200/80 bg-white shadow-sm">
                  <CardHeader className="space-y-3 pb-0">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <CardTitle className="text-xl tracking-tight">{getProviderDisplayName(provider)}</CardTitle>
                        <CardDescription className="break-all">
                          {provider.email}
                          {provider.phone ? ` | ${provider.phone}` : ""}
                        </CardDescription>
                      </div>
                      <Badge variant={provider.isSuspended ? "destructive" : "secondary"}>
                        {provider.isSuspended ? "Suspended" : "Active"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5 p-4 pt-5 sm:p-6 sm:pt-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">Roles:</span>
                      {providerRoles.length ? providerRoles.map((role) => (
                        <Badge key={role} variant="outline" className="border-stone-200 bg-stone-50 text-stone-700">
                          {getProviderRoleLabel(role)}
                        </Badge>
                      )) : (
                        <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-700">Unassigned</Badge>
                      )}
                      <Badge variant="outline">{provider.warningCount} warning{provider.warningCount === 1 ? "" : "s"}</Badge>
                      <Badge variant="outline">
                        {provider.averageRating ? `${provider.averageRating}/5` : "No ratings"} | {provider.totalReviewCount} reviews
                      </Badge>
                    </div>

                    {provider.moderationNote ? (
                      <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="leading-6">{provider.moderationNote}</div>
                      </div>
                    ) : null}

                    {editingProviderId === provider.id ? (
                      <div className="grid gap-3 rounded-3xl border border-stone-200 bg-stone-50/70 p-4 md:grid-cols-2">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Provider name" />
                        <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Phone" />
                        <div className="md:col-span-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {providerCategories.map((role) => (
                            <button
                              key={role}
                              type="button"
                              className={`rounded-2xl border px-3 py-3 text-left text-sm transition-colors ${
                                editProviderTypes.includes(role) ? "border-primary bg-primary/5" : "border-border"
                              }`}
                              onClick={() => setEditProviderTypes(toggleRole(editProviderTypes, role))}
                            >
                              {getProviderRoleLabel(role)}
                            </button>
                          ))}
                        </div>
                        <div className="md:col-span-2">
                          <Textarea
                            value={moderationNote}
                            onChange={(e) => setModerationNote(e.target.value)}
                            placeholder="Moderation note"
                            rows={4}
                          />
                        </div>
                        <div className="md:col-span-2 flex flex-col gap-2 sm:flex-row">
                          <Button
                            className="w-full sm:w-auto"
                            onClick={() => updateProviderMutation.mutate({
                              id: provider.id,
                              name: editName,
                              phone: editPhone,
                              providerTypes: editProviderTypes,
                              providerType: editProviderTypes[0],
                              moderationNote,
                            })}
                            disabled={updateProviderMutation.isPending}
                          >
                            Save Changes
                          </Button>
                          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setEditingProviderId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <Button
                          variant="outline"
                          className="justify-start"
                          onClick={() => {
                            setEditingProviderId(provider.id);
                            setEditName([provider.firstName, provider.lastName].filter(Boolean).join(" "));
                            setEditPhone(provider.phone ?? "");
                            setEditProviderTypes(providerRoles.length ? providerRoles : ["stays"]);
                            setModerationNote(provider.moderationNote ?? "");
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit details
                        </Button>
                        <Button
                          variant={provider.isSuspended ? "outline" : "destructive"}
                          className="justify-start"
                          onClick={() => updateProviderMutation.mutate({
                            id: provider.id,
                            isSuspended: !provider.isSuspended,
                            moderationNote: provider.moderationNote ?? "",
                          })}
                          disabled={updateProviderMutation.isPending}
                        >
                          {provider.isSuspended ? <ShieldCheck className="mr-2 h-4 w-4" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
                          {provider.isSuspended ? "Restore access" : "Suspend access"}
                        </Button>
                        <Button
                          variant="secondary"
                          className="justify-start"
                          onClick={() => updateProviderMutation.mutate({
                            id: provider.id,
                            action: "warn",
                            moderationNote: provider.moderationNote ?? "",
                          })}
                          disabled={updateProviderMutation.isPending}
                        >
                          <TriangleAlert className="mr-2 h-4 w-4" />
                          Issue warning
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              className="justify-start border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                              disabled={deleteProviderMutation.isPending}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete account
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete provider account?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {getProviderDisplayName(provider)} will lose access and any assigned listings will be unassigned.
                                This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteProviderMutation.mutate(provider.id)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}

                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                        Listing assignments
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                          <div className="mb-2 text-sm font-medium">Assigned stays</div>
                          <AssignmentBadges values={provider.assignedStayTitles} emptyLabel="No stays assigned yet." />
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                          <div className="mb-2 text-sm font-medium">Assigned cars</div>
                          <AssignmentBadges values={provider.assignedCarTitles} emptyLabel="No cars assigned yet." />
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                          <div className="mb-2 text-sm font-medium">Assigned chefs</div>
                          <AssignmentBadges values={provider.assignedCookTitles} emptyLabel="No chefs assigned yet." />
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                          <div className="mb-2 text-sm font-medium">Assigned errands</div>
                          <AssignmentBadges values={provider.assignedErrandTitles} emptyLabel="No errands assigned yet." />
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                          <div className="mb-2 text-sm font-medium">Assigned experiences</div>
                          <AssignmentBadges values={provider.assignedExperienceTitles} emptyLabel="No experiences assigned yet." />
                        </div>
                        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-4">
                          <div className="mb-2 text-sm font-medium">Quick summary</div>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {assignedListingCount > 0
                              ? `${getProviderDisplayName(provider)} is currently attached to ${assignedListingCount} listing${assignedListingCount === 1 ? "" : "s"}.`
                              : "This provider has no listing assignments yet."}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>    </AdminLayout>
  );
}


