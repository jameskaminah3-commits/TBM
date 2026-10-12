import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useParams } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Camera, CheckCircle2, ImagePlus, Loader2, LockKeyhole, MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WorkspaceIcon } from "@/components/provider-hub/hub-ui";
import { optimizeImage } from "@/components/admin-media-field";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { safeSessionStorage } from "@/lib/safe-storage";
import { cn } from "@/lib/utils";
import NotFound from "@/pages/not-found";
import {
  applicationDetailFields,
  isApplicationServiceType,
  providerApplicationSchema,
  type ApplicationDetailField,
  type ApplicationServiceType,
} from "@shared/provider-applications";
import { providerWorkspaces } from "@shared/provider-workspaces";
import { SUPPORT_WHATSAPP_URL } from "@shared/support-contact";

type Draft = {
  details: Record<string, string | number | string[]>;
  fullName: string;
  phone: string;
  email: string;
  town: string;
  photos: Array<{ label: string; url: string; preview?: string }>;
  consent: boolean;
};

const emptyDraft: Draft = { details: {}, fullName: "", phone: "", email: "", town: "", photos: [], consent: false };

const intro: Record<ApplicationServiceType, { title: string; lead: string; photoHint: string }> = {
  stays: { title: "List your stay", lead: "Tell us about the place. Guests book villas and apartments across the Coast through TBM.", photoHint: "The view, the pool, the bedrooms, the living room." },
  cooks: { title: "Cook for TBM guests", lead: "Tell us about your cooking. Guests book private chefs for villa dinners, birthdays and family holidays.", photoHint: "Dishes you're proud of, and you at work." },
  errands: { title: "Offer home help", lead: "Tell us how you help. Families on holiday book cleaning, shopping, laundry and childcare.", photoHint: "Your work, or a clear photo of you." },
  experiences: { title: "List your experience", lead: "Tell us about your trip or activity. Guests book days out, boat trips and tours.", photoHint: "Guests enjoying it, the boat or place, the view." },
};

const steps = ["Your service", "About you", "Photos", "Check and send"] as const;

function DetailInput({ field, value, onChange }: { field: ApplicationDetailField; value: Draft["details"][string] | undefined; onChange: (next: Draft["details"][string]) => void }) {
  const id = `detail-${field.key}`;
  if (field.type === "select" || field.type === "multi") {
    const selected = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium" id={id}>{field.label}{field.required ? "" : " (optional)"}</div>
        <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
          {field.options?.map((option) => {
            const isOn = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                aria-pressed={isOn}
                onClick={() => {
                  if (field.type === "multi") onChange(isOn ? selected.filter((item) => item !== option) : [...selected, option]);
                  else onChange(isOn ? "" : option);
                }}
                className={cn(
                  "min-h-11 rounded-full border px-4 text-sm transition-colors",
                  isOn ? "border-teal-700 bg-teal-700 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-teal-300",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{field.label}{field.required ? "" : " (optional)"}</Label>
      {field.type === "textarea" ? (
        <Textarea id={id} rows={4} maxLength={1200} placeholder={field.placeholder} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input
          id={id}
          type={field.type === "number" ? "number" : "text"}
          inputMode={field.type === "number" ? "numeric" : undefined}
          min={field.type === "number" ? 0 : undefined}
          placeholder={field.placeholder}
          value={value === undefined ? "" : String(value)}
          onChange={(event) => onChange(field.type === "number" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value)}
          className="h-12"
        />
      )}
    </div>
  );
}

export default function ProviderServiceApplication() {
  const params = useParams<{ type: string }>();
  const serviceType = isApplicationServiceType(params.type) ? params.type : null;
  if (!serviceType) return <NotFound />;
  return <ApplicationForm serviceType={serviceType} />;
}

function ApplicationForm({ serviceType }: { serviceType: ApplicationServiceType }) {
  const { toast } = useToast();
  const storageKey = `tbm-provider-application-${serviceType}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = safeSessionStorage.getItem(storageKey);
      return saved ? { ...emptyDraft, ...JSON.parse(saved) } : emptyDraft;
    } catch {
      return emptyDraft;
    }
  });
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const fields = applicationDetailFields[serviceType];
  const label = providerWorkspaces[serviceType].label;

  // Kept for this browser tab, so a reload or a phone call doesn't lose the answers.
  useEffect(() => {
    const { photos, ...rest } = draft;
    safeSessionStorage.setItem(storageKey, JSON.stringify({ ...rest, photos: photos.map(({ label: photoLabel, url }) => ({ label: photoLabel, url })) }));
  }, [draft, storageKey]);

  const goTo = (next: number) => {
    setError(null);
    setStep(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const checkStep = (index: number) => {
    if (index === 0) {
      const missing = fields.find((field) => {
        const value = draft.details[field.key];
        return field.required && (value === undefined || value === "" || (Array.isArray(value) && !value.length));
      });
      return missing ? `Add: ${missing.label.toLowerCase()}` : null;
    }
    if (index === 1) {
      const result = providerApplicationSchema.safeParse({ serviceType, ...draft, details: draft.details, consent: true });
      const issue = result.success ? null : result.error.issues.find((item) => ["fullName", "phone", "email", "town"].includes(String(item.path[0])));
      return issue?.message ?? null;
    }
    return null;
  };

  const next = () => {
    const problem = checkStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    goTo(step + 1);
  };

  const addPhotos = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 6 - draft.photos.length);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await optimizeImage(file);
        const response = await apiRequest("POST", "/api/fleet-applications/upload", { dataUrl, mimeType: "image/jpeg" });
        const { uploadUrl } = await response.json() as { uploadUrl: string };
        setDraft((current) => ({ ...current, photos: [...current.photos, { label: `Photo ${current.photos.length + 1}`, url: uploadUrl, preview: dataUrl }] }));
      }
    } catch (uploadError) {
      toast({ title: "A photo didn't upload", description: uploadError instanceof Error ? uploadError.message.replace(/^\d+:\s*/, "") : "Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const submit = useMutation({
    mutationFn: async () => {
      const payload = {
        serviceType,
        fullName: draft.fullName,
        phone: draft.phone,
        email: draft.email,
        town: draft.town,
        details: Object.fromEntries(Object.entries(draft.details).filter(([, value]) => value !== "" && !(Array.isArray(value) && !value.length))),
        photos: draft.photos.map(({ label: photoLabel, url }) => ({ label: photoLabel, url })),
        consent: draft.consent,
      };
      const parsed = providerApplicationSchema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check your answers");
      return apiRequest("POST", "/api/provider-applications", payload);
    },
    onSuccess: () => {
      safeSessionStorage.removeItem(storageKey);
      setSent(true);
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onError: (submitError: Error) => setError(submitError.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1")),
  });

  if (sent) {
    return (
      <div ref={topRef} className="min-h-[70vh] bg-[#fbf8f3] px-4 py-14">
        <div className="mx-auto max-w-xl rounded-[2rem] border border-stone-200 bg-white p-6 text-center shadow-[0_40px_90px_-60px_rgba(15,61,58,0.6)] sm:p-10" data-testid="application-sent">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
          <h1 className="mt-4 font-serif text-3xl font-semibold text-stone-950">Asante, {draft.fullName.split(/\s+/)[0] || "karibu"}!</h1>
          <p className="mt-3 text-stone-700">Your application is with TBM. We've emailed you a copy.</p>
          <ol className="mx-auto mt-6 max-w-sm space-y-3 text-left text-sm text-stone-700">
            <li className="flex gap-3"><span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-semibold text-stone-950">1</span>Our team reviews your application and calls or WhatsApps you. We review them in the order they arrive.</li>
            <li className="flex gap-3"><span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-semibold text-stone-950">2</span>We check your ID and that the service is yours to offer.</li>
            <li className="flex gap-3"><span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-semibold text-stone-950">3</span>If you're approved, we email you a link to your Provider Hub. Add your listing, set your prices and start sharing.</li>
          </ol>
          <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild className="rounded-full"><Link href="/partner">Back to Become a provider</Link></Button>
            <Button asChild variant="outline" className="rounded-full"><a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp TBM</a></Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={topRef} className="scroll-mt-16 bg-[#fbf8f3] px-4 pb-16 pt-6 sm:pt-10">
      <div className="mx-auto max-w-2xl">
        <Link href="/partner" className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-950"><ArrowLeft className="h-4 w-4" />Become a provider</Link>
        <div className="mt-4 flex items-center gap-3">
          <WorkspaceIcon workspace={serviceType} className="h-12 w-12" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">{label}</div>
            <h1 className="font-serif text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">{intro[serviceType].title}</h1>
          </div>
        </div>
        <p className="mt-3 text-stone-600">{intro[serviceType].lead} About five minutes; nothing is public until TBM has checked it with you.</p>

        <div className="mt-6" aria-label={`Step ${step + 1} of ${steps.length}`}>
          <div className="flex items-center justify-between text-xs font-medium text-stone-600">
            <span>Step {step + 1} of {steps.length}: {steps[step]}</span>
            <span>{Math.round(((step + 1) / steps.length) * 100)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-600 to-emerald-500 transition-all" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
        </div>

        <div className="mt-6 space-y-5 rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-[0_30px_70px_-55px_rgba(28,25,23,0.6)] sm:p-7" data-testid={`application-step-${step}`}>
          {step === 0 ? fields.map((field) => (
            <DetailInput key={field.key} field={field} value={draft.details[field.key]} onChange={(value) => setDraft((current) => ({ ...current, details: { ...current.details, [field.key]: value } }))} />
          )) : null}

          {step === 1 ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="apply-name">Your full name</Label>
                <Input id="apply-name" autoComplete="name" className="h-12" value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="apply-phone">Phone (WhatsApp)</Label>
                  <Input id="apply-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" className="h-12" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apply-email">Email</Label>
                  <Input id="apply-email" type="email" inputMode="email" autoComplete="email" className="h-12" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="apply-town">Where you're based</Label>
                <Input id="apply-town" placeholder="For example, Diani" className="h-12" value={draft.town} onChange={(event) => setDraft((current) => ({ ...current, town: event.target.value }))} />
              </div>
              <p className="flex items-start gap-2 text-xs text-stone-500"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />TBM uses these to contact you about your application. They aren't shown to guests.</p>
            </>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div>
                <div className="font-medium text-stone-950">Add up to 6 photos (optional)</div>
                <p className="text-sm text-stone-600">{intro[serviceType].photoHint} Good photos help TBM say yes faster. They stay private until your listing is published.</p>
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={addPhotos} data-testid="input-application-photos" />
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {draft.photos.map((photo, index) => (
                  <div key={photo.url} className="relative aspect-square overflow-hidden rounded-2xl bg-stone-100">
                    {photo.preview ? <img src={photo.preview} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-stone-500"><Camera className="h-5 w-5" /></div>}
                    <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, photos: current.photos.filter((item) => item.url !== photo.url) }))} className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 shadow">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {draft.photos.length < 6 ? (
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-stone-300 text-xs font-medium text-stone-600 hover:border-teal-400 hover:text-teal-800">
                    {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
                    {uploading ? "Uploading" : "Add photos"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <dl className="divide-y divide-stone-100 rounded-2xl bg-stone-50 px-4 text-sm">
                {[
                  ["Service", label],
                  ...fields.filter((field) => draft.details[field.key] !== undefined && draft.details[field.key] !== "").map((field) => {
                    const value = draft.details[field.key];
                    return [field.label, Array.isArray(value) ? value.join(", ") : String(value)];
                  }),
                  ["Name", draft.fullName],
                  ["Phone", draft.phone],
                  ["Email", draft.email],
                  ["Based in", draft.town],
                  ["Photos", String(draft.photos.length)],
                ].map(([term, value]) => (
                  <div key={term} className="flex justify-between gap-4 py-2.5">
                    <dt className="text-stone-500">{term}</dt>
                    <dd className="max-w-[60%] text-right font-medium text-stone-900">{value}</dd>
                  </div>
                ))}
              </dl>
              <label className="flex items-start gap-3 rounded-2xl border border-stone-200 p-4 text-sm text-stone-700">
                <Checkbox checked={draft.consent} onCheckedChange={(checked) => setDraft((current) => ({ ...current, consent: checked === true }))} className="mt-0.5" data-testid="checkbox-application-consent" />
                <span>TBM may call, WhatsApp or email me about this application, and keep my details and photos to review it. <Link href="/privacy" className="text-teal-800 underline">Privacy</Link></span>
              </label>
            </div>
          ) : null}

          {error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800" data-testid="text-application-error">{error}</p> : null}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
            {step > 0 ? (
              <Button type="button" variant="ghost" className="rounded-full" onClick={() => goTo(step - 1)}><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
            ) : <span />}
            {step < steps.length - 1 ? (
              <Button type="button" className="h-12 rounded-full px-8" onClick={next} disabled={uploading} data-testid="button-application-next">
                {step === 2 && !draft.photos.length ? "Skip for now" : "Continue"}<ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" className="h-12 rounded-full bg-amber-400 px-8 font-semibold text-stone-950 hover:bg-amber-300" disabled={!draft.consent || submit.isPending} onClick={() => submit.mutate()} data-testid="button-application-send">
                {submit.isPending ? "Sending…" : "Send my application"}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-stone-500">No joining or monthly fee. TBM's commission is agreed with you before your first payout. Questions? <a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noreferrer" className="underline">WhatsApp TBM</a>.</p>
      </div>
    </div>
  );
}
