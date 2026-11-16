import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/provider-hub/field";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PUBLIC_CONTACT_REMOVED, removeContactDetails } from "@shared/contact-redaction";
import { DEFAULT_CHILD_MAX_AGE, isHotelStay } from "@shared/hotel-rooms";
import { isExactLocationPublic, normalizeGoogleMapsLink } from "@shared/stay-location";
import { STAY_RULES_NOTE_MAX, describeStayRules, type StayRules } from "@shared/stay-rules";
import type { Stay } from "@shared/schema";

const selectClass = "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm";
const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "");
const wholeNumber = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : null);

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border/70 bg-muted/20 p-4 sm:p-5">
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * Where a stay is and the rules its owner sets for guests: children and
 * their ages, the shortest booking, check-in, and the house rules. For a
 * hotel or an entire place, for its owner ("provider") or the team ("admin").
 * It saves on its own, apart from the listing's other details.
 */
export function StayRulesLocationCard({ stay, scope }: { stay: Stay; scope: "admin" | "provider" }) {
  const { toast } = useToast();
  const hotel = isHotelStay(stay);
  const saved = stay.rules ?? {};
  // The team sets a stay's check-in times with its other details.
  const withTimes = scope === "provider";

  const [mapUrl, setMapUrl] = useState(stay.mapUrl ?? "");
  const [exactForAll, setExactForAll] = useState(isExactLocationPublic(stay));
  const [checkInTime, setCheckInTime] = useState(stay.checkInTime ?? "");
  const [checkOutTime, setCheckOutTime] = useState(stay.checkOutTime ?? "");
  const [minNights, setMinNights] = useState(saved.minNights ? String(saved.minNights) : "");
  const [minBookingAge, setMinBookingAge] = useState(saved.minBookingAge ? String(saved.minBookingAge) : "");
  const [idAtCheckIn, setIdAtCheckIn] = useState(saved.idAtCheckIn ? "yes" : "");
  const [children, setChildren] = useState<string>(saved.children ?? "");
  const [minChildAge, setMinChildAge] = useState(saved.minChildAge ? String(saved.minChildAge) : "");
  const [infantsUnderAge, setInfantsUnderAge] = useState(saved.infantsUnderAge ? String(saved.infantsUnderAge) : "");
  const [childMaxAge, setChildMaxAge] = useState(String(stay.hotelPolicy?.childMaxAge ?? DEFAULT_CHILD_MAX_AGE));
  const [freeUnderAge, setFreeUnderAge] = useState(stay.hotelPolicy?.freeUnderAge ? String(stay.hotelPolicy.freeUnderAge) : "");
  const [pets, setPets] = useState<string>(saved.pets ?? "");
  const [smoking, setSmoking] = useState<string>(saved.smoking ?? "");
  const [events, setEvents] = useState<string>(saved.events ?? "");
  const [quietFrom, setQuietFrom] = useState(saved.quietFrom ?? "");
  const [quietTo, setQuietTo] = useState(saved.quietTo ?? "");
  const [note, setNote] = useState(saved.note ?? "");

  const adultsOnly = children === "adults_only";
  const mapLink = mapUrl.trim() ? normalizeGoogleMapsLink(mapUrl) : null;
  const rules: StayRules = {
    minNights: wholeNumber(minNights),
    minBookingAge: wholeNumber(minBookingAge),
    idAtCheckIn: idAtCheckIn === "yes" ? true : null,
    children: children === "welcome" || children === "adults_only" ? children : null,
    minChildAge: adultsOnly ? null : wholeNumber(minChildAge),
    infantsUnderAge: hotel || adultsOnly ? null : wholeNumber(infantsUnderAge),
    pets: pets === "allowed" || pets === "not_allowed" ? pets : null,
    smoking: smoking === "allowed" || smoking === "outside_only" || smoking === "not_allowed" ? smoking : null,
    events: events === "allowed" || events === "not_allowed" ? events : null,
    quietFrom: quietFrom || null,
    quietTo: quietTo || null,
    note: note.trim() || null,
  };
  const hotelPolicy = { childMaxAge: wholeNumber(childMaxAge), freeUnderAge: wholeNumber(freeUnderAge) || null };

  const between = (value: number | null | undefined, low: number, high: number) => value === null || value === undefined || (value >= low && value <= high);
  const problem = mapLink && !mapLink.ok ? mapLink.error
    : !between(rules.minNights, 1, 60) ? "The shortest booking is between 1 and 60 nights."
    : !between(rules.minBookingAge, 16, 30) ? "The youngest age to book is between 16 and 30."
    : !between(rules.minChildAge, 1, 17) ? "The youngest age you take is between 1 and 17."
    : !between(rules.infantsUnderAge, 1, 5) ? "Children who don't count as guests are under an age between 1 and 5."
    : hotel && !adultsOnly && !between(hotelPolicy.childMaxAge, 1, 17) ? "The oldest age charged as a child is between 1 and 17."
    : hotel && !adultsOnly && hotelPolicy.freeUnderAge && hotelPolicy.freeUnderAge > (hotelPolicy.childMaxAge ?? DEFAULT_CHILD_MAX_AGE) ? "The age children stay free under can't be above the oldest child age."
    : Boolean(rules.quietFrom) !== Boolean(rules.quietTo) ? "Give both the start and the end of quiet hours, or neither."
    : null;

  const preview = describeStayRules({
    propertyType: stay.propertyType,
    checkInTime: withTimes ? checkInTime || null : stay.checkInTime,
    checkOutTime: withTimes ? checkOutTime || null : stay.checkOutTime,
    hotelPolicy: hotel ? hotelPolicy : null,
    // As it will be saved: phone numbers and emails are taken out of the note.
    rules: { ...rules, note: rules.note ? removeContactDetails(rules.note, PUBLIC_CONTACT_REMOVED) : null },
  });
  const previewLines = [...preview.arrival, ...preview.children, ...preview.house];

  const saveMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/${scope}/stays/${stay.id}`, {
      mapUrl: mapLink?.ok ? mapLink.url : null,
      showExactLocation: exactForAll,
      rules,
      ...(hotel ? { hotelPolicy } : {}),
      ...(withTimes ? { checkInTime: checkInTime || null, checkOutTime: checkOutTime || null } : {}),
    }),
    onSuccess: () => {
      // Guests' pages pick the change up. The listing's other details on this page stay as typed.
      queryClient.invalidateQueries({ queryKey: ["/api/stays"] });
      toast({
        title: "Rules and location saved",
        description: scope === "provider" ? "Guests see them now. TBM reviews your edits afterwards." : "Guests see them now.",
      });
    },
    onError: (error: Error) => toast({ title: "Could not save", description: errorText(error), variant: "destructive" }),
  });

  return (
    <Card id="rules" className="scroll-mt-24" data-testid="stay-rules-location">
      <CardHeader>
        <CardTitle>Location and rules for guests</CardTitle>
        <CardDescription>
          Where {hotel ? "the hotel" : "the place"} is, and what guests should know before they book: children and their ages, your shortest booking, check-in, and house rules.
          Leave anything that doesn't apply empty and guests won't see it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Group title="Location" hint="A Google Maps link, so guests can see where they'll be and get directions.">
          <Field
            id="stay-map-url"
            label="Google Maps link"
            className="sm:col-span-2"
            hint="In Google Maps, open the place (or press and hold on the map to drop a pin), tap Share, then Copy link, and paste it here."
          >
            <Input id="stay-map-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://maps.app.goo.gl/…" value={mapUrl} onChange={(event) => setMapUrl(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
          </Field>
          {mapLink?.ok ? (
            <a href={mapLink.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline sm:col-span-2" data-testid="link-test-map">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open the link to check it's the right place
            </a>
          ) : null}
          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">Who sees the exact pin</legend>
            {[
              {
                value: false,
                title: "Guests who have booked",
                text: `Everyone else sees the area${stay.location ? ` (${stay.location})` : ""} and gets the exact pin once their booking is paid. Best for a private home.`,
              },
              { value: true, title: "Everyone", text: `Anyone looking at the listing can open the exact pin. Usual for a hotel.` },
            ].map((option) => (
              <label key={String(option.value)} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${exactForAll === option.value ? "border-primary bg-primary/5" : "bg-background"}`}>
                <input
                  type="radio"
                  name={`exact-pin-${stay.id}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  checked={exactForAll === option.value}
                  onChange={() => setExactForAll(option.value)}
                  data-testid={`exact-pin-${option.value ? "everyone" : "booked"}`}
                />
                <span>
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span className="block text-sm text-muted-foreground">{option.text}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </Group>

        <Group title="Arrival and booking">
          {withTimes ? (
            <>
              <Field id="rules-check-in" label="Check-in from">
                <Input id="rules-check-in" type="time" value={checkInTime} onChange={(event) => setCheckInTime(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
              </Field>
              <Field id="rules-check-out" label="Check-out by">
                <Input id="rules-check-out" type="time" value={checkOutTime} onChange={(event) => setCheckOutTime(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
              </Field>
            </>
          ) : null}
          <Field id="rules-min-nights" label="Shortest booking (nights)" hint="Leave empty to take one-night bookings.">
            <Input id="rules-min-nights" type="number" inputMode="numeric" min="1" max="60" placeholder="1" value={minNights} onChange={(event) => setMinNights(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
          </Field>
          <Field id="rules-booking-age" label="Youngest age to book" hint="The guest making the booking, for example 18.">
            <Input id="rules-booking-age" type="number" inputMode="numeric" min="16" max="30" placeholder="Not stated" value={minBookingAge} onChange={(event) => setMinBookingAge(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
          </Field>
          <Field id="rules-id" label="ID at check-in">
            <select id="rules-id" className={selectClass} value={idAtCheckIn} onChange={(event) => setIdAtCheckIn(event.target.value)}>
              <option value="">Not stated</option>
              <option value="yes">Guests show a national ID or passport</option>
            </select>
          </Field>
        </Group>

        <Group title="Children" hint={hotel ? "Whether you take children and the ages your child prices are for. The prices themselves are on each room, under Rooms & rates." : "Whether children can stay, and from what age."}>
          <Field id="rules-children" label="Do you take children?">
            <select id="rules-children" className={selectClass} value={children} onChange={(event) => setChildren(event.target.value)}>
              <option value="">Not stated</option>
              <option value="welcome">Yes, children are welcome</option>
              <option value="adults_only">No, adults only</option>
            </select>
          </Field>
          {adultsOnly ? null : (
            <>
              <Field id="rules-min-child-age" label="Youngest age you take" hint="Leave empty if children of any age can stay.">
                <Input id="rules-min-child-age" type="number" inputMode="numeric" min="1" max="17" placeholder="Any age" value={minChildAge} onChange={(event) => setMinChildAge(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
              </Field>
              {hotel ? (
                <>
                  <Field id="rules-child-max" label="Oldest age charged as a child" hint="Older guests pay as adults.">
                    <Input id="rules-child-max" type="number" inputMode="numeric" min="1" max="17" value={childMaxAge} onChange={(event) => setChildMaxAge(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
                  </Field>
                  <Field id="rules-free-under" label="Children under this age stay free" hint="Leave empty if every child pays.">
                    <Input id="rules-free-under" type="number" inputMode="numeric" min="1" max="17" placeholder="For example, 3" value={freeUnderAge} onChange={(event) => setFreeUnderAge(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
                  </Field>
                </>
              ) : (
                <Field id="rules-infants" label="Children under this age don't count as guests" hint="For example 2, for babies who share a bed or cot. Leave empty if every child counts.">
                  <Input id="rules-infants" type="number" inputMode="numeric" min="1" max="5" placeholder="Every child counts" value={infantsUnderAge} onChange={(event) => setInfantsUnderAge(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
                </Field>
              )}
            </>
          )}
        </Group>

        <Group title="House rules">
          <Field id="rules-pets" label="Pets">
            <select id="rules-pets" className={selectClass} value={pets} onChange={(event) => setPets(event.target.value)}>
              <option value="">Not stated</option>
              <option value="allowed">Pets are welcome</option>
              <option value="not_allowed">No pets</option>
            </select>
          </Field>
          <Field id="rules-smoking" label="Smoking">
            <select id="rules-smoking" className={selectClass} value={smoking} onChange={(event) => setSmoking(event.target.value)}>
              <option value="">Not stated</option>
              <option value="not_allowed">No smoking</option>
              <option value="outside_only">Outside only</option>
              <option value="allowed">Allowed</option>
            </select>
          </Field>
          <Field id="rules-events" label="Parties and events">
            <select id="rules-events" className={selectClass} value={events} onChange={(event) => setEvents(event.target.value)}>
              <option value="">Not stated</option>
              <option value="not_allowed">Not allowed</option>
              <option value="allowed">Allowed</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="rules-quiet-from" label="Quiet from">
              <Input id="rules-quiet-from" type="time" value={quietFrom} onChange={(event) => setQuietFrom(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
            </Field>
            <Field id="rules-quiet-to" label="Until">
              <Input id="rules-quiet-to" type="time" value={quietTo} onChange={(event) => setQuietTo(event.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" />
            </Field>
          </div>
          <Field
            id="rules-note"
            label="Anything else guests should know"
            className="sm:col-span-2"
            hint={`In your own words, up to ${STAY_RULES_NOTE_MAX} characters. Phone numbers and emails are taken out: guests reach you through TBM.`}
          >
            <Textarea id="rules-note" rows={3} maxLength={STAY_RULES_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} placeholder="For example: visitors are welcome until 10pm; the pool closes at 7pm." className="text-base sm:text-sm" />
          </Field>
        </Group>

        <div className="rounded-xl border border-dashed p-4" data-testid="rules-preview">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
            What guests will read
          </div>
          {previewLines.length > 0 || preview.note ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {previewLines.map((line) => <li key={line}>{line}</li>)}
              {preview.note ? <li>{preview.note}</li> : null}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No rules yet. Guests see only what you fill in.</p>
          )}
        </div>

        {problem ? <p className="text-sm text-destructive" role="alert" data-testid="rules-problem">{problem}</p> : null}
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || Boolean(problem)} className="h-11 w-full sm:h-10 sm:w-auto" data-testid="button-save-rules">
          {saveMutation.isPending ? "Saving..." : "Save location and rules"}
        </Button>
      </CardContent>
    </Card>
  );
}
