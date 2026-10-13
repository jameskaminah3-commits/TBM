// An applicant's own status page, opened from the link in their receipt email.
// The link's token travels in the address's # part, so it never reaches server
// logs or other sites, and it's taken out of the address bar once read.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Check, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatKenyaDateTime } from "@shared/calendar-dates";
import { applicationStages, officialContactLine } from "@shared/provider-applications";
import { SUPPORT_WHATSAPP_URL } from "@shared/support-contact";

type StatusResponse = {
  reference: string;
  firstName: string | null;
  service: string;
  status: string;
  stageLabel: string;
  next: string;
  message: string | null;
  reason: string | null;
  appliedAt: string;
  updatedAt: string;
};

// The path an application takes, as the applicant sees it.
const happyPath = ["new", "contacted", "approved"];

export default function ApplicationStatusPage() {
  const [state, setState] = useState<{ loading: boolean; data: StatusResponse | null; error: string | null }>({ loading: true, data: null, error: null });

  useEffect(() => {
    const token = window.location.hash.replace(/^#/, "").trim();
    if (token) window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setState({ loading: false, data: null, error: "Open this page from the link in your email." });
      return;
    }
    (async () => {
      try {
        const response = await fetch("/api/provider-applications/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Couldn't load your application.");
        setState({ loading: false, data: body as StatusResponse, error: null });
      } catch (error) {
        setState({ loading: false, data: null, error: error instanceof Error ? error.message : "Couldn't load your application." });
      }
    })();
  }, []);

  const data = state.data;
  const steps = data
    ? data.status === "needs-info"
      ? ["new", "contacted", "needs-info", "approved"]
      : data.status === "declined"
        ? ["new", "contacted", "declined"]
        : happyPath
    : happyPath;
  const currentIndex = data ? steps.indexOf(data.status) : -1;

  return (
    <div className="min-h-[70vh] bg-[#fbf8f3] px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-xl space-y-5">
        <Link href="/partner" className="text-sm text-stone-600 hover:text-stone-950">Become a provider</Link>
        <div className="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-[0_40px_90px_-60px_rgba(15,61,58,0.6)] sm:p-8" data-testid="application-status">
          {state.loading ? (
            <p className="flex items-center gap-2 text-stone-600"><Loader2 className="h-4 w-4 animate-spin" />Loading your application…</p>
          ) : state.error || !data ? (
            <div className="space-y-3">
              <h1 className="font-serif text-3xl font-semibold text-stone-950">Your application</h1>
              <p className="text-stone-700" data-testid="text-status-error">{state.error}</p>
              <Button asChild variant="outline" className="rounded-full"><a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp TBM</a></Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Application {data.reference}</div>
                <h1 className="mt-1 font-serif text-3xl font-semibold text-stone-950">{data.firstName ? `Habari, ${data.firstName}` : "Your application"}</h1>
                <p className="mt-1 text-sm text-stone-600">To offer {data.service} with TBM · applied {formatKenyaDateTime(data.appliedAt, { day: "numeric", month: "short", year: "numeric" }, "en-GB")}</p>
              </div>
              <ol className="space-y-3" aria-label="Where your application is">
                {steps.map((status, index) => {
                  const stage = applicationStages.find((item) => item.status === status)!;
                  const done = index < currentIndex;
                  const current = index === currentIndex;
                  return (
                    <li key={status} className="flex items-start gap-3" aria-current={current ? "step" : undefined}>
                      <span className={cn(
                        "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        done ? "bg-emerald-600 text-white" : current ? (status === "declined" ? "bg-stone-700 text-white" : "bg-amber-400 text-stone-950") : "bg-stone-100 text-stone-500",
                      )}>{done ? <Check className="h-4 w-4" /> : index + 1}</span>
                      <div>
                        <div className={cn("font-medium", current ? "text-stone-950" : done ? "text-stone-600" : "text-stone-400")}>{stage.label}</div>
                        {current ? <p className="text-sm text-stone-600" data-testid="text-status-next">{data.next}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {data.reason || data.message ? (
                <div className="space-y-1 rounded-2xl bg-stone-50 p-4 text-sm text-stone-700" data-testid="text-status-message">
                  <div className="font-medium text-stone-950">From TBM</div>
                  {data.reason ? <p>{data.reason}</p> : null}
                  {data.message ? <p className="whitespace-pre-line">{data.message}</p> : null}
                </div>
              ) : null}
              <p className="text-xs text-stone-500">Last updated {formatKenyaDateTime(data.updatedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }, "en-GB")}. Questions? WhatsApp TBM and quote {data.reference}.</p>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-stone-500">{officialContactLine}</p>
      </div>
    </div>
  );
}
