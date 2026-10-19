// One listing's SEO: the main search phrase, the Google title and description
// (empty means the automatic one), text for each photo, the competitors and how
// to beat them, and a score that updates while you type. Rules:
// shared/listing-seo.ts. Saving changes only what Google and the listing page
// read; the provider's own listing text is never touched here.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Sparkles, XCircle } from "lucide-react";
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
import {
  scoreListingSeo,
  seoDescriptionLimit,
  seoTitleLimit,
  type ListingSeoOverride,
  type SeoCheck,
  type SeoCompetition,
  type SeoKeyword,
  type SeoListingInput,
  type SeoScore,
  type SeoSuggestions,
} from "@shared/listing-seo";
import { ScoreBadge, kindLabels } from "./seo";

type SeoDetail = {
  listing: { kind: SeoListingInput["kind"]; id: string; name: string; location: string; live: boolean; path: string; editPath: string };
  input: SeoListingInput;
  auto: { title: string; description: string };
  override: ListingSeoOverride | null;
  suggestions: SeoSuggestions;
  score: SeoScore;
  otherTitles: string[];
  aiAvailable: boolean;
};

type AiSuggestions = { titles: string[]; description: string | null; keywords: SeoKeyword[]; tips: string[] };

const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");

const competitionStyle: Record<SeoCompetition, string> = {
  Medium: "bg-sky-50 text-sky-800 ring-sky-200",
  Lower: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  High: "bg-rose-50 text-rose-800 ring-rose-200",
};

function Counter({ value, limit }: { value: string; limit: number }) {
  const length = value.trim().length;
  return <span className={cn("text-xs font-normal tabular-nums", length > limit ? "text-rose-700" : "text-muted-foreground")}>{length}/{limit}</span>;
}

function clip(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}

function GooglePreview({ path, title, description }: { path: string; title: string; description: string }) {
  const crumbs = path.split("/").filter(Boolean).slice(0, 2).join(" › ");
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4" data-testid="seo-google-preview">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">How it can look on Google</div>
      <div className="mt-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-800 text-[10px] font-bold text-white">TBM</span>
        <div className="min-w-0 leading-tight">
          <div className="text-sm text-stone-900">Tembea Bila Matata</div>
          <div className="truncate text-xs text-stone-600">tembeabilamatata.com › {crumbs}</div>
        </div>
      </div>
      <div className="mt-2 text-lg leading-snug text-[#1a0dab]">{clip(title, seoTitleLimit + 2)}</div>
      <p className="mt-1 text-sm leading-6 text-stone-700">{clip(description, seoDescriptionLimit + 3)}</p>
    </div>
  );
}

function CheckRow({ check }: { check: SeoCheck }) {
  const Icon = check.status === "pass" ? CheckCircle2 : check.status === "warn" ? AlertTriangle : XCircle;
  return (
    <li className="flex gap-2 text-sm">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", check.status === "pass" ? "text-emerald-600" : check.status === "warn" ? "text-amber-600" : "text-rose-600")} aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2"><span className={check.status === "pass" ? "text-stone-700" : "font-medium"}>{check.label}</span><span className="text-xs tabular-nums text-muted-foreground">{check.points}/{check.max}</span></div>
        {check.fix ? <div className="text-xs leading-5 text-muted-foreground">{check.fix}</div> : null}
      </div>
    </li>
  );
}

function Section({ title, description, children, testId }: { title: string; description?: string; children: React.ReactNode; testId?: string }) {
  return (
    <Card className="border-stone-200/80 bg-white shadow-sm" data-testid={testId}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{title}</CardTitle>
        {description ? <CardDescription className="leading-6">{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export default function AdminSeoListing() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isLoading: authLoading, isAdmin } = useAuth();
  useEffect(() => {
    if (!authLoading && !isAdmin) setLocation(`/auth?next=/admin/seo/${kind}/${id}`);
  }, [authLoading, id, isAdmin, kind, setLocation]);
  const queryKey = ["/api/admin/seo/listings", kind ?? "", id ?? ""];
  const { data, isLoading, isError } = useQuery<SeoDetail>({ queryKey, enabled: isAdmin && Boolean(kind && id) });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [focus, setFocus] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [alts, setAlts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [ai, setAi] = useState<AiSuggestions | null>(null);

  useEffect(() => {
    if (!data) return;
    setTitle(data.override?.seoTitle ?? "");
    setDescription(data.override?.seoDescription ?? "");
    setFocus(data.override?.focusKeyword ?? "");
    setKeywords(data.override?.keywords ?? []);
    setAlts(data.override?.imageAlts ?? {});
    setDirty(false);
  }, [data]);

  const change = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setDirty(true); };
  const effectiveTitle = title.trim() || data?.auto.title || "";
  const effectiveDescription = description.trim() || data?.auto.description || "";
  const score = useMemo(() => (data ? scoreListingSeo(data.input, {
    title: effectiveTitle,
    description: effectiveDescription,
    focusKeyword: focus.trim() || null,
    imageAlts: alts,
    duplicateTitle: data.otherTitles.some((other) => other.trim().toLowerCase() === effectiveTitle.trim().toLowerCase()),
  }) : null), [alts, data, effectiveDescription, effectiveTitle, focus]);

  const save = useMutation({
    mutationFn: async () => apiRequest("PUT", `/api/admin/seo/listings/${kind}/${id}`, { seoTitle: title, seoDescription: description, focusKeyword: focus, keywords, imageAlts: alts }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo/listings"] });
      setDirty(false);
      toast({ title: "SEO saved", description: "Google sees the new text the next time it visits the page." });
    },
    onError: (error: Error) => toast({ title: "Couldn't save", description: errorText(error), variant: "destructive" }),
  });
  const askAi = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/seo/listings/${kind}/${id}/ai`, {})).json() as Promise<AiSuggestions>,
    onSuccess: (result) => {
      setAi(result);
      if (!result.titles.length && !result.description && !result.keywords.length) toast({ title: "Nothing usable this time", description: "The AI's ideas didn't pass the checks. Try again, or use the suggestions below." });
    },
    onError: (error: Error) => toast({ title: "AI suggestions didn't work", description: errorText(error), variant: "destructive" }),
  });

  if (isLoading || !data || !score) {
    return <AdminLayout><div className="px-4 py-6 text-sm text-muted-foreground">{isError ? "Couldn't load this listing." : "Loading…"}</div></AdminLayout>;
  }

  const { listing, suggestions, input } = data;
  const toggleKeyword = (phrase: string) => change(setKeywords)(keywords.includes(phrase) ? keywords.filter((item) => item !== phrase) : [...keywords, phrase]);
  const allKeywords: Array<SeoKeyword & { fromAi?: boolean }> = [
    ...suggestions.keywords,
    ...(ai?.keywords ?? []).filter((keyword) => !suggestions.keywords.some((item) => item.phrase.toLowerCase() === keyword.phrase.toLowerCase())).map((keyword) => ({ ...keyword, fromAi: true })),
  ];

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6 sm:pt-6">
        <Link href="/admin/seo" className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> All listings</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl font-semibold leading-tight sm:text-3xl">{listing.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{kindLabels[listing.kind]}</span><span>·</span><span>{listing.location || "No location"}</span>
              {listing.live ? <Badge variant="secondary" className="rounded-full">Live</Badge> : <Badge variant="outline" className="rounded-full">Not live: Google can't see it yet</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="rounded-full"><a href={listing.path} target="_blank" rel="noreferrer">View page <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>
            <Button asChild size="sm" variant="ghost" className="rounded-full"><Link href={listing.editPath}>Edit listing text and photos</Link></Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <aside className="min-w-0 space-y-4 lg:order-2">
            <div className="space-y-4 lg:sticky lg:top-4">
              <GooglePreview path={listing.path} title={effectiveTitle} description={effectiveDescription} />
              <div className="rounded-2xl border border-stone-200 bg-white p-4" data-testid="seo-score">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">SEO score</div>
                  <ScoreBadge score={score.score} grade={score.grade} />
                </div>
                <ul className="mt-3 space-y-2.5">{[...score.checks].sort((a, b) => (a.status === "pass" ? 1 : 0) - (b.status === "pass" ? 1 : 0)).map((check) => <CheckRow key={check.id} check={check} />)}</ul>
              </div>
            </div>
          </aside>

          <main className="min-w-0 space-y-5 lg:order-1">
            <Section
              title="Main search phrase"
              description="The words you most want this listing found for. The best main phrase is specific (place plus a feature the listing really has) with medium competition. Phrases come only from what the listing says."
              testId="seo-keywords"
            >
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Main phrase</span>
                <Input value={focus} onChange={(event) => change(setFocus)(event.target.value)} placeholder={suggestions.focusKeyword} data-testid="input-seo-focus" />
              </label>
              <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200">
                {allKeywords.map((keyword) => {
                  const isMain = focus.trim().toLowerCase() === keyword.phrase.toLowerCase();
                  return (
                    <li key={keyword.phrase} className={cn("flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between", isMain && "bg-teal-50/60")}>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{keyword.phrase}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-xs ring-1", competitionStyle[keyword.competition])}>{keyword.competition} competition</span>
                          {keyword.intent === "Planning" ? <span className="text-xs text-muted-foreground">Planning search</span> : null}
                          {keyword.fromAi ? <Badge variant="outline" className="rounded-full text-[10px]">AI</Badge> : null}
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">{keyword.why}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button type="button" size="sm" variant={isMain ? "default" : "outline"} className="h-9 rounded-full px-3" onClick={() => change(setFocus)(keyword.phrase)}>{isMain ? "Main phrase" : "Make main"}</Button>
                        <Button type="button" size="sm" variant={keywords.includes(keyword.phrase) ? "secondary" : "ghost"} className="h-9 rounded-full px-3" onClick={() => toggleKeyword(keyword.phrase)}>{keywords.includes(keyword.phrase) ? "Tracked" : "Track"}</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs leading-5 text-muted-foreground">Tracked phrases are TBM's notes for this listing: use them in the area page introduction, blog posts and the provider's listing text. Search volumes aren't measured here; competition is judged from who ranks for each kind of search on the Kenyan Coast.</p>
            </Section>

            <Section title="Google title" description={`Shown as the blue link. Keep it under ${seoTitleLimit} characters, main phrase first. Leave empty to use the automatic title.`} testId="seo-title">
              <label className="grid gap-1 text-sm">
                <span className="flex items-center justify-between font-medium">Title <Counter value={effectiveTitle} limit={seoTitleLimit} /></span>
                <Input value={title} onChange={(event) => change(setTitle)(event.target.value)} placeholder={data.auto.title} data-testid="input-seo-title" />
              </label>
              <div className="flex flex-col gap-2">
                {[...suggestions.titles, ...(ai?.titles ?? [])].filter((option, index, all) => all.indexOf(option) === index).map((option) => (
                  <button key={option} type="button" onClick={() => change(setTitle)(option)} className={cn("flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm hover:border-teal-400", title === option ? "border-teal-600 bg-teal-50" : "border-stone-200")}>
                    <span className="min-w-0">{option}{ai?.titles.includes(option) && !suggestions.titles.includes(option) ? <Badge variant="outline" className="ml-2 rounded-full text-[10px]">AI</Badge> : null}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{option.length}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Google description" description={`The two lines under the title. ${seoDescriptionLimit} characters at most: the main phrase, two real facts, and a reason to book on TBM.`} testId="seo-description">
              <label className="grid gap-1 text-sm">
                <span className="flex items-center justify-between font-medium">Description <Counter value={effectiveDescription} limit={seoDescriptionLimit} /></span>
                <Textarea rows={3} value={description} onChange={(event) => change(setDescription)(event.target.value)} placeholder={data.auto.description} data-testid="input-seo-description" />
              </label>
              <div className="flex flex-col gap-2">
                {[suggestions.description, ai?.description].filter((option): option is string => Boolean(option)).map((option, index) => (
                  <button key={option} type="button" onClick={() => change(setDescription)(option)} className={cn("rounded-xl border px-3 py-2 text-left text-sm leading-6 hover:border-teal-400", description === option ? "border-teal-600 bg-teal-50" : "border-stone-200")}>
                    {option}{index === 1 ? <Badge variant="outline" className="ml-2 rounded-full text-[10px]">AI</Badge> : null}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Photo text" description="Google Images and screen readers read this. Describe what each photo shows, in plain words, with the place: &quot;Pool and garden at Galu Sands Villa, Diani&quot;." testId="seo-photos">
              {input.photos.length ? (
                <>
                  <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => change(setAlts)({ ...suggestions.photoAlts, ...Object.fromEntries(Object.entries(alts).filter(([, value]) => value.trim())) })}>Fill the empty ones with suggestions</Button>
                  <ul className="space-y-3">
                    {input.photos.map((photo, index) => (
                      <li key={photo} className="flex gap-3">
                        <img src={photo} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-stone-100 object-cover sm:h-16 sm:w-20" loading="lazy" />
                        <Input value={alts[photo] ?? ""} onChange={(event) => change(setAlts)({ ...alts, [photo]: event.target.value })} placeholder={suggestions.photoAlts[photo]} aria-label={`Text for photo ${index + 1}`} className="min-w-0" />
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p className="text-sm text-muted-foreground">This listing has no photos yet. Add them on the listing first.</p>}
            </Section>

            <Section title="Who it's up against" description="The sites that already rank for this kind of search, and how a TBM listing beats them on the searches they don't cover well." testId="seo-competitors">
              <ul className="space-y-2">
                {suggestions.competitors.map((competitor) => (
                  <li key={competitor.name} className="rounded-xl bg-stone-50 px-3 py-2 text-sm"><span className="font-medium">{competitor.name}.</span> <span className="text-stone-700">{competitor.where}</span></li>
                ))}
              </ul>
              <div className="pt-1 text-sm font-medium">How to win</div>
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-stone-700">{suggestions.howToWin.map((tip) => <li key={tip}>{tip}</li>)}</ul>
            </Section>

            <Section title="Write with AI" description="Ideas for the title, description and phrases from this listing's facts. They're checked before you see them: right length, no competitor names, no claims the listing doesn't make. You still choose and save." testId="seo-ai">
              <Button type="button" variant="outline" className="rounded-full" onClick={() => askAi.mutate()} disabled={!data.aiAvailable || askAi.isPending} data-testid="button-seo-ai">
                <Sparkles className="mr-2 h-4 w-4" />{askAi.isPending ? "Thinking…" : ai ? "Ask again" : "Suggest with AI"}
              </Button>
              {!data.aiAvailable ? <p className="text-xs text-muted-foreground">Needs the Gemini key on the server. Everything else on this page works without it.</p> : null}
              {ai ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">{ai.titles.length} title{ai.titles.length === 1 ? "" : "s"}, {ai.description ? "1 description" : "no description"} and {ai.keywords.length} phrase{ai.keywords.length === 1 ? "" : "s"} added above, marked AI.</p>
                  {ai.tips.length ? <><div className="font-medium">Ideas for the listing text</div><ul className="list-disc space-y-1 pl-5 leading-6 text-stone-700">{ai.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul></> : null}
                </div>
              ) : null}
            </Section>
          </main>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 px-4 pt-3 backdrop-blur" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}>
        {/* Right padding keeps Save clear of the admin's Zaina sessions button. */}
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 pr-[4.5rem]">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <ScoreBadge score={score.score} grade={score.grade} />
            <span className="hidden text-muted-foreground sm:inline">{dirty ? "Unsaved changes" : "All saved"}</span>
          </div>
          <Button className="rounded-full px-6" onClick={() => save.mutate()} disabled={save.isPending || !dirty} data-testid="button-seo-save">{save.isPending ? "Saving…" : "Save SEO"}</Button>
        </div>
      </div>
    </AdminLayout>
  );
}
