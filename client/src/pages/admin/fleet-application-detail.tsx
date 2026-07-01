import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, FileText, ImageIcon } from "lucide-react";
import type { FleetApplication } from "@shared/schema";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
      <p className="mt-1 text-sm text-foreground">{value || "—"}</p>
    </div>
  );
}

const approveFormSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type ApproveFormData = z.infer<typeof approveFormSchema>;

export default function AdminFleetApplicationDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [reviewNote, setReviewNote] = useState("");
  const [isApproveOpen, setIsApproveOpen] = useState(false);

  const { data: application, isLoading } = useQuery<FleetApplication>({
    queryKey: [`/api/admin/fleet-applications/${params.id}`],
    enabled: Boolean(params.id),
  });

  const approveForm = useForm<ApproveFormData>({
    resolver: zodResolver(approveFormSchema),
    defaultValues: { password: "" },
  });

  const rejectMutation = useMutation({
    mutationFn: async () =>
      apiRequest("PATCH", `/api/admin/fleet-applications/${params.id}`, { status: "rejected", reviewNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/fleet-applications/${params.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fleet-applications"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not reject application",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (data: ApproveFormData) =>
      apiRequest("POST", `/api/admin/fleet-applications/${params.id}/approve`, data),
    onSuccess: () => {
      setIsApproveOpen(false);
      queryClient.invalidateQueries({ queryKey: [`/api/admin/fleet-applications/${params.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fleet-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/provider-accounts"] });
      toast({ title: "Fleet partner approved", description: "The provider account and vehicle listing were created." });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not approve application",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  if (isLoading || !application) {
    return (
      <AdminLayout>
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
          <Skeleton className="h-40 w-full" />
        </div>
      </AdminLayout>
    );
  }

  const isDecided = application.status !== "pending";

  return (
    <AdminLayout>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => navigate("/admin/fleet-applications")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to applications
        </Button>

        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>{application.fullName}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{application.email} · {application.phone}</p>
              <p className="text-sm text-muted-foreground">
                {application.town ? `${application.town}, ` : ""}{application.county}
              </p>
            </div>
            <Badge
              variant={application.status === "approved" ? "default" : application.status === "rejected" ? "destructive" : "secondary"}
              className="capitalize"
            >
              {application.status}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">Vehicle</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailField label="Make & Model" value={`${application.make} ${application.model}`} />
                <DetailField label="Year" value={application.year ?? "—"} />
                <DetailField label="Colour" value={application.colour ?? "—"} />
                <DetailField label="Registration" value={application.registrationNumber} />
                <DetailField label="Transmission" value={humanize(application.transmission)} />
                <DetailField label="Fuel Type" value={application.fuelType ? humanize(application.fuelType) : "—"} />
                <DetailField label="Seats" value={String(application.seats)} />
                <DetailField label="Mileage" value={application.mileage != null ? String(application.mileage) : "—"} />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">Ownership & Availability</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailField label="Ownership Role" value={humanize(application.ownershipRole)} />
                <DetailField label="Ownership Type" value={humanize(application.ownershipType)} />
                <DetailField label="Availability" value={humanize(application.availabilityPreference)} />
                <DetailField label="Chauffeur Arrangement" value={humanize(application.chauffeurArrangement)} />
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suitable Services</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {application.suitableServices.map((service) => (
                  <Badge key={service} variant="outline">{humanize(service)}</Badge>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Photos</h3>
              {application.photoUrls.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">No photos uploaded.</p>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {application.photoUrls.map((photo) => (
                    <a
                      key={photo.url}
                      href={photo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-stone-200/80 p-3 text-sm text-foreground hover:bg-muted"
                    >
                      <ImageIcon className="h-4 w-4 text-primary" />
                      {photo.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documents</h3>
              {application.documentUrls.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">No documents uploaded — to be verified in person.</p>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {application.documentUrls.map((doc) => (
                    <a
                      key={doc.url}
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-stone-200/80 p-3 text-sm text-foreground hover:bg-muted"
                    >
                      <FileText className="h-4 w-4 text-primary" />
                      {doc.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            <DetailField label="Agreement accepted" value={formatDateTime(application.agreementAcceptedAt)} />

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review note</h3>
              <Textarea
                rows={3}
                value={reviewNote || application.reviewNote || ""}
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="Internal notes about this applicant"
                disabled={isDecided}
              />
            </div>

            {!isDecided ? (
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending}>
                  Reject
                </Button>
                <Button onClick={() => setIsApproveOpen(true)}>Approve &amp; Add to Fleet</Button>
              </div>
            ) : application.status === "approved" && application.createdUserId ? (
              <p className="text-sm text-muted-foreground">
                Provider account created (ID: {application.createdUserId}). Vehicle listing ID: {application.createdCarId}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isApproveOpen} onOpenChange={setIsApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve fleet partner</DialogTitle>
            <DialogDescription>
              This creates a partner account for {application.fullName} ({application.email}) and adds the{" "}
              {application.make} {application.model} to the fleet as a private listing for you or the partner to
              finish setting up.
            </DialogDescription>
          </DialogHeader>
          <Form {...approveForm}>
            <form className="space-y-4" onSubmit={approveForm.handleSubmit((data) => approveMutation.mutate(data))}>
              <FormField
                control={approveForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Set a password for this partner</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={approveMutation.isPending}>
                  Approve &amp; Add to Fleet
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
