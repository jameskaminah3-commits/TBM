import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, Check, Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { ProviderLayout } from "@/components/provider-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AdminMediaField } from "@/components/admin-media-field";
import { HotelRoomsEditor } from "@/components/hotel-rooms-editor";
import { ListingShareSheet } from "@/components/listing-share-sheet";
import { Field } from "@/components/provider-hub/field";
import { HubPageHeader } from "@/components/provider-hub/hub-ui";
import { getListingSharePrice } from "@shared/listing-share";
import { addCalendarDays, formatCalendarDate, formatCalendarDateRange } from "@shared/calendar-dates";
import { StayRulesLocationCard } from "@/components/stay-rules-location-card";
import { hotelFacilityOptions } from "@/components/admin-stay-kind-fields";
import type { Stay, StayRoomType } from "@shared/schema";

const dayLabel = (value: string | null | undefined) => (value ? formatCalendarDate(value, { day: "numeric", month: "short", year: "numeric" }, "en-GB") : "");
const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "");
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** The facilities a hotel can tick: the same list the team uses, so searches find them alike. */
export const hotelFeatureOptions = hotelFacilityOptions;

type HotelAvailability = {
  blockedRanges: Array<{
    id: string;
    source: "booking" | "manual" | "calendar";
    startDate: string;
    endDate: string;
    checkoutDate: string;
    status: string;
    guestName: string;
    roomTypeName?: string | null;
    rooms?: number | null;
  }>;
  availableFrom: string;
};

type CalendarSync = {
  feeds: Array<{
    id: string;
    name: string;
    site: string;
    roomTypeId: string | null;
    roomTypeName: string | null;
    roomsPerEvent: number | null;
    lastSyncedAt: string | null;
    lastError: string | null;
    stretchesBlocked: number;
  }>;
  exports: Array<{ roomTypeId: string; roomTypeName: string; roomCount: number; url: string }>;
};

const bookingSites = ["Booking.com", "Airbnb", "Expedia", "Vrbo", "Agoda", "Tripadvisor"];
const OTHER_SITE = "other";

function whenRead(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

/** A hotel owner's page: the hotel's details, rooms and rates, closed dates and calendars. */
export function ProviderHotelManage({ stay }: { stay: Stay }) {
  const id = stay.id;
  const { toast } = useToast();
  const { usdToKes } = useCurrency();

  // ── Details
  const [title, setTitle] = useState(stay.title);
  const [locationValue, setLocationValue] = useState(stay.location);
  const [description, setDescription] = useState(stay.description);
  const [starRating, setStarRating] = useState(stay.starRating ? String(stay.starRating) : "");
  const [features, setFeatures] = useState<string[]>(stay.features ?? []);
  const [imageUrl, setImageUrl] = useState(stay.imageUrl ?? "");
  const [galleryUrls, setGalleryUrls] = useState<string[]>(stay.galleryUrls ?? []);
  const [mediaType, setMediaType] = useState<"image" | "video">((stay.mediaType as "image" | "video") ?? "image");

  useEffect(() => {
    setTitle(stay.title);
    setLocationValue(stay.location);
    setDescription(stay.description);
    setStarRating(stay.starRating ? String(stay.starRating) : "");
    setFeatures(stay.features ?? []);
    setImageUrl(stay.imageUrl ?? "");
    setGalleryUrls(stay.galleryUrls ?? []);
    setMediaType((stay.mediaType as "image" | "video") ?? "image");
  }, [stay]);

  const featureChoices = [...hotelFeatureOptions, ...features.filter((feature) => !hotelFeatureOptions.includes(feature))];

  const updateHotelMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/provider/stays/${id}`, {
      title,
      location: locationValue,
      description,
      starRating: starRating ? Number(starRating) : null,
      features,
      imageUrl,
      galleryUrls,
      mediaType,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/stays", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stays"] });
      toast({ title: "Hotel updated", description: "Your changes are live. TBM reviews your edits afterwards." });
    },
    onError: (error: Error) => toast({ title: "Could not update the hotel", description: errorText(error), variant: "destructive" }),
  });

  // ── Rooms (for the block and calendar forms)
  const { data: roomTypes = [] } = useQuery<StayRoomType[]>({
    queryKey: ["/api/provider/stays", id, "room-types"],
    queryFn: async () => {
      const response = await fetch(`/api/provider/stays/${id}/room-types`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch room types");
      return response.json();
    },
  });

  // ── Closed dates
  const availabilityKey = ["/api/provider/stays", id, "availability"];
  const { data: availability } = useQuery<HotelAvailability>({
    queryKey: availabilityKey,
    queryFn: async () => {
      const response = await fetch(`/api/provider/stays/${id}/availability`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load availability");
      return response.json();
    },
  });
  const refreshAvailability = () => {
    queryClient.invalidateQueries({ queryKey: availabilityKey });
    queryClient.invalidateQueries({ queryKey: ["/api/stays", id, "availability"] });
  };

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [blockRoomTypeId, setBlockRoomTypeId] = useState("");
  const [blockRooms, setBlockRooms] = useState("");
  const blockRoomType = roomTypes.find((roomType) => roomType.id === blockRoomTypeId);

  const createBlockMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/provider/stays/${id}/availability/blocks`, {
      startDate,
      endDate,
      roomTypeId: blockRoomTypeId || null,
      roomCount: blockRoomTypeId && /^\d+$/.test(blockRooms.trim()) && Number(blockRooms) > 0 ? Number(blockRooms) : null,
    }),
    onSuccess: () => {
      refreshAvailability();
      setStartDate("");
      setEndDate("");
      setBlockRooms("");
      toast({ title: "Rooms closed", description: "Guests can't book them on those nights." });
    },
    onError: (error: Error) => toast({ title: "Could not close those dates", description: errorText(error), variant: "destructive" }),
  });

  const deleteBlockMutation = useMutation({
    mutationFn: async (blockId: string) => apiRequest("DELETE", `/api/provider/stays/${id}/availability/blocks/${blockId}`),
    onSuccess: () => {
      refreshAvailability();
      toast({ title: "Rooms reopened", description: "Guests can book them again." });
    },
    onError: (error: Error) => toast({ title: "Could not reopen", description: errorText(error), variant: "destructive" }),
  });

  // ── Calendars shared with other booking sites
  const syncKey = ["/api/provider/stays", id, "calendar-sync"];
  const { data: calendarSync } = useQuery<CalendarSync>({
    queryKey: syncKey,
    queryFn: async () => {
      const response = await fetch(`/api/provider/stays/${id}/calendar-sync`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load calendar links");
      return response.json();
    },
  });
  const refreshSync = () => {
    queryClient.invalidateQueries({ queryKey: syncKey });
    refreshAvailability();
  };

  const [feedSite, setFeedSite] = useState(bookingSites[0]);
  const [feedSiteName, setFeedSiteName] = useState("");
  const [feedRoomTypeId, setFeedRoomTypeId] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedTakesAll, setFeedTakesAll] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const feedRoomType = roomTypes.find((roomType) => roomType.id === feedRoomTypeId) ?? (roomTypes.length === 1 ? roomTypes[0] : undefined);
  const feedName = feedSite === OTHER_SITE ? feedSiteName.trim() : feedSite;

  const addFeedMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/provider/stays/${id}/calendar-sync/feeds`, {
        name: feedName,
        url: feedUrl.trim(),
        roomTypeId: feedRoomType?.id ?? null,
        roomsPerEvent: feedTakesAll ? null : 1,
      });
      return response.json() as Promise<CalendarSync["feeds"][number]>;
    },
    onSuccess: (feed) => {
      refreshSync();
      setFeedUrl("");
      toast(feed.lastError
        ? { title: "Link saved, but it couldn't be read", description: feed.lastError, variant: "destructive" }
        : { title: `${feed.name} calendar linked`, description: "The nights taken there are now closed here, and we'll keep checking." });
    },
    onError: (error: Error) => toast({ title: "Could not link that calendar", description: errorText(error), variant: "destructive" }),
  });

  const syncFeedMutation = useMutation({
    mutationFn: async (feedId: string) => {
      const response = await apiRequest("POST", `/api/provider/stays/${id}/calendar-sync/feeds/${feedId}/sync`);
      return response.json() as Promise<CalendarSync["feeds"][number]>;
    },
    onSuccess: (feed) => {
      refreshSync();
      toast(feed.lastError
        ? { title: "Couldn't read that calendar", description: feed.lastError, variant: "destructive" }
        : { title: "Calendar read", description: `${feed.name} is up to date.` });
    },
    onError: (error: Error) => toast({ title: "Could not read that calendar", description: errorText(error), variant: "destructive" }),
  });

  const removeFeedMutation = useMutation({
    mutationFn: async (feedId: string) => apiRequest("DELETE", `/api/provider/stays/${id}/calendar-sync/feeds/${feedId}`),
    onSuccess: () => {
      refreshSync();
      toast({ title: "Calendar link removed", description: "The nights it had closed are open again." });
    },
    onError: (error: Error) => toast({ title: "Could not remove the link", description: errorText(error), variant: "destructive" }),
  });

  const copyLink = async (roomTypeId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(roomTypeId);
      window.setTimeout(() => setCopied((current) => (current === roomTypeId ? null : current)), 2500);
    } catch {
      toast({ title: "Select the link and copy it", description: "Your browser didn't let us copy it for you." });
    }
  };

  const fromPrice = stay.price > 0 ? `KSh ${Math.round(stay.price * usdToKes).toLocaleString("en-KE")}` : "Add a room";
  const sections = [
    { href: "#details", label: "Details" },
    { href: "#rooms", label: "Rooms & rates" },
    { href: "#media", label: "Photos" },
    { href: "#rules", label: "Location & rules" },
    { href: "#availability", label: "Closed dates" },
    { href: "#sync", label: "Calendar sync" },
  ];

  return (
    <ProviderLayout title={stay.title}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8" data-testid="provider-hotel-manage">
        <HubPageHeader
          eyebrow="Hotel"
          title={stay.title}
          description={availability?.availableFrom ? `Next night with a room free: ${dayLabel(availability.availableFrom)}` : "Loading dates…"}
          actions={(
            <ListingShareSheet kind="stay" id={stay.id} name={stay.title} description={stay.description} {...getListingSharePrice("stay", stay)} isPublic={stay.isPublic} source="provider" size="default" triggerLabel="Share listing" />
          )}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Rooms from (a night)</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{fromPrice}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Rooms on sale</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {roomTypes.filter((roomType) => roomType.isActive).reduce((sum, roomType) => sum + roomType.roomCount, 0)}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">On the site</div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {stay.isPublic ? (roomTypes.some((roomType) => roomType.isActive) ? "Guests can book" : "Add a room to appear") : "Waiting for TBM to publish"}
            </div>
          </div>
        </div>

        <nav aria-label="Sections of this page" className="flex flex-wrap gap-2">
          {sections.map((section) => (
            <a key={section.href} href={section.href} className="rounded-full border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
              {section.label}
            </a>
          ))}
        </nav>

        <Card id="details" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Hotel details</CardTitle>
            <CardDescription>Changes go live when you save. TBM reviews your edits afterwards. Check-in times, children's ages and your rules are under Location &amp; rules.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="hotel-title" label="Name guests see">
                <Input id="hotel-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="For example, Coral Cove Beach Hotel" />
              </Field>
              <Field id="hotel-location" label="Area">
                <Input id="hotel-location" value={locationValue} onChange={(event) => setLocationValue(event.target.value)} placeholder="For example, Diani Beach" />
              </Field>
              <Field id="hotel-stars" label="Star rating" hint="The hotel's official class, if it has one.">
                <select id="hotel-stars" className={selectClass} value={starRating} onChange={(event) => setStarRating(event.target.value)}>
                  <option value="">Not rated</option>
                  {[1, 2, 3, 4, 5].map((stars) => <option key={stars} value={stars}>{stars} star{stars === 1 ? "" : "s"}</option>)}
                </select>
              </Field>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium">What the hotel offers</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {featureChoices.map((feature) => (
                  <label key={feature} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={features.includes(feature)}
                      onCheckedChange={(checked) => setFeatures((current) => (checked === true ? [...current, feature] : current.filter((entry) => entry !== feature)))}
                    />
                    {feature}
                  </label>
                ))}
              </div>
            </div>

            <div id="media" className="scroll-mt-24 space-y-3 rounded-xl border border-border/70 bg-muted/20 p-5">
              <div>
                <div className="text-base font-medium text-foreground">Hotel photos</div>
                <p className="text-sm text-muted-foreground">
                  The building, pool, restaurant and grounds. Each room has its own photos, under Rooms &amp; rates.
                </p>
              </div>
              <AdminMediaField
                value={imageUrl}
                galleryUrls={galleryUrls}
                mediaType={mediaType}
                onChange={({ mediaUrl, mediaType: nextMediaType, galleryUrls: nextGalleryUrls }) => {
                  setImageUrl(mediaUrl);
                  setGalleryUrls(nextGalleryUrls);
                  setMediaType(nextMediaType);
                }}
                onMediaTypeChange={(value: "image" | "video") => setMediaType(value)}
              />
            </div>

            <Field id="hotel-description" label="Description" hint="What makes the hotel special, who it suits, and what's nearby.">
              <Textarea id="hotel-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={5} />
            </Field>
            <Button onClick={() => updateHotelMutation.mutate()} disabled={updateHotelMutation.isPending} data-testid="button-save-hotel">
              {updateHotelMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </CardContent>
        </Card>

        <HotelRoomsEditor stayId={id} scope="provider" />

        <StayRulesLocationCard stay={stay} scope="provider" />

        <Card id="availability" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Close rooms on some dates</CardTitle>
            <CardDescription>
              Rooms under repair, kept for a group, or sold directly at the desk. Close some rooms of one type, or the whole hotel. Rooms guests already booked stay booked.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field id="block-start" label="First night closed">
                <Input id="block-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </Field>
              <Field id="block-end" label="Open again from">
                <Input id="block-end" type="date" min={startDate ? addCalendarDays(startDate, 1) : undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </Field>
              <Field id="block-room" label="Which rooms">
                <select id="block-room" className={selectClass} value={blockRoomTypeId} onChange={(event) => { setBlockRoomTypeId(event.target.value); setBlockRooms(""); }}>
                  <option value="">The whole hotel</option>
                  {roomTypes.map((roomType) => <option key={roomType.id} value={roomType.id}>{roomType.name}</option>)}
                </select>
              </Field>
              <Field id="block-count" label="How many rooms">
                <Input
                  id="block-count"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={blockRoomType?.roomCount}
                  disabled={!blockRoomType}
                  placeholder={blockRoomType ? `All ${blockRoomType.roomCount}` : "All"}
                  value={blockRooms}
                  onChange={(event) => setBlockRooms(event.target.value)}
                />
              </Field>
            </div>
            <Button onClick={() => createBlockMutation.mutate()} disabled={createBlockMutation.isPending || !startDate || !endDate} data-testid="button-close-rooms">
              {createBlockMutation.isPending ? "Closing..." : "Close these nights"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Booked and closed nights</CardTitle>
            <CardDescription>Bookings made on TBM, rooms you closed, and nights taken on other sites. Only TBM can change a guest's booking.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {availability?.blockedRanges?.length ? availability.blockedRanges.map((range) => (
              <div key={range.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`night-range-${range.source}`}>
                <div className="min-w-0">
                  <div className="font-medium">Nights of {formatCalendarDateRange(range.startDate, range.endDate, "en-GB")}</div>
                  <div className="text-sm text-muted-foreground">
                    {range.source === "manual"
                      ? `Closed by you · open again ${dayLabel(range.checkoutDate)}`
                      : range.source === "calendar"
                        ? `${range.guestName} · free again ${dayLabel(range.checkoutDate)}`
                        : `${range.guestName} · checks out ${dayLabel(range.checkoutDate)}`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {range.roomTypeName ? `${range.rooms ? `${range.rooms} × ` : "All "}${range.roomTypeName}` : "The whole hotel"}
                  </div>
                </div>
                {range.source === "manual" ? (
                  <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={() => deleteBlockMutation.mutate(range.id)} disabled={deleteBlockMutation.isPending}>
                    Reopen
                  </Button>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {range.source === "calendar" ? "Other site" : range.status === "confirmed" ? "Booked" : range.status === "pending" ? "Being booked" : range.status.charAt(0).toUpperCase() + range.status.slice(1)}
                  </div>
                )}
              </div>
            )) : <p className="text-sm text-muted-foreground">Nothing booked or closed yet.</p>}
          </CardContent>
        </Card>

        <Card id="sync" className="scroll-mt-24" data-testid="calendar-sync">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-teal-700" />Calendar sync with other booking sites</CardTitle>
            <CardDescription>
              If you also sell these rooms on Booking.com, Airbnb or another site, link the calendars so a night taken on one is closed on the other.
              It works both ways, with the calendar (iCal) links every booking site gives.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {roomTypes.length === 0 ? (
              <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Add a room under Rooms &amp; rates first: calendars are linked room by room.</p>
            ) : (
              <>
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">1. Bring in the nights taken on other sites</h3>
                    <p className="text-sm text-muted-foreground">
                      On the other site, open the room's calendar, find "Sync calendars" or "Export calendar", copy the link it gives, and paste it here.
                    </p>
                  </div>
                  <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
                    <Field id="feed-site" label="Site">
                      <select id="feed-site" className={selectClass} value={feedSite} onChange={(event) => setFeedSite(event.target.value)}>
                        {bookingSites.map((site) => <option key={site} value={site}>{site}</option>)}
                        <option value={OTHER_SITE}>Another site…</option>
                      </select>
                    </Field>
                    {feedSite === OTHER_SITE ? (
                      <Field id="feed-site-name" label="Its name">
                        <Input id="feed-site-name" value={feedSiteName} onChange={(event) => setFeedSiteName(event.target.value)} placeholder="For example, our own website" />
                      </Field>
                    ) : null}
                    <Field id="feed-room" label="Room on TBM">
                      <select id="feed-room" className={selectClass} value={feedRoomType?.id ?? ""} onChange={(event) => setFeedRoomTypeId(event.target.value)}>
                        {roomTypes.length > 1 ? <option value="">Choose a room</option> : null}
                        {roomTypes.map((roomType) => <option key={roomType.id} value={roomType.id}>{roomType.name}</option>)}
                      </select>
                    </Field>
                    <Field id="feed-url" label="Calendar link from that site" className="sm:col-span-2">
                      <Input id="feed-url" type="url" inputMode="url" value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="https://…/calendar.ics" />
                    </Field>
                    {feedRoomType && feedRoomType.roomCount > 1 ? (
                      <label className="flex items-start gap-2 text-sm sm:col-span-2">
                        <Checkbox checked={feedTakesAll} onCheckedChange={(checked) => setFeedTakesAll(checked === true)} className="mt-0.5" />
                        <span>
                          A booking on that calendar takes all {feedRoomType.roomCount} {feedRoomType.name} rooms
                          <span className="block text-xs text-muted-foreground">
                            Leave unticked if that listing is one room: each booking there then closes one of your {feedRoomType.roomCount} rooms here. Add a link for each room you list there.
                          </span>
                        </span>
                      </label>
                    ) : null}
                    <div className="sm:col-span-2">
                      <Button
                        onClick={() => addFeedMutation.mutate()}
                        disabled={addFeedMutation.isPending || !feedRoomType || feedName.length < 2 || feedUrl.trim().length < 10}
                        data-testid="button-add-calendar"
                      >
                        <Link2 className="mr-2 h-4 w-4" />
                        {addFeedMutation.isPending ? "Reading the calendar…" : "Link this calendar"}
                      </Button>
                    </div>
                  </div>

                  {calendarSync?.feeds.length ? (
                    <div className="space-y-2">
                      {calendarSync.feeds.map((feed) => (
                        <div key={feed.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`calendar-feed-${feed.id}`}>
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{feed.name}</span>
                              <span className="text-sm text-muted-foreground">→ {feed.roomTypeName ?? "A removed room"}</span>
                              <Badge variant={feed.lastError ? "destructive" : "secondary"}>{feed.lastError ? "Not reading" : "Linked"}</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {feed.site}
                              {feed.roomsPerEvent ? ` · each booking closes ${feed.roomsPerEvent} room${feed.roomsPerEvent === 1 ? "" : "s"}` : " · each booking closes every room of this type"}
                            </div>
                            {feed.lastError ? (
                              <p className="text-sm text-destructive">{feed.lastError}</p>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                {feed.stretchesBlocked === 0 ? "No upcoming nights taken there" : `${feed.stretchesBlocked} upcoming stay${feed.stretchesBlocked === 1 ? "" : "s"} closed here`}
                                {feed.lastSyncedAt ? ` · read ${whenRead(feed.lastSyncedAt)}` : ""}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button type="button" size="sm" variant="outline" disabled={syncFeedMutation.isPending} onClick={() => syncFeedMutation.mutate(feed.id)}>
                              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Read now
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="text-destructive" disabled={removeFeedMutation.isPending} onClick={() => removeFeedMutation.mutate(feed.id)} aria-label={`Remove the ${feed.name} calendar link`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">2. Give the other sites the nights taken on TBM</h3>
                    <p className="text-sm text-muted-foreground">
                      Copy a room's link and paste it on the other site under "Sync calendars" or "Import calendar". It lists only the nights when every room of that type is taken here, never who booked.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {(calendarSync?.exports ?? []).map((entry) => (
                      <div key={entry.roomTypeId} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center" data-testid={`calendar-export-${entry.roomTypeId}`}>
                        <div className="shrink-0 text-sm font-medium sm:w-44">{entry.roomTypeName}</div>
                        <Input readOnly value={entry.url} aria-label={`TBM calendar link for ${entry.roomTypeName}`} className="min-w-0 flex-1 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
                        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => copyLink(entry.roomTypeId, entry.url)}>
                          {copied === entry.roomTypeId ? <><Check className="mr-1.5 h-3.5 w-3.5" />Copied</> : <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy link</>}
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>

                <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
                  We read each linked calendar about every 30 minutes, and other sites read ours on their own timetable, often every few hours.
                  So for a short while after a booking, the same room can still be booked on another site. Use "Read now" after a booking elsewhere, and keep an eye on both for rooms that sell fast.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </ProviderLayout>
  );
}
