// Admin → Bookings: the commitment that locks a booking's dates (50% unless
// the team agreed another percentage or amount with the guest), and locking
// the dates by hand — a guest paying by bank transfer or on arrival, as
// agreed — until a moment the team chooses.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  bookingDepositPercent,
  getBookingCheckoutAmount,
  hasActiveAdminLock,
  resolveAgreedCommitment,
} from "@shared/booking-payments";
import { formatKenyaDateTime, isOnKenyaTime, kenyaDateTimeToIso, todayInKenya } from "@shared/calendar-dates";
import type { Booking } from "@shared/schema";

type ControlProps = {
  booking: Booking;
  formatAmount: (amountUsd: number) => string;
  onUpdated: (booking: Booking) => void;
};

const kenyaTime = (value: string) => `${formatKenyaDateTime(value)}${isOnKenyaTime() ? "" : " (Kenya time)"}`;

/** The commitment for this booking, as a percentage or an amount in US$. */
export function BookingCommitmentControl({ booking, formatAmount, onUpdated }: ControlProps) {
  const { toast } = useToast();
  const current = typeof booking.paymentDepositAmount === "number" && booking.paymentDepositAmount > 0
    && booking.paymentDepositAmount < booking.totalPrice
    ? booking.paymentDepositAmount
    : null;
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState(
    current ? String(Math.round((current / booking.totalPrice) * 100)) : String(bookingDepositPercent),
  );
  const [notifyGuest, setNotifyGuest] = useState(true);
  const number = Number(value.trim());
  const preview = value.trim() === "" || !Number.isFinite(number)
    ? null
    : resolveAgreedCommitment(booking.totalPrice, mode === "percent" ? { percent: number } : { amount: number });

  const setCommitment = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("PATCH", `/api/admin/bookings/${booking.id}/require-deposit`, {
        ...(mode === "percent" ? { percent: number } : { amount: number }),
        notifyGuest,
      });
      return await response.json() as Booking;
    },
    onSuccess: (updated) => {
      onUpdated(updated);
      toast({
        title: "Commitment set",
        description: `${formatAmount(updated.paymentDepositAmount ?? 0)} locks the dates${notifyGuest ? ", and the guest has been told" : ""}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Could not set the commitment", description: error.message, variant: "destructive" });
    },
  });

  const inputId = `commitment-${booking.id}`;
  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-white/80 p-3" data-testid={`commitment-${booking.id}`}>
      <div>
        <div className="text-sm font-medium">Commitment (deposit)</div>
        <div className="text-sm text-muted-foreground">
          {current
            ? `The guest locks the dates by paying ${formatAmount(current)} (${Math.round((current / booking.totalPrice) * 100)}% of ${formatAmount(booking.totalPrice)}).`
            : `Usually ${bookingDepositPercent}% of the total. Set what you agreed with the guest.`}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={inputId}>{mode === "percent" ? "Percentage of the total" : "Amount in US$"}</Label>
          <Input
            id={inputId}
            inputMode="numeric"
            className="w-full"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${inputId}-mode`}>As</Label>
          <Select value={mode} onValueChange={(next) => setMode(next as "percent" | "amount")}>
            <SelectTrigger id={`${inputId}-mode`} className="w-full" aria-label="Commitment as">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">% of the total</SelectItem>
              <SelectItem value="amount">US$ amount</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        variant="secondary"
        className="w-full"
        disabled={setCommitment.isPending || !preview || "error" in preview}
        onClick={() => setCommitment.mutate()}
      >
        Set commitment
      </Button>
      <div className="text-sm" role="status">
        {preview && "error" in preview ? (
          <span className="text-destructive">{preview.error}</span>
        ) : preview ? (
          <span className="text-muted-foreground">
            The guest pays <span className="font-medium text-foreground">{formatAmount(preview.amount)}</span> of {formatAmount(booking.totalPrice)} to lock the dates.
          </span>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={notifyGuest} onCheckedChange={(checked) => setNotifyGuest(checked === true)} />
        Tell the guest in the booking's messages
      </label>
    </div>
  );
}

type LockChoice = "24h" | "3d" | "7d" | "checkin" | "booking" | "date";

const LOCK_CHOICES: Array<{ value: LockChoice; label: string }> = [
  { value: "24h", label: "24 hours" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
  { value: "checkin", label: "Until the start date" },
  { value: "booking", label: "For the whole booking" },
  { value: "date", label: "Until a date…" },
];

/** The last moment a lock can run to: the end of the booking's last day, in Kenya. */
function endOfBooking(booking: Booking) {
  return kenyaDateTimeToIso(booking.checkOut, "23:59");
}

function lockUntil(booking: Booking, choice: LockChoice, date: string): string | null {
  const latest = Date.parse(endOfBooking(booking));
  let until: number;
  switch (choice) {
    case "24h": until = Date.now() + 24 * 3_600_000; break;
    case "3d": until = Date.now() + 3 * 24 * 3_600_000; break;
    case "7d": until = Date.now() + 7 * 24 * 3_600_000; break;
    case "checkin": until = Date.parse(kenyaDateTimeToIso(booking.checkIn, "23:59")); break;
    case "booking": until = latest; break;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      until = Date.parse(kenyaDateTimeToIso(date, "23:59"));
      break;
  }
  if (!Number.isFinite(until) || until <= Date.now() + 60_000) return null;
  return new Date(Math.min(until, latest)).toISOString();
}

/**
 * Locking a booking's dates by hand. Shown for bookings that reserve dates
 * (stays, cars, chefs) and that no payment has locked yet.
 */
export function BookingDateLockControl({ booking, formatAmount, onUpdated }: ControlProps) {
  const { toast } = useToast();
  const locked = hasActiveAdminLock(booking);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<LockChoice>("3d");
  const [date, setDate] = useState("");
  const [note, setNote] = useState(booking.adminLockNote ?? "");
  const [notifyGuest, setNotifyGuest] = useState(true);
  const until = lockUntil(booking, choice, date);
  const due = getBookingCheckoutAmount(booking);

  const lock = useMutation({
    mutationFn: async (payload: { until: string | null; note?: string; notifyGuest: boolean }) => {
      const response = await apiRequest("PATCH", `/api/admin/bookings/${booking.id}/lock`, payload);
      return await response.json() as Booking;
    },
    onSuccess: (updated, payload) => {
      onUpdated(updated);
      setEditing(false);
      toast(payload.until
        ? {
            title: "Dates locked",
            description: `Held for ${updated.guestName} until ${kenyaTime(updated.adminLockUntil ?? payload.until)}.`,
          }
        : { title: "Dates unlocked", description: "They're free for other guests again until a payment comes in." });
    },
    onError: (error: Error) => {
      toast({ title: "Could not change the lock", description: error.message, variant: "destructive" });
    },
  });

  const id = `lock-${booking.id}`;
  return (
    <div className="space-y-3 rounded-md border border-sky-200 bg-white/80 p-3" data-testid={`date-lock-${booking.id}`}>
      <div className="flex items-start gap-2">
        {locked ? <Lock className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" aria-hidden /> : <LockOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
        <div className="min-w-0">
          <div className="text-sm font-medium">{locked ? "Dates locked by the team" : "Lock the dates by hand"}</div>
          <div className="text-sm text-muted-foreground">
            {locked
              ? `Held for ${booking.guestName} until ${kenyaTime(booking.adminLockUntil!)}. Other guests can't book these dates, on the site or with Zaina.`
              : `Nothing is paid yet, so these dates are still open to other guests. Lock them if ${booking.guestName} is paying another way, as agreed.`}
          </div>
          {locked && booking.adminLockNote ? (
            <div className="mt-2 rounded-md bg-sky-50 p-2 text-sm text-foreground">{booking.adminLockNote}</div>
          ) : null}
          {locked && due > 0 ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Still to pay to lock them for good: {formatAmount(due)}. The lock ends on its own at that time.
            </div>
          ) : null}
        </div>
      </div>

      {!locked || editing ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-until`}>Lock for</Label>
              <Select value={choice} onValueChange={(next) => setChoice(next as LockChoice)}>
                <SelectTrigger id={`${id}-until`} className="w-full" aria-label="Lock for">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCK_CHOICES
                    .filter((option) => option.value !== "checkin" || booking.checkIn >= todayInKenya())
                    .map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {choice === "date" ? (
              <div className="space-y-1">
                <Label htmlFor={`${id}-date`}>Date</Label>
                <Input
                  id={`${id}-date`}
                  type="date"
                  className="w-full"
                  min={todayInKenya()}
                  max={booking.checkOut}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-note`}>Note for the team</Label>
            <Textarea
              id={`${id}-note`}
              rows={2}
              maxLength={500}
              placeholder="What was agreed, for example: paying by bank transfer on Friday."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={notifyGuest} onCheckedChange={(checked) => setNotifyGuest(checked === true)} />
            Tell the guest in the booking's messages
          </label>
          <div className="text-sm text-muted-foreground" role="status">
            {until ? `Locks until ${kenyaTime(until)}.` : choice === "date" ? "Choose a date before the end of the booking." : "That time has passed."}
          </div>
          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              disabled={!until || lock.isPending}
              onClick={() => until && lock.mutate({ until, note, notifyGuest })}
            >
              <Lock className="mr-2 h-4 w-4" aria-hidden />
              {locked ? "Save the new lock" : "Lock dates"}
            </Button>
            {editing ? (
              <Button variant="ghost" className="w-full" onClick={() => setEditing(false)}>Cancel</Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={notifyGuest} onCheckedChange={(checked) => setNotifyGuest(checked === true)} />
            Tell the guest in the booking's messages
          </label>
          <div className="flex flex-col gap-2">
            <Button variant="outline" className="w-full" onClick={() => setEditing(true)}>
              Change the lock
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={lock.isPending}
              onClick={() => lock.mutate({ until: null, notifyGuest })}
            >
              <LockOpen className="mr-2 h-4 w-4" aria-hidden />
              Unlock dates
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
