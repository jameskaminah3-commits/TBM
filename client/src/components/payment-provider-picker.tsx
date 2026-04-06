import type { ReactNode } from "react";
import { ChevronRight, CreditCard, ShieldCheck, Smartphone } from "lucide-react";
import { FaApplePay, FaCcMastercard, FaCcVisa } from "react-icons/fa6";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { CustomerPaymentMethod, CustomerPaymentProvider } from "@shared/schema";

export type CustomerPaymentChoice = CustomerPaymentMethod;

type PaymentChoiceOption = {
  label: string;
  title: string;
  description: string;
  helper: string;
  tone: string;
  badge: string;
};

export const paymentChoiceOptions: Record<CustomerPaymentChoice, PaymentChoiceOption> = {
  card: {
    label: "Card",
    title: "Card and Apple Pay",
    description: "Visa, Mastercard, and Apple Pay.",
    helper: "For card and wallet checkout.",
    tone: "border-sky-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.96),rgba(255,255,255,0.98))] text-sky-950",
    badge: "Travel-ready",
  },
  mpesa: {
    label: "M-Pesa",
    title: "M-Pesa",
    description: "Fast mobile-money checkout.",
    helper: "For local phone payments.",
    tone: "border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))] text-emerald-950",
    badge: "Local favorite",
  },
};

export const bookingCheckoutPreviewCopy = {
  title: "Ready to lock this in?",
  description: "Checkout is quick by card, Apple Pay, or M-Pesa. If payment pauses, we keep your booking safe so you can finish without starting over.",
} as const;

export const customRequestCheckoutPreviewCopy = {
  title: "Ready to get this moving?",
  description: "Your request fee is credited toward the final booking. Card, Apple Pay, and M-Pesa stay ready whenever you are, and if checkout pauses, we keep everything safely saved.",
} as const;

export function getPaymentChoiceForProvider(provider: CustomerPaymentProvider | string | null | undefined): CustomerPaymentChoice {
  return provider === "pesapal" ? "mpesa" : "card";
}

export function getPaymentChoiceLabelForProvider(provider: CustomerPaymentProvider | string | null | undefined) {
  return paymentChoiceOptions[getPaymentChoiceForProvider(provider)].label;
}

function PaymentBrandMarks({ choice, className }: { choice?: CustomerPaymentChoice; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {(choice === undefined || choice === "card") ? (
        <>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[0_12px_24px_-22px_rgba(15,23,42,0.28)]">
            <FaCcVisa className="h-4 w-4 text-sky-700" />
            Visa
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[0_12px_24px_-22px_rgba(15,23,42,0.28)]">
            <FaCcMastercard className="h-4 w-4 text-rose-500" />
            Mastercard
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[0_12px_24px_-22px_rgba(15,23,42,0.28)]">
            <FaApplePay className="h-5 w-5 text-slate-950" />
            Apple Pay
          </span>
        </>
      ) : null}

      {(choice === undefined || choice === "mpesa") ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 shadow-[0_12px_24px_-22px_rgba(5,150,105,0.28)]">
          <Smartphone className="h-3.5 w-3.5" />
          M-Pesa
        </span>
      ) : null}
    </div>
  );
}

export function CheckoutPaymentPreview({
  className,
  title = "Payment at checkout",
  description = "Choose your payment method in the final step.",
}: {
  className?: string;
  title?: string;
  description?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-[26px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,248,251,0.94))] p-4 shadow-[0_18px_36px_-30px_rgba(15,23,42,0.24)]", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Checkout</div>
          <div className="mt-1 text-base font-semibold tracking-tight text-foreground">{title}</div>
        </div>
        <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-800">
          Secure
        </Badge>
      </div>

      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <PaymentBrandMarks className="mt-3" />
    </div>
  );
}

export function CheckoutPaymentSheet({
  open,
  onOpenChange,
  value,
  onChange,
  amount,
  title = "Choose payment method",
  description = "Select one to continue.",
  confirmLabel = "Open secure checkout",
  confirmBusyLabel = "Opening secure checkout...",
  onConfirm,
  isSubmitting = false,
  note = "Apple Pay appears on supported devices.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: CustomerPaymentChoice;
  onChange: (value: CustomerPaymentChoice) => void;
  amount?: ReactNode;
  title?: string;
  description?: string;
  confirmLabel?: string;
  confirmBusyLabel?: string;
  onConfirm: () => void;
  isSubmitting?: boolean;
  note?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-[30px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(248,250,252,0.97))] p-0 shadow-[0_30px_90px_-42px_rgba(15,23,42,0.48)] sm:max-h-[calc(100vh-3rem)]">
        <div className="shrink-0 border-b border-border/60 bg-[linear-gradient(135deg,rgba(15,23,42,0.03),rgba(13,148,136,0.07),rgba(255,255,255,0.98))] px-5 py-6 sm:px-6">
          <DialogHeader className="text-left">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-muted-foreground">Checkout</div>
                <DialogTitle className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{title}</DialogTitle>
              </div>
              <Badge variant="outline" className="rounded-full border-emerald-200 bg-white/90 text-emerald-800">
                Secure
              </Badge>
            </div>
            <DialogDescription className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              {description}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 rounded-[24px] border border-border/60 bg-white/90 p-4 shadow-[0_18px_32px_-28px_rgba(15,23,42,0.22)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Amount due</div>
                <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                  {amount ?? "Ready for checkout"}
                </div>
              </div>
              <PaymentBrandMarks />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 py-6 sm:px-6">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <RadioGroup
              value={value}
              onValueChange={(nextValue) => onChange(nextValue as CustomerPaymentChoice)}
              className="gap-4"
            >
              {(["card", "mpesa"] as const).map((choice) => {
                const option = paymentChoiceOptions[choice];
                const selected = value === choice;

                return (
                  <label
                    key={choice}
                    className={cn(
                      "group flex cursor-pointer items-start gap-4 rounded-[26px] border px-4 py-4 transition-all duration-200",
                      selected
                        ? option.tone + " shadow-[0_20px_38px_-30px_rgba(15,23,42,0.26)]"
                        : "border-border/60 bg-white hover:border-border hover:bg-muted/20",
                    )}
                  >
                    <RadioGroupItem value={choice} className="mt-1.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="font-semibold text-foreground">{option.title}</div>
                        <Badge variant="secondary" className="rounded-full bg-white/80 text-foreground">
                          {option.badge}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-foreground/90">{option.description}</p>
                      <PaymentBrandMarks choice={choice} className="mt-3" />
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">{option.helper}</p>
                    </div>
                    <div className={cn(
                      "mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border bg-white/90 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.26)]",
                      selected ? "border-current/20" : "border-border/60",
                    )}>
                      {choice === "card" ? (
                        <CreditCard className="h-5 w-5" />
                      ) : (
                        <Smartphone className="h-5 w-5" />
                      )}
                    </div>
                  </label>
                );
              })}
            </RadioGroup>

            <div className="mt-4 flex items-start gap-3 rounded-[22px] border border-border/60 bg-white/85 px-4 py-3 text-sm leading-6 text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{note}</span>
            </div>
          </div>

          <DialogFooter className="mt-6 shrink-0 gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
            <Button type="button" variant="outline" className="rounded-full px-5" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Back
            </Button>
            <Button type="button" className="rounded-full px-6" onClick={onConfirm} disabled={isSubmitting}>
              {isSubmitting ? confirmBusyLabel : confirmLabel}
              {!isSubmitting ? <ChevronRight className="ml-2 h-4 w-4" /> : null}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
