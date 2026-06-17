import { useState } from "react";
import { MessageCircle, ArrowRight, X, Check } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { WHATSAPP_URL } from "@/lib/contact-info";
import { customServiceRequestFeeUsd } from "@shared/custom-service";

const SERVICES = [
  { id: "accommodation", label: "Accommodation", emoji: "🏠" },
  { id: "transport", label: "Transport", emoji: "🚗" },
  { id: "experiences", label: "Experiences", emoji: "🧭" },
  { id: "private-chef", label: "Private Chef", emoji: "👨‍🍳" },
  { id: "errands", label: "Errands & Support", emoji: "🛒" },
  { id: "custom", label: "Custom Request", emoji: "⭐" },
] as const;

type ServiceId = (typeof SERVICES)[number]["id"];

function buildWhatsAppMessage(selected: Set<ServiceId>): string {
  const lines = SERVICES.filter((s) => selected.has(s.id)).map((s) => `✅ ${s.label}`);
  let msg = `Hi Tembea Bila Matata 👋\n\nI'd like assistance with:\n${lines.join("\n")}`;
  if (selected.has("custom")) {
    msg += `\n\nI'm interested in your Concierge Planning & Coordination Service.`;
  }
  return msg;
}

export function ChatConcierge() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<ServiceId>>(new Set());

  const toggle = (id: ServiceId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const hasCustom = selected.has("custom");
  const canProceed = selected.size > 0;

  const handleWhatsApp = () => {
    const msg = buildWhatsAppMessage(selected);
    window.open(`${WHATSAPP_URL}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
    setOpen(false);
    setSelected(new Set());
  };

  return (
    <>
      {/* Floating trigger button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bottom-above-tab fixed right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[0_8px_30px_-8px_rgba(13,148,136,0.65)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_12px_36px_-8px_rgba(13,148,136,0.75)] active:scale-95"
        aria-label="Open chat concierge"
      >
        <MessageCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span>Chat Concierge</span>
      </button>

      {/* Backdrop */}
      {open ? (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chat Concierge"
        className={cn(
          "fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-[2rem] border-t border-border/60 bg-background shadow-[0_-20px_60px_-20px_rgba(15,23,42,0.35)] transition-transform duration-300 ease-out",
          "md:inset-x-auto md:right-4 md:bottom-4 md:w-[420px] md:rounded-[2rem] md:border md:shadow-[0_24px_80px_-24px_rgba(15,23,42,0.45)]",
          open ? "translate-y-0" : "translate-y-full md:translate-y-[110%]",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Handle */}
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-border/70 md:hidden" />

        <div className="flex items-start justify-between px-5 pb-2 pt-4">
          <div>
            <h2 className="font-serif text-xl font-medium text-foreground">How can we help?</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Select what you need — we'll open WhatsApp with a ready message.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/60 text-muted-foreground transition hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-5 pt-3">
          {/* Service toggles */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SERVICES.map(({ id, label, emoji }) => {
              const active = selected.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  className={cn(
                    "relative flex flex-col items-start gap-1.5 rounded-[1.1rem] border px-3.5 py-3 text-left text-sm transition-all duration-150 active:scale-[0.97]",
                    active
                      ? "border-primary/50 bg-primary/8 shadow-[0_4px_14px_-6px_rgba(13,148,136,0.4)]"
                      : "border-border/60 bg-card/70 hover:border-border hover:bg-card",
                  )}
                  aria-pressed={active}
                >
                  {active ? (
                    <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                  ) : null}
                  <span className="text-base leading-none">{emoji}</span>
                  <span className={cn("font-medium leading-snug", active ? "text-primary" : "text-foreground")}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Custom Request fee note */}
          {hasCustom ? (
            <div className="mt-4 rounded-[1.2rem] border border-primary/25 bg-primary/6 px-4 py-3.5">
              <p className="text-sm font-semibold text-foreground">
                Concierge Planning & Coordination
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Personalised itinerary, villa search, group trip planning, special events, or a
                fully coordinated travel experience — handled for you.
              </p>
              <p className="mt-2 text-sm text-foreground">
                One-time fee:{" "}
                <span className="font-semibold text-primary">
                  KSh {(customServiceRequestFeeUsd * 130).toLocaleString()} / ${customServiceRequestFeeUsd}
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Fully credited toward your booking when you proceed with us.
              </p>
            </div>
          ) : null}

          {/* CTAs */}
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              disabled={!canProceed}
              onClick={handleWhatsApp}
              className={cn(
                "flex h-12 w-full items-center justify-center gap-2 rounded-[1rem] font-semibold transition-all duration-150",
                canProceed
                  ? "bg-[#25D366] text-white shadow-[0_6px_20px_-8px_rgba(37,211,102,0.6)] hover:bg-[#22c55e] active:scale-[0.98]"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Continue on WhatsApp
              <ArrowRight className="h-3.5 w-3.5" />
            </button>

            <Link
              href="/request-custom-service"
              onClick={() => setOpen(false)}
              className="flex h-10 w-full items-center justify-center rounded-[1rem] text-sm text-muted-foreground transition hover:text-foreground"
            >
              Or submit a written request instead
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
