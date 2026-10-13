// "Who's coming" in My Bookings: on a confirmed home-help booking, the carer's
// first name, whether TBM checked their ID, and their approved face photo.
// Only the guest who made the booking gets this from the server; it's never
// on a public page.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, UserRound } from "lucide-react";
import { carerDisclosureNote, type BookingCarer } from "@shared/booking-carer";

function CarerPhoto({ carer }: { carer: BookingCarer }) {
  const [failed, setFailed] = useState(false);
  if (carer.photoPath && !failed) {
    return (
      <img
        src={carer.photoPath}
        alt={`${carer.firstName}, your carer`}
        className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-emerald-200"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        data-testid="img-carer-photo"
      />
    );
  }
  return (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-serif text-2xl font-medium text-emerald-900" aria-hidden="true">
      {Array.from(carer.firstName)[0]?.toUpperCase() ?? <UserRound className="h-6 w-6" />}
    </span>
  );
}

export function BookingCarers({ bookingId, enabled }: { bookingId: string; enabled: boolean }) {
  const { data } = useQuery<{ carers: BookingCarer[] }>({
    queryKey: [`/api/bookings/${bookingId}/carers`],
    enabled,
    staleTime: 60_000,
  });
  const carers = data?.carers ?? [];
  if (!enabled || !carers.length) return null;

  return (
    <section
      aria-labelledby={`carers-${bookingId}`}
      className="rounded-[24px] border border-emerald-200/80 bg-[linear-gradient(180deg,rgba(236,253,245,0.95),rgba(240,253,250,0.85))] p-5"
      data-testid="booking-carers"
    >
      <h3 id={`carers-${bookingId}`} className="text-sm font-semibold text-emerald-950">Who's coming</h3>
      <ul className="mt-3 space-y-3">
        {carers.map((carer, index) => (
          <li key={`${carer.firstName}-${index}`} className="flex items-center gap-4">
            <CarerPhoto carer={carer} />
            <div className="min-w-0 space-y-1">
              <div className="text-base font-medium text-stone-900" data-testid="text-carer-name">{carer.firstName}</div>
              {carer.services.length ? <div className="text-sm text-stone-600">{carer.services.join(", ")}</div> : null}
              {carer.idChecked ? (
                <div className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />ID checked by TBM</div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-emerald-900/80">{carerDisclosureNote(carers.every((carer) => carer.idChecked))}</p>
    </section>
  );
}
