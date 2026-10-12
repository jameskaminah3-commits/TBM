import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Image as ImageIcon, Mail, MapPin, Phone } from "lucide-react";
import { AdminLayout } from "@/components/admin-layout";
import { WorkspaceIcon } from "@/components/provider-hub/hub-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatKenyaDateTime, todayInKenya } from "@shared/calendar-dates";
import { applicationDetailFields, isApplicationServiceType, workingDaysWaiting } from "@shared/provider-applications";
import { providerWorkspaces } from "@shared/provider-workspaces";

type Application = {
  id: string;
  serviceType: string;
  fullName: string;
  phone: string;
  email: string;
  town: string;
  details: Record<string, unknown>;
  photos: Array<{ label: string; url: string }>;
  status: "new" | "contacted" | "approved" | "declined";
  reviewNote: string | null;
  createdUserId: string | null;
  createdAt: string;
};

const statusTone: Record<Application["status"], string> = {
  new: "bg-amber-500",
  contacted: "bg-sky-600",
  approved: "bg-emerald-600",
  declined: "bg-stone-500",
};
const statusLabel: Record<Application["status"], string> = { new: "New", contacted: "Contacted", approved: "Approved", declined: "Declined" };
const filters = ["open", "approved", "declined", "all"] as const;

function ApplicationCard({ application, focused }: { application: Application; focused: boolean }) {
  const { toast } = useToast();
  const [note, setNote] = useState(application.reviewNote ?? "");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/provider-applications"] });
  const setStatus = useMutation({
    mutationFn: async (status: "contacted" | "declined" | "new") => apiRequest("POST", `/api/admin/provider-applications/${application.id}/status`, { status, note }),
    onSuccess: () => { refresh(); toast({ title: "Application updated" }); },
    onError: (error: Error) => toast({ title: "Couldn't update", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const approve = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/provider-applications/${application.id}/approve`, {}),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/provider-accounts"] });
      toast({ title: "Approved", description: "The provider's account is ready. They've been emailed how to sign in." });
    },
    onError: (error: Error) => toast({ title: "Couldn't approve", description: error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1"), variant: "destructive" }),
  });
  const serviceKey = isApplicationServiceType(application.serviceType) ? application.serviceType : null;
  const answers = serviceKey ? applicationDetailFields[serviceKey].filter((field) => application.details[field.key] !== undefined && application.details[field.key] !== "") : [];

  return (
    <Card id={`application-${application.id}`} className={cn("scroll-mt-24 border-stone-200/80 bg-white shadow-sm", focused && "ring-2 ring-teal-600")} data-testid={`application-card-${application.id}`}>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            {serviceKey ? <WorkspaceIcon workspace={serviceKey} /> : null}
            <div>
              <CardTitle className="text-lg">{application.fullName}</CardTitle>
              <CardDescription>{serviceKey ? providerWorkspaces[serviceKey].label : application.serviceType} · applied {formatKenyaDateTime(application.createdAt, { day: "numeric", month: "short", year: "numeric" }, "en-GB")}</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {application.status === "new" ? (() => {
              const waited = workingDaysWaiting(todayInKenya(new Date(application.createdAt)), todayInKenya());
              return (
                <span
                  className={cn("rounded-full px-2 py-0.5 text-xs font-medium ring-1", waited >= 2 ? "bg-amber-50 text-amber-900 ring-amber-300" : "bg-stone-50 text-stone-600 ring-stone-200")}
                  data-testid={`application-waiting-${application.id}`}
                >
                  {waited === 0 ? "Arrived today" : `Waiting ${waited} working day${waited === 1 ? "" : "s"}`}
                </span>
              );
            })() : null}
            <Badge className={statusTone[application.status]}>{statusLabel[application.status]}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <a href={`tel:+${application.phone}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="h-3.5 w-3.5" />+{application.phone}</a>
          <a href={`mailto:${application.email}`} className="inline-flex items-center gap-1 break-all hover:text-foreground"><Mail className="h-3.5 w-3.5" />{application.email}</a>
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{application.town}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {answers.map((field) => {
            const value = application.details[field.key];
            return (
              <div key={field.key} className={cn(field.type === "textarea" && "sm:col-span-2")}>
                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                <dd className="text-foreground">{Array.isArray(value) ? value.join(", ") : typeof value === "number" && /Kes$/.test(field.key) ? `KSh ${value.toLocaleString("en-KE")}` : String(value)}</dd>
              </div>
            );
          })}
        </dl>
        {application.photos.length ? (
          <div className="flex flex-wrap gap-2">
            {application.photos.map((photo) => (
              <a key={photo.url} href={photo.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs hover:bg-muted">
                <ImageIcon className="h-3.5 w-3.5" />{photo.label}
              </a>
            ))}
          </div>
        ) : <p className="text-xs text-muted-foreground">No photos.</p>}
        {application.status !== "approved" ? (
          <div className="space-y-2">
            <Textarea rows={2} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Note for the team (not sent to the applicant)" aria-label="Review note" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="rounded-full bg-emerald-700 hover:bg-emerald-800" disabled={approve.isPending} onClick={() => approve.mutate()} data-testid={`button-approve-application-${application.id}`}>
                Approve and create account
              </Button>
              {application.status === "new" ? (
                <Button size="sm" variant="outline" className="rounded-full" disabled={setStatus.isPending} onClick={() => setStatus.mutate("contacted")}>Mark contacted</Button>
              ) : null}
              {application.status !== "declined" ? (
                <Button size="sm" variant="ghost" className="rounded-full text-rose-700" disabled={setStatus.isPending} onClick={() => setStatus.mutate("declined")}>Decline</Button>
              ) : (
                <Button size="sm" variant="ghost" className="rounded-full" disabled={setStatus.isPending} onClick={() => setStatus.mutate("new")}>Reopen</Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-emerald-800">Account created. The provider sets their own password with "Forgot password?".</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminProviderApplications() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { isLoading: authLoading, isAdmin } = useAuth();
  const [filter, setFilter] = useState<(typeof filters)[number]>("open");
  const focusedId = new URLSearchParams(search).get("application");
  const { data = [], isLoading } = useQuery<Application[]>({ queryKey: ["/api/admin/provider-applications"], enabled: isAdmin });

  useEffect(() => {
    if (!authLoading && !isAdmin) setLocation("/auth?next=/admin/provider-applications");
  }, [authLoading, isAdmin, setLocation]);
  useEffect(() => {
    if (!focusedId || !data.length) return;
    const timer = window.setTimeout(() => document.getElementById(`application-${focusedId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => window.clearTimeout(timer);
  }, [focusedId, data.length]);

  const shown = useMemo(() => data.filter((application) =>
    filter === "all" ? true : filter === "open" ? application.status === "new" || application.status === "contacted" : application.status === filter,
  ), [data, filter]);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Provider applications</h1>
          <p className="text-sm text-muted-foreground">Hosts, chefs, home help and experience providers who want to join. Vehicles apply under Fleet Applications.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {filters.map((value) => (
            <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} className="rounded-full capitalize" onClick={() => setFilter(value)}>
              {value} ({data.filter((application) => value === "all" ? true : value === "open" ? application.status === "new" || application.status === "contacted" : application.status === value).length})
            </Button>
          ))}
        </div>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : shown.length ? shown.map((application) => (
          <ApplicationCard key={application.id} application={application} focused={application.id === focusedId} />
        )) : <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No applications here.</p>}
      </div>
    </AdminLayout>
  );
}
