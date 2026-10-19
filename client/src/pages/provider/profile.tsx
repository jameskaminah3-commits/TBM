import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BadgeCheck, Landmark, LockKeyhole, ShieldCheck, Smartphone } from "lucide-react";
import { ProviderLayout } from "@/components/provider-layout";
import { HubPageHeader, HubPanel, VerificationBadge } from "@/components/provider-hub/hub-ui";
import { ProviderPhotoField } from "@/components/provider-hub/provider-photo-field";
import { PartnerAdminThread } from "@/components/partner-admin-thread";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useProviderHub } from "@/hooks/use-provider-hub";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatKenyaDateTime } from "@shared/calendar-dates";
import { providerWorkspaces } from "@shared/provider-workspaces";
import { verificationDocuments } from "@shared/provider-applications";
import {
  describePayoutDestination,
  emptyProviderProfile,
  providerLanguages,
  providerServiceAreas,
  type ProviderProfileView,
} from "@shared/provider-profile";

type ProfileResponse = {
  account: { firstName: string; lastName: string; phone: string; email: string };
  profile: ProviderProfileView;
};

const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");

function invalidateProfile() {
  queryClient.invalidateQueries({ queryKey: ["/api/provider/profile"] });
  queryClient.invalidateQueries({ queryKey: ["/api/provider/profile/summary"] });
}

function ChipToggle({ options, value, onChange, label }: { options: readonly string[]; value: string[]; onChange: (next: string[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? value.filter((item) => item !== option) : [...value, option])}
            className={cn(
              "min-h-10 rounded-full border px-3.5 text-sm transition-colors",
              selected ? "border-teal-700 bg-teal-700 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-teal-300",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function BusinessSection({ profile, fallbackName }: { profile: ProviderProfileView; fallbackName: string }) {
  const { toast } = useToast();
  // The photo has its own field: it goes to TBM for a check, not with these details.
  const [form, setForm] = useState({
    businessName: profile.businessName,
    bio: profile.bio,
    languages: profile.languages,
    serviceAreas: profile.serviceAreas,
  });

  useEffect(() => {
    setForm({ businessName: profile.businessName, bio: profile.bio, languages: profile.languages, serviceAreas: profile.serviceAreas });
  }, [profile.businessName, profile.bio, profile.languages, profile.serviceAreas]);

  const save = useMutation({
    mutationFn: async () => apiRequest("PUT", "/api/provider/profile/business", form),
    onSuccess: () => {
      invalidateProfile();
      toast({ title: "Business details saved" });
    },
    onError: (error: Error) => toast({ title: "Couldn't save", description: errorText(error), variant: "destructive" }),
  });

  const bioLength = form.bio.trim().length;

  return (
    <HubPanel
      id="business"
      title="Your business"
      description="Helps TBM introduce you, match you with the right guests and check your account faster."
    >
      <div className="space-y-5">
        <ProviderPhotoField fallbackName={form.businessName || fallbackName} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="business-name">Business or trading name</Label>
            <Input id="business-name" value={form.businessName} maxLength={80} placeholder="For example, Diani Breeze Villas" onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="business-bio">About you</Label>
            <Textarea
              id="business-bio"
              rows={4}
              maxLength={600}
              value={form.bio}
              placeholder="Who you are, how long you've been doing this, and what guests love about your service."
              onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
            />
            <p className={cn("text-xs", bioLength >= 40 ? "text-emerald-700" : "text-muted-foreground")}>
              {bioLength >= 40 ? "Great, that's enough to introduce you." : `A sentence or two is enough (${Math.max(0, 40 - bioLength)} more characters).`}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Languages you speak with guests</div>
          <ChipToggle label="Languages" options={providerLanguages} value={form.languages} onChange={(languages) => setForm((current) => ({ ...current, languages }))} />
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Where you work</div>
          <ChipToggle label="Service areas" options={providerServiceAreas} value={form.serviceAreas} onChange={(serviceAreas) => setForm((current) => ({ ...current, serviceAreas }))} />
        </div>

        <Button type="button" className="w-full rounded-full sm:w-auto" disabled={save.isPending} onClick={() => save.mutate()} data-testid="button-save-business">
          {save.isPending ? "Saving…" : "Save business details"}
        </Button>
      </div>
    </HubPanel>
  );
}

function AccountSection({ account }: { account: ProfileResponse["account"] }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ firstName: account.firstName, lastName: account.lastName, phone: account.phone });
  useEffect(() => {
    setForm({ firstName: account.firstName, lastName: account.lastName, phone: account.phone });
  }, [account.firstName, account.lastName, account.phone]);

  const save = useMutation({
    mutationFn: async () => apiRequest("PATCH", "/api/auth/user", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/provider/profile"] });
      toast({ title: "Contact details saved" });
    },
    onError: (error: Error) => toast({ title: "Couldn't save", description: errorText(error), variant: "destructive" }),
  });

  return (
    <HubPanel id="contact" title="Contact details" description="How TBM reaches you about bookings. Guests don't see these.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="account-first-name">First name</Label>
          <Input id="account-first-name" autoComplete="given-name" value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-last-name">Last name</Label>
          <Input id="account-last-name" autoComplete="family-name" value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-phone">Phone (WhatsApp)</Label>
          <Input id="account-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-email">Email</Label>
          <Input id="account-email" value={account.email} readOnly disabled />
        </div>
      </div>
      <Button type="button" className="mt-4 w-full rounded-full sm:w-auto" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save contact details"}
      </Button>
    </HubPanel>
  );
}

function PayoutSection({ profile }: { profile: ProviderProfileView }) {
  const { toast } = useToast();
  const destination = describePayoutDestination(profile);
  const [editing, setEditing] = useState(!destination);
  const [method, setMethod] = useState<"mpesa" | "bank">(profile.payoutMethod ?? "mpesa");
  const [mpesa, setMpesa] = useState({ mpesaNumber: "", mpesaName: profile.mpesaName ?? "" });
  const [bank, setBank] = useState({ bankName: profile.bankName ?? "", bankAccountName: profile.bankAccountName ?? "", bankAccountNumber: "", bankBranch: profile.bankBranch ?? "" });

  useEffect(() => {
    setEditing(!describePayoutDestination(profile));
  }, [profile.payoutMethod, profile.mpesaNumber, profile.bankAccountNumber]);

  const save = useMutation({
    mutationFn: async () => apiRequest("PUT", "/api/provider/profile/payout", method === "mpesa" ? { payoutMethod: "mpesa", ...mpesa } : { payoutMethod: "bank", ...bank }),
    onSuccess: () => {
      invalidateProfile();
      setEditing(false);
      setMpesa((current) => ({ ...current, mpesaNumber: "" }));
      setBank((current) => ({ ...current, bankAccountNumber: "" }));
      toast({ title: "Payout details saved", description: "TBM confirms them before your next payout. We've emailed you a copy of this change." });
    },
    onError: (error: Error) => toast({ title: "Couldn't save", description: errorText(error), variant: "destructive" }),
  });

  return (
    <HubPanel id="payout" title="Where you get paid" description="TBM collects guest payments and pays you after each job, less the rate you agreed with TBM.">
      {destination ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white ring-1 ring-stone-200">
              {profile.payoutMethod === "bank" ? <Landmark className="h-5 w-5 text-stone-700" /> : <Smartphone className="h-5 w-5 text-emerald-700" />}
            </span>
            <div>
              <div className="font-medium" data-testid="text-payout-destination">{destination}</div>
              <div className="text-sm text-muted-foreground">
                {profile.payoutMethod === "mpesa" ? profile.mpesaName : profile.bankAccountName}
                {profile.payoutDetailsUpdatedAt ? ` · changed ${formatKenyaDateTime(profile.payoutDetailsUpdatedAt, { day: "numeric", month: "short", year: "numeric" }, "en-GB")}` : ""}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {profile.payoutDetailsStatus === "confirmed" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200" data-testid="status-payout-confirmed">
                <BadgeCheck className="h-3.5 w-3.5" /> Confirmed by TBM
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200" data-testid="status-payout-unconfirmed">
                Waiting for TBM to confirm
              </span>
            )}
            {!editing ? (
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setEditing(true)}>Change</Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className={cn("space-y-4", destination && "mt-4")}>
          <div role="radiogroup" aria-label="Payout method" className="grid grid-cols-2 gap-2">
            {([["mpesa", "M-Pesa", Smartphone], ["bank", "Bank account", Landmark]] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={method === value}
                onClick={() => setMethod(value)}
                className={cn(
                  "flex min-h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-medium",
                  method === value ? "border-teal-700 bg-teal-50 text-teal-900 ring-1 ring-teal-700" : "border-stone-200 bg-white text-stone-700",
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          {method === "mpesa" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="payout-mpesa-number">M-Pesa number</Label>
                <Input id="payout-mpesa-number" type="tel" inputMode="tel" placeholder="0712 345 678" value={mpesa.mpesaNumber} onChange={(event) => setMpesa((current) => ({ ...current, mpesaNumber: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payout-mpesa-name">Name on the M-Pesa account</Label>
                <Input id="payout-mpesa-name" value={mpesa.mpesaName} onChange={(event) => setMpesa((current) => ({ ...current, mpesaName: event.target.value }))} />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="payout-bank-name">Bank</Label>
                <Input id="payout-bank-name" placeholder="For example, Equity Bank" value={bank.bankName} onChange={(event) => setBank((current) => ({ ...current, bankName: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payout-bank-branch">Branch (optional)</Label>
                <Input id="payout-bank-branch" value={bank.bankBranch} onChange={(event) => setBank((current) => ({ ...current, bankBranch: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payout-bank-account-name">Account name</Label>
                <Input id="payout-bank-account-name" value={bank.bankAccountName} onChange={(event) => setBank((current) => ({ ...current, bankAccountName: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payout-bank-account-number">Account number</Label>
                <Input id="payout-bank-account-number" inputMode="numeric" value={bank.bankAccountNumber} onChange={(event) => setBank((current) => ({ ...current, bankAccountNumber: event.target.value }))} />
              </div>
            </div>
          )}
          <div className="flex items-start gap-2 rounded-2xl bg-stone-50 p-3 text-sm text-stone-600">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" />
            Only you and TBM's admins see these details. For your safety, TBM confirms every change before the next payout, and emails you when they change.
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="rounded-full" disabled={save.isPending} onClick={() => save.mutate()} data-testid="button-save-payout">
              {save.isPending ? "Saving…" : "Save payout details"}
            </Button>
            {destination ? <Button type="button" variant="ghost" className="rounded-full" onClick={() => setEditing(false)}>Cancel</Button> : null}
          </div>
        </div>
      ) : null}
    </HubPanel>
  );
}

// What TBM checks, by service: the same list the application and emails use.
const verificationProof: Record<string, string> = verificationDocuments;

function VerificationSection({ profile }: { profile: ProviderProfileView }) {
  const { toast } = useToast();
  const hub = useProviderHub();
  const ask = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/provider/profile/verification", {}),
    onSuccess: () => {
      invalidateProfile();
      toast({ title: "Request sent", description: "TBM will contact you to arrange the check." });
    },
    onError: (error: Error) => toast({ title: "Couldn't send", description: errorText(error), variant: "destructive" }),
  });
  const proofs = hub.workspaces.map((key) => `${providerWorkspaces[key].label}: ${verificationProof[key]}`);

  return (
    <HubPanel id="verification" title="Verification" action={<VerificationBadge status={profile.verificationStatus} />}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-stone-600">
          Verified providers show guests and TBM that the service is real and theirs to offer. TBM checks your ID and:
        </p>
        <ul className="space-y-1.5 text-sm text-stone-700">
          {proofs.map((proof) => (
            <li key={proof} className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />{proof}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">Documents stay private: only TBM's team sees them. They're never shown to guests.</p>
        {profile.verificationNote ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900">
            <span className="font-medium">Note from TBM:</span> {profile.verificationNote}
          </div>
        ) : null}
        {profile.verificationStatus === "verified" ? (
          <p className="text-sm font-medium text-emerald-800">
            Verified{profile.verifiedAt ? ` on ${formatKenyaDateTime(profile.verifiedAt, { day: "numeric", month: "short", year: "numeric" }, "en-GB")}` : ""}. Thank you.
          </p>
        ) : profile.verificationStatus === "in-review" ? (
          <p className="text-sm text-stone-700">TBM has your request and will contact you to arrange the check. Message TBM below if anything's changed.</p>
        ) : (
          <Button type="button" className="w-full rounded-full sm:w-auto" disabled={ask.isPending} onClick={() => ask.mutate()} data-testid="button-request-verification">
            {ask.isPending ? "Sending…" : "Ask TBM to verify me"}
          </Button>
        )}
      </div>
    </HubPanel>
  );
}

export default function ProviderProfilePage() {
  const { user, isProvider } = useAuth();
  const { data, isLoading } = useQuery<ProfileResponse>({ queryKey: ["/api/provider/profile"] });
  const profile = data?.profile ?? emptyProviderProfile;
  const account = data?.account ?? { firstName: user?.firstName ?? "", lastName: user?.lastName ?? "", phone: user?.phone ?? "", email: user?.email ?? "" };
  const fallbackName = [account.firstName, account.lastName].filter(Boolean).join(" ") || "Your business";

  useEffect(() => {
    if (!data || typeof window === "undefined" || !window.location.hash) return;
    window.setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [data]);

  return (
    <ProviderLayout title="Profile & payouts">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <HubPageHeader
          eyebrow="Profile & payouts"
          title="Your business on TBM"
          description="Who you are, how TBM reaches you, and where your money goes."
        />
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading your profile…</p>
        ) : (
          <>
            <BusinessSection profile={profile} fallbackName={fallbackName} />
            {isProvider ? (
              <HubPanel
                id="public-page-link"
                title="Your public page"
                description="One link for all your services, with your photo, reviews and TBM's booking support. Switch it on or off, preview it and share it in Share & grow."
                action={<Button asChild className="rounded-full"><a href="/provider/share#public-page" data-testid="link-public-page-settings">Switch on or manage</a></Button>}
              >
                {null}
              </HubPanel>
            ) : null}
            <PayoutSection profile={profile} />
            <VerificationSection profile={profile} />
            <AccountSection account={account} />
            {isProvider ? (
              <HubPanel id="message-tbm" title="Message TBM" description="Account questions, listing checks, payouts or anything outside a booking.">
                <PartnerAdminThread mode="provider" providerUserId={user?.id} title="Message TBM" description="" enabled={isProvider} defaultOpen={false} />
              </HubPanel>
            ) : null}
          </>
        )}
      </div>
    </ProviderLayout>
  );
}
