import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, ShieldCheck, AlertTriangle } from "lucide-react";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ListingVerificationTask } from "@shared/schema";

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AdminListingVerifications() {
  const { toast } = useToast();
  const { data: tasks = [], isLoading } = useQuery<ListingVerificationTask[]>({ queryKey: ["/api/admin/listing-verifications"] });
  const [drafts, setDrafts] = useState<Record<string, { assignee: string; summary: string; reportUrl: string; warning: string; quote: string }>>({});
  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => apiRequest("PATCH", `/api/admin/listing-verifications/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/listing-verifications"] });
      toast({ title: "Verification workflow updated" });
    },
    onError: (error: Error) => toast({ title: "Could not update verification", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const getDraft = (task: ListingVerificationTask) => drafts[task.id] ?? { assignee: task.assignedTo ?? "", summary: task.reportSummary ?? "", reportUrl: task.reportUrl ?? "", warning: task.warningFlag ?? "", quote: "" };
  const setDraft = (task: ListingVerificationTask, key: keyof ReturnType<typeof getDraft>, value: string) => setDrafts((current) => ({ ...current, [task.id]: { ...getDraft(task), [key]: value } }));

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Operations</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Listing verifications</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Paid external-listing checks. Dispatch only paid requests, record the on-ground report, and credit the fee when the guest proceeds with a TBM booking.</p>
        </div>
        {isLoading ? <div className="text-sm text-muted-foreground">Loading verification requests…</div> : tasks.length === 0 ? <Card><CardContent className="p-6 text-sm text-muted-foreground">No listing verification requests yet.</CardContent></Card> : (
          <div className="space-y-4">
            {tasks.map((task) => {
              const draft = getDraft(task);
              const paid = task.paymentStatus === "paid";
              return (
                <Card key={task.id}>
                  <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-violet-600" />{task.location || "Coast location to confirm"}</CardTitle>
                      <div className="mt-1 text-sm text-muted-foreground">{task.customerName} · {task.customerEmail} · Booking {task.bookingId.slice(0, 8).toUpperCase()}</div>
                    </div>
                    <div className="flex flex-wrap gap-2"><Badge variant={paid ? "default" : "outline"}>{paid ? "Paid" : "Awaiting payment"}</Badge><Badge variant="outline">{statusLabel(task.status)}</Badge>{task.feeCredited ? <Badge variant="secondary">Fee credited</Badge> : null}</div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-lg bg-muted/40 p-4 text-sm">
                        <div className="font-medium">External listing</div>
                        <a href={task.listingUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-start gap-2 break-all text-primary underline underline-offset-2"><ExternalLink className="mt-0.5 h-4 w-4 shrink-0" />{task.listingUrl}</a>
                        <div className="mt-3"><span className="font-medium">Scope:</span> {task.verificationScope}</div>
                        <div className="mt-1"><span className="font-medium">Fee:</span> {task.feeKes ? `KSh ${task.feeKes.toLocaleString("en-KE")}` : `USD ${task.feeUsd}`}</div>
                      </div>
                      <div className="space-y-3">
                        <Input placeholder="Assigned partner or agent" value={draft.assignee} onChange={(event) => setDraft(task, "assignee", event.target.value)} />
                        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: task.id, payload: { action: "assign", assigned_to: draft.assignee } })}>Assign</Button><Button size="sm" disabled={!paid || updateMutation.isPending} onClick={() => updateMutation.mutate({ id: task.id, payload: { action: "start" } })}>Start field review</Button></div>
                      </div>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <Textarea placeholder="Concise report: what was found, what matched, and what was checked" value={draft.summary} onChange={(event) => setDraft(task, "summary", event.target.value)} />
                      <div className="space-y-3"><Input placeholder="Optional full report URL" value={draft.reportUrl} onChange={(event) => setDraft(task, "reportUrl", event.target.value)} /><Input placeholder="Warning flag (required for warning outcome)" value={draft.warning} onChange={(event) => setDraft(task, "warning", event.target.value)} /></div>
                    </div>
                    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!paid || draft.summary.trim().length < 10 || updateMutation.isPending} onClick={() => updateMutation.mutate({ id: task.id, payload: { action: "report", outcome: "verified", report_summary: draft.summary, report_url: draft.reportUrl } })}><ShieldCheck className="mr-2 h-4 w-4" />Mark verified</Button><Button size="sm" variant="outline" disabled={!paid || draft.summary.trim().length < 10 || updateMutation.isPending} onClick={() => updateMutation.mutate({ id: task.id, payload: { action: "report", outcome: "warning", report_summary: draft.summary, report_url: draft.reportUrl, warning_flag: draft.warning } })}><AlertTriangle className="mr-2 h-4 w-4" />Issue warning</Button></div>
                    <div className="flex flex-wrap items-center gap-2 border-t pt-4"><Input className="max-w-xs" type="number" placeholder="Final quote USD" value={draft.quote} onChange={(event) => setDraft(task, "quote", event.target.value)} /><Button size="sm" variant="secondary" disabled={!task.reportSummary || !draft.quote || updateMutation.isPending} onClick={() => updateMutation.mutate({ id: task.id, payload: { action: "credit", quote_amount_usd: Number(draft.quote) } })}>Credit fee to final quote</Button></div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
