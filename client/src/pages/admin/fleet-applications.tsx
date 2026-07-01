import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { FleetApplication } from "@shared/schema";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const tabs = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
] as const;

function StatusBadge({ status }: { status: string }) {
  const variant = status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary";
  return <Badge variant={variant} className="capitalize">{status}</Badge>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AdminFleetApplications() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["value"]>("pending");
  const { data: applications, isLoading } = useQuery<FleetApplication[]>({
    queryKey: ["/api/admin/fleet-applications"],
  });

  const filtered = useMemo(
    () => (applications ?? []).filter((application) => application.status === activeTab),
    [applications, activeTab],
  );

  return (
    <AdminLayout>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:gap-6 lg:px-8">
        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>Fleet Applications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              {tabs.map((tab) => {
                const count = (applications ?? []).filter((application) => application.status === tab.value).length;
                return (
                  <Button
                    key={tab.value}
                    type="button"
                    size="sm"
                    variant={activeTab === tab.value ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() => setActiveTab(tab.value)}
                  >
                    {tab.label}
                    {count ? <span className="ml-1.5 text-xs opacity-80">({count})</span> : null}
                  </Button>
                );
              })}
            </div>

            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No {activeTab} applications.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-stone-200/80">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Owner</th>
                      <th className="px-4 py-3">Vehicle</th>
                      <th className="px-4 py-3">Submitted</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((application) => (
                      <tr key={application.id} className="border-t border-stone-200/60">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{application.fullName}</div>
                          <div className="text-xs text-muted-foreground">{application.email}</div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {application.year ? `${application.year} ` : ""}{application.make} {application.model}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(application.createdAt)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={application.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/admin/fleet-applications/${application.id}`}>
                            <Button size="sm" variant="ghost">View</Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
