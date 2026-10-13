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
import {
  applicationDeclineReasonLabels,
  applicationDeclineReasons,
  applicationDetailFields,
  isApplicationServiceType,
  workingDaysWaiting,
  type ApplicationDeclineReason,
  type ApplicationStatus,
} from "@shared/provider-applications";
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
  status: ApplicationStatus;
  reviewNote: string | null;
  createdUserId: string | null;
  createdAt: string;
  reference: string;
  applicantMessage: string | null;
  declineReason: string | null;
};

const statusTone: Record<ApplicationStatus, string> = {
  new: "bg-amber-500",
  contacted: "bg-sky-600",
  "needs-info": "bg-violet-600",
  approved: "bg-emerald-600",
  declined: "bg-stone-500",
};
const statusLabel: Record<ApplicationStatus, string> = { new: "New", contacted: "In review", "needs-info": "More info needed", approved: "Approved", declined: "Declined" };
const isOpen = (status: ApplicationStatus) => status === "new" || status === "contacted" || status === "needs-info";
const filters = ["open", "approved", "declined", "all"] as const;

function ApplicationCard({ application, focused }: { application: Application; focused: boolean }) {
  const { toast } = useToast();
  const [note, setNote] = useState(application.reviewNote ?? "");
  const [mode, setMode] = useState<"none" | "needs-info" | "declined">("none");
  const [applicantMessage, setApplicantMessage] = useState("");
  const [declineReason, setDeclineReason] = useState<ApplicationDeclineReason | "">("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/provider-applications"] });
  const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");
  const setStatus = useMutation({
    mutationFn: async (status: "contacted" | "declined" | "new" | "needs-info") => apiRequest("POST", `/api/admin/provider-applications/${application.id}/status`, {
      status,
      note,
      applicantMessage: status === "needs-info" || status === "declined" ? applicantMessage : undefined,
      declineReason: status === "declined" ? declineReason : undefined,
    }),
    onSuccess: (_response, status) => {
      refresh();
      setMode("none");
      setApplicantMessage("");
      toast({ title: status === "needs-info" ? "Sent to the applicant" : status === "declined" ? "Declined. The applicant has been emailed." : "Application updated" });
    },
    onError: (error: Error) => toast({ title: "Couldn't update", description: errorText(error), variant: "destructive" }),
  });
  const resendSetup = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/provider-applications/${application.id}/setup-link`, {}),
    onSuccess: () => toast({ title: "Set-up link sent", description: "A new link went to the applicant's email. Earlier links no longer work." }),
    onError: (error: Error) => toast({ title: "Couldn't send", description: errorText(error), variant: "destructive" }),
  });
  const approve = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/provider-applications/${application.id}/approve`, {}),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/provider-accounts"] });
      toast({ title: "Approved", description: "The provider's account is ready. They've been emailed a link to set their password." });
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
              <CardDescription>{serviceKey ? providerWorkspaces[serviceKey].label : application.serviceType} · <span className="font-mono">{application.reference}</span> · applied {formatKenyaDateTime(application.createdAt, { day: "numeric", month: "short", year: "numeric" }, "en-GB")}</CardDescription>
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
        {application.applicantMessage && (application.status === "needs-info" || application.status === "declined") ? (
          <div className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-950">
            <span className="font-medium">Sent to the applicant:</span> {application.declineReason && application.declineReason in applicationDeclineReasonLabels ? `${applicationDeclineReasonLabels[application.declineReason as ApplicationDeclineReason]} ` : ""}{application.applicantMessage}
          </div>
        ) : null}
        {application.status !== "approved" ? (
          <div className="space-y-2">
            <Textarea rows={2} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Note for the team (not sent to the applicant)" aria-label="Review note" />
            {mode !== "none" ? (
              <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                {mode === "declined" ? (
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={declineReason}
                    onChange={(event) => setDeclineReason(event.target.value as ApplicationDeclineReason)}
                    aria-label="Reason, sent to the applicant"
                    data-testid={`select-decline-reason-${application.id}`}
                  >
                    <option value="">Choose a reason (sent to the applicant)</option>
                    {applicationDeclineReasons.map((reason) => <option key={reason} value={reason}>{applicationDeclineReasonLabels[reason]}</option>)}
                  </select>
                ) : null}
                <Textarea
                  rows={3}
                  value={applicantMessage}
                  maxLength={800}
                  onChange={(event) => setApplicantMessage(event.target.value)}
                  placeholder={mode === "needs-info" ? "What do you need from them? This is emailed to the applicant." : "Anything else to tell them (optional, emailed)."}
                  aria-label="Message to the applicant"
                  data-testid={`input-applicant-message-${application.id}`}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="rounded-full"
                    disabled={setStatus.isPending || (mode === "needs-info" ? !applicantMessage.trim() : !declineReason)}
                    onClick={() => setStatus.mutate(mode)}
                    data-testid={`button-send-${mode}-${application.id}`}
                  >
                    {mode === "needs-info" ? "Email the applicant" : "Decline and email the applicant"}
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setMode("none")}>Cancel</Button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="rounded-full bg-emerald-700 hover:bg-emerald-800" disabled={approve.isPending} onClick={() => approve.mutate()} data-testid={`button-approve-application-${application.id}`}>
                Approve and create account
              </Button>
              {application.status === "new" ? (
                <Button size="sm" variant="outline" className="rounded-full" disabled={setStatus.isPending} onClick={() => setStatus.mutate("contacted")}>Mark in review</Button>
              ) : null}
              {application.status !== "declined" ? (
                <>
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => setMode("needs-info")} data-testid={`button-needs-info-${application.id}`}>Ask for more information</Button>
                  <Button size="sm" variant="ghost" className="rounded-full text-rose-700" onClick={() => setMode("declined")} data-testid={`button-decline-${application.id}`}>Decline</Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" className="rounded-full" disabled={setStatus.isPending} onClick={() => setStatus.mutate("new")}>Reopen</Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-emerald-800">Account created. The provider chose their own password from the set-up link we emailed.</p>
            <Button size="sm" variant="outline" className="rounded-full" disabled={resendSetup.isPending} onClick={() => resendSetup.mutate()} data-testid={`button-resend-setup-${application.id}`}>Resend set-up link</Button>
          </div>
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
    filter === "all" ? true : filter === "open" ? isOpen(application.status) : application.status === filter,
  ), [data, filter]);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Provider applications</h1>
          <p className="text-sm text-muted-foreground">Hosts, vehicle owners, chefs, home help and experience providers who want to join. Applications from the old vehicle form stay under Fleet Applications.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {filters.map((value) => (
            <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} className="rounded-full capitalize" onClick={() => setFilter(value)}>
              {value} ({data.filter((application) => value === "all" ? true : value === "open" ? isOpen(application.status) : application.status === value).length})
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
