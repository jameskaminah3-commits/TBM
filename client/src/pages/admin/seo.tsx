// TBM's SEO desk: every listing's score with the one fix that matters most,
// and the area pages' own text. The editor for one listing is seo-listing.tsx;
// the rules are in shared/listing-seo.ts.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, MapPin, Search } from "lucide-react";
import { AdminLayout } from "@/components/admin-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { seoDescriptionLimit, seoTitleLimit, type SeoGrade } from "@shared/listing-seo";

type SeoListingRow = {
  kind: "stay" | "car" | "cook" | "errand" | "experience";
  id: string;
  name: string;
  location: string;
  area: string | null;
  live: boolean;
  photo: string | null;
  path: string;
  title: string;
  focusKeyword: string | null;
  customised: boolean;
  score: number;
  grade: SeoGrade;
  topFix: string | null;
};

type AreaPageRow = {
  areaKey: string;
  areaName: string;
  service: string;
  path: string;
  count: number;
  defaults: { heading: string; title: string; description: string; intro: string };
  override: { heading: string | null; seoTitle: string | null; seoDescription: string | null; intro: string | null } | null;
};

export const kindLabels: Record<SeoListingRow["kind"], string> = { stay: "Stay", car: "Car", cook: "Chef", errand: "Home help", experience: "Experience" };

export const gradeStyle: Record<SeoGrade, string> = {
  Excellent: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Good: "bg-sky-50 text-sky-800 ring-sky-200",
  "Needs work": "bg-amber-50 text-amber-900 ring-amber-200",
  Poor: "bg-rose-50 text-rose-800 ring-rose-200",
};

export function ScoreBadge({ score, grade, className }: { score: number; grade: SeoGrade; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ring-1", gradeStyle[grade], className)}>
      {score}<span className="font-normal">/100 · {grade}</span>
    </span>
  );
}

const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");

function Counter({ value, limit }: { value: string; limit: number }) {
  const length = value.trim().length;
  return <span className={cn("text-xs tabular-nums", length > limit ? "text-rose-700" : "text-muted-foreground")}>{length}/{limit}</span>;
}

function AreaPageEditor({ page }: { page: AreaPageRow }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [heading, setHeading] = useState(page.override?.heading ?? "");
  const [title, setTitle] = useState(page.override?.seoTitle ?? "");
  const [description, setDescription] = useState(page.override?.seoDescription ?? "");
  const [intro, setIntro] = useState(page.override?.intro ?? "");
  const save = useMutation({
    mutationFn: async () => apiRequest("PUT", `/api/admin/seo/areas/${page.areaKey}/${page.service}`, { heading, seoTitle: title, seoDescription: description, intro }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo/areas"] });
      toast({ title: "Area page saved" });
    },
    onError: (error: Error) => toast({ title: "Couldn't save", description: errorText(error), variant: "destructive" }),
  });

  return (
    <li className="rounded-2xl border border-stone-200 bg-white p-4" data-testid={`seo-area-${page.areaKey}-${page.service}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{page.override?.heading || page.defaults.heading}</div>
          <div className="text-xs text-muted-foreground">{page.path} · {page.count ? `${page.count} live listing${page.count === 1 ? "" : "s"}` : "No live listings: kept out of Google for now"}{page.override ? " · TBM's own text" : ""}</div>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="ghost" className="rounded-full"><a href={page.path} target="_blank" rel="noreferrer">View <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setOpen((value) => !value)}>{open ? "Close" : "Edit"}</Button>
        </div>
      </div>
      {open ? (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm"><span className="font-medium">Heading on the page</span><Input value={heading} onChange={(event) => setHeading(event.target.value)} placeholder={page.defaults.heading} /></label>
          <label className="grid gap-1 text-sm"><span className="flex justify-between font-medium">Google title <Counter value={title || page.defaults.title} limit={seoTitleLimit} /></span><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={page.defaults.title} /></label>
          <label className="grid gap-1 text-sm"><span className="flex justify-between font-medium">Google description <Counter value={description || page.defaults.description} limit={seoDescriptionLimit} /></span><Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={page.defaults.description} /></label>
          <label className="grid gap-1 text-sm"><span className="font-medium">Introduction</span><Textarea rows={5} value={intro} onChange={(event) => setIntro(event.target.value)} placeholder={page.defaults.intro} /><span className="text-xs text-muted-foreground">100 to 200 words of real local knowledge rank best: which beach, how far from the airport, the best months. Leave empty to use the automatic text.</span></label>
          <div><Button className="rounded-full" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save area page"}</Button></div>
        </div>
      ) : null}
    </li>
  );
}

export default function AdminSeo() {
  const [, setLocation] = useLocation();
  const { isLoading: authLoading, isAdmin } = useAuth();
  useEffect(() => {
    if (!authLoading && !isAdmin) setLocation("/auth?next=/admin/seo");
  }, [authLoading, isAdmin, setLocation]);
  const [tab, setTab] = useState<"listings" | "areas">("listings");
  const [filter, setFilter] = useState<"work" | "all" | "live">("work");
  const [kind, setKind] = useState<SeoListingRow["kind"] | "all">("all");
  const [search, setSearch] = useState("");
  const [showEmptyAreas, setShowEmptyAreas] = useState(false);
  const { data, isLoading } = useQuery<{ listings: SeoListingRow[] }>({ queryKey: ["/api/admin/seo/listings"], enabled: isAdmin });
  const { data: areaData, isLoading: areasLoading } = useQuery<{ pages: AreaPageRow[] }>({ queryKey: ["/api/admin/seo/areas"], enabled: isAdmin && tab === "areas" });
  const listings = data?.listings ?? [];
  const live = listings.filter((listing) => listing.live);
  const average = live.length ? Math.round(live.reduce((sum, listing) => sum + listing.score, 0) / live.length) : 0;
  const needWork = live.filter((listing) => listing.score < 60).length;
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return listings
      .filter((listing) => filter === "all" || (filter === "live" ? listing.live : listing.live && listing.score < 60))
      .filter((listing) => kind === "all" || listing.kind === kind)
      .filter((listing) => !term || `${listing.name} ${listing.location} ${listing.area ?? ""}`.toLowerCase().includes(term))
      .sort((a, b) => a.score - b.score);
  }, [filter, kind, listings, search]);
  const areaPages = (areaData?.pages ?? []).filter((page) => showEmptyAreas || page.count > 0 || page.override);

  return (
    <AdminLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl">SEO</CardTitle>
            <CardDescription className="leading-6">
              Make every listing easy to find on Google. Each one gets search phrases its own facts back up, who it competes with, suggested titles and descriptions, and a score out of 100. Start with the lowest scores: they gain the most.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Average score, live listings", live.length ? `${average}/100` : "–"],
              ["Live listings", String(live.length)],
              ["Live, need work", String(needWork)],
              ["With TBM's own SEO", String(listings.filter((listing) => listing.customised).length)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-stone-50 p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-2" role="tablist">
          {([["listings", "Listings"], ["areas", "Area pages"]] as const).map(([value, label]) => (
            <Button key={value} role="tab" aria-selected={tab === value} variant={tab === value ? "default" : "outline"} className="rounded-full" onClick={() => setTab(value)} data-testid={`seo-tab-${value}`}>{label}</Button>
          ))}
        </div>

        {tab === "listings" ? (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or area" className="pl-9" aria-label="Search listings" />
              </div>
              <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label="Listing type">
                <option value="all">All types</option>
                {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              {([["work", `Live, need work (${needWork})`], ["live", "Live"], ["all", "All, including not live"]] as const).map(([value, label]) => (
                <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} className="rounded-full" onClick={() => setFilter(value)} data-testid={`seo-filter-${value}`}>{label}</Button>
              ))}
            </div>
            {isLoading ? <p className="text-sm text-muted-foreground">Scoring listings…</p> : null}
            {!isLoading && !shown.length ? <p className="text-sm text-muted-foreground">{filter === "work" ? "No live listing scores under 60. Look at the Live tab to push good ones to excellent." : "Nothing here."}</p> : null}
            <ul className="space-y-3">
              {shown.map((listing) => (
                <li key={`${listing.kind}-${listing.id}`} className="flex gap-3 rounded-2xl border border-stone-200 bg-white p-3 sm:p-4" data-testid={`seo-row-${listing.kind}-${listing.id}`}>
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-stone-100 sm:h-20 sm:w-20">
                    {listing.photo ? <img src={listing.photo} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{listing.name}</div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>{kindLabels[listing.kind]}</span>
                          <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" aria-hidden="true" />{listing.area ?? (listing.location || "No area")}</span>
                          {listing.live ? null : <Badge variant="outline" className="rounded-full text-[11px]">Not live</Badge>}
                        </div>
                      </div>
                      <ScoreBadge score={listing.score} grade={listing.grade} />
                    </div>
                    <div className="mt-2 truncate text-sm text-sky-800" title={listing.title}>{listing.title}</div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 text-xs text-muted-foreground">{listing.topFix ? `Biggest gain: ${listing.topFix.toLowerCase()}` : "Nothing left to fix"}</span>
                      <Button asChild size="sm" className="rounded-full"><Link href={`/admin/seo/${listing.kind}/${listing.id}`} data-testid={`seo-improve-${listing.kind}-${listing.id}`}>Improve</Link></Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardContent className="space-y-2 pt-6 text-sm leading-6 text-stone-700">
                <p>Area pages such as <a href="/explore/diani/stays" target="_blank" rel="noreferrer" className="font-medium underline-offset-4 hover:underline">/explore/diani/stays</a> collect every live listing in a place and link them together. They're where most travel searches land, like "where to stay in Diani" or "things to do in Watamu".</p>
                <p>A page goes into Google once it has a live listing. Writing its introduction in your own words, with real local detail, makes it rank better than the automatic text.</p>
              </CardContent>
            </Card>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showEmptyAreas} onChange={(event) => setShowEmptyAreas(event.target.checked)} /> Show areas without live listings</label>
            {areasLoading ? <p className="text-sm text-muted-foreground">Loading area pages…</p> : null}
            {!areasLoading && !areaPages.length ? <p className="text-sm text-muted-foreground">No area has a live listing yet.</p> : null}
            <ul className="space-y-3">{areaPages.map((page) => <AreaPageEditor key={`${page.areaKey}/${page.service}`} page={page} />)}</ul>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
