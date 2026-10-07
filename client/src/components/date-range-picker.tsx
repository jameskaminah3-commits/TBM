import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayModifiers } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  addCalendarDays,
  daysBetweenCalendarDates,
  formatCalendarDate,
  parseCalendarDate,
  toCalendarDate,
  todayInKenya,
} from "@shared/calendar-dates";

/** Booked nights (or days) from an availability endpoint: startDate to endDate, both taken. */
export type BookedRange = { startDate: string; endDate: string };

export type DateRangeValue = { checkIn: string; checkOut: string };

type DateRangePickerProps = {
  checkIn: string;
  checkOut: string;
  onChange: (next: DateRangeValue) => void;
  bookedRanges?: BookedRange[];
  /** Stays count nights (check-out after check-in); services count days and allow one day. */
  unit?: "night" | "day";
  /** The first day that can be picked, "YYYY-MM-DD"; Kenya's today by default. */
  minDate?: string;
  placeholder?: string;
  label?: string;
  className?: string;
  id?: string;
  "data-testid"?: string;
  /** Lets another control open the calendar, such as a pinned bar's "Check dates". */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** "Fri 6 Nov": how guests read a date. */
export function formatTripDate(value: string) {
  return formatCalendarDate(value, { weekday: "short", day: "numeric", month: "short" }, "en-GB");
}

/** Nights for a stay, or days for a service (one day when it starts and ends the same day). */
export function countTripUnits(checkIn: string, checkOut: string, unit: "night" | "day") {
  if (!checkIn || !checkOut) return 0;
  const between = daysBetweenCalendarDates(checkIn, checkOut);
  return unit === "day" ? Math.max(1, between) : Math.max(0, between);
}

export function describeTripRange(checkIn: string, checkOut: string, unit: "night" | "day" = "night") {
  if (!checkIn) return "";
  const count = countTripUnits(checkIn, checkOut, unit);
  const dates = checkOut && checkOut !== checkIn
    ? `${formatTripDate(checkIn)} – ${formatTripDate(checkOut)}`
    : formatTripDate(checkIn);
  return count > 0 ? `${dates} · ${count} ${unit}${count === 1 ? "" : "s"}` : dates;
}

function bookedDaySet(ranges: BookedRange[] | undefined) {
  const days = new Set<string>();
  for (const range of ranges ?? []) {
    if (!range.startDate || !range.endDate || range.endDate < range.startDate) continue;
    // A year of booked days is plenty for a picker; this also guards bad data.
    for (let day = range.startDate, guard = 0; day <= range.endDate && guard < 400; day = addCalendarDays(day, 1), guard += 1) {
      days.add(day);
    }
  }
  return days;
}

export function DateRangePicker({
  checkIn,
  checkOut,
  onChange,
  bookedRanges,
  unit = "night",
  minDate,
  placeholder = "Add dates",
  label = unit === "night" ? "Check-in and check-out dates" : "Start and end dates",
  className,
  id,
  "data-testid": testId,
  open: controlledOpen,
  onOpenChange,
}: DateRangePickerProps) {
  const isMobile = useIsMobile();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  // While picking: the start chosen, waiting for an end.
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const firstDay = minDate ?? todayInKenya();
  const booked = useMemo(() => bookedDaySet(bookedRanges), [bookedRanges]);
  const sortedBooked = useMemo(() => Array.from(booked).sort(), [booked]);

  const start = pendingStart ?? checkIn;
  const end = pendingStart ? "" : checkOut;
  const [month, setMonth] = useState<Date>(() => parseCalendarDate(checkIn || firstDay) ?? new Date());

  // Each time it opens, however it was opened: start fresh on the chosen month.
  useEffect(() => {
    if (!open) return;
    setPendingStart(null);
    setMonth(parseCalendarDate(checkIn || firstDay) ?? new Date());
  }, [open]);

  // The latest end for a range starting on `from`: the first booked day after
  // it (a stay can end the morning the next booking begins).
  const latestEndFor = (from: string) => sortedBooked.find((day) => day > from) ?? null;

  const isDisabled = (date: Date) => {
    const day = toCalendarDate(date);
    if (day < firstDay) return true;
    if (pendingStart) {
      if (day < pendingStart) return booked.has(day);
      if (unit === "night" && day === pendingStart) return false; // clicking it again keeps it as check-in
      const limit = latestEndFor(pendingStart);
      return limit !== null && day > limit;
    }
    return booked.has(day);
  };

  const handleDayClick = (date: Date, modifiers: DayModifiers) => {
    if (modifiers.disabled) return;
    const day = toCalendarDate(date);
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }
    if (day < pendingStart || (unit === "night" && day === pendingStart)) {
      setPendingStart(booked.has(day) ? pendingStart : day);
      return;
    }
    setPendingStart(null);
    onChange({ checkIn: pendingStart, checkOut: day });
    setOpen(false);
  };

  const fromDate = parseCalendarDate(start) ?? undefined;
  const toDate = end ? parseCalendarDate(end) ?? undefined : undefined;
  const triggerText = checkIn ? describeTripRange(checkIn, checkOut, unit) : placeholder;
  const prompt = pendingStart
    ? unit === "night" ? "Now pick your check-out date" : "Now pick the last day"
    : unit === "night" ? "Pick your check-in date" : "Pick the first day";

  const calendar = (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground" aria-live="polite">{prompt}</p>
      <DayPicker
        mode="range"
        selected={fromDate ? { from: fromDate, to: toDate } : undefined}
        onDayClick={handleDayClick}
        month={month}
        onMonthChange={setMonth}
        numberOfMonths={2}
        weekStartsOn={1}
        disabled={isDisabled}
        fromDate={parseCalendarDate(firstDay) ?? undefined}
        modifiers={{ booked: (date: Date) => booked.has(toCalendarDate(date)) }}
        modifiersClassNames={{ booked: "line-through decoration-2 text-muted-foreground/60" }}
        showOutsideDays={false}
        classNames={{
          months: cn("flex gap-6", isMobile ? "flex-col items-center" : "flex-row"),
          month: "space-y-3",
          caption: "relative flex items-center justify-center pt-1",
          caption_label: "text-sm font-semibold",
          nav: "flex items-center",
          nav_button: "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 hover:bg-muted",
          nav_button_previous: "absolute left-0",
          nav_button_next: "absolute right-0",
          table: "w-full border-collapse",
          head_row: "flex",
          head_cell: "w-11 text-center text-[0.72rem] font-medium text-muted-foreground sm:w-10",
          row: "mt-1 flex w-full",
          cell: "relative h-11 w-11 p-0 text-center sm:h-10 sm:w-10",
          day: "h-11 w-11 rounded-full text-sm font-normal transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:w-10",
          day_selected: "bg-primary text-primary-foreground hover:bg-primary",
          day_range_start: "bg-primary text-primary-foreground",
          day_range_end: "bg-primary text-primary-foreground",
          day_range_middle: "rounded-none bg-primary/12 text-foreground hover:bg-primary/20",
          day_today: "font-semibold underline underline-offset-4",
          day_disabled: "cursor-not-allowed text-muted-foreground/40 hover:bg-transparent",
          day_outside: "invisible",
        }}
        components={{
          IconLeft: () => <ChevronLeft className="h-4 w-4" />,
          IconRight: () => <ChevronRight className="h-4 w-4" />,
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <p className="text-xs text-muted-foreground">
          {booked.size > 0 ? "Dates with a line through them are booked." : "Dates are in Kenyan time."}
        </p>
        <div className="flex gap-2">
          {checkIn || pendingStart ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPendingStart(null);
                onChange({ checkIn: "", checkOut: "" });
              }}
            >
              Clear
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={() => { setPendingStart(null); setOpen(false); }}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );

  const trigger = (
    <button
      type="button"
      id={id}
      aria-label={checkIn ? `${label}: ${triggerText}` : label}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={() => setOpen(true)}
      data-testid={testId}
    >
      <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className={cn("min-w-0 flex-1 truncate", checkIn ? "text-foreground" : "text-muted-foreground")}>{triggerText}</span>
    </button>
  );

  const close = (next: boolean) => {
    if (!next) setPendingStart(null);
    setOpen(next);
  };

  if (isMobile) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={close}>
          {/* Full screen on phones, like the rest of the site's sheets. */}
          <DialogContent className="left-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 content-start overflow-y-auto rounded-none p-5 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
            <DialogHeader className="text-left">
              <DialogTitle>{unit === "night" ? "Your dates" : "Dates"}</DialogTitle>
              <DialogDescription>{checkIn ? describeTripRange(checkIn, checkOut, unit) : label}</DialogDescription>
            </DialogHeader>
            {calendar}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={close}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] rounded-2xl p-4" align="start">
        {calendar}
      </PopoverContent>
    </Popover>
  );
}

type DatePickerProps = {
  value: string;
  onChange: (next: string) => void;
  bookedRanges?: BookedRange[];
  minDate?: string;
  placeholder?: string;
  label?: string;
  className?: string;
  id?: string;
  "data-testid"?: string;
};

/** One day, picked the same way as a date range: a calendar with booked days struck through. */
export function DatePicker({
  value,
  onChange,
  bookedRanges,
  minDate,
  placeholder = "Add a date",
  label = "Date",
  className,
  id,
  "data-testid": testId,
}: DatePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const firstDay = minDate ?? todayInKenya();
  const booked = useMemo(() => bookedDaySet(bookedRanges), [bookedRanges]);
  const [month, setMonth] = useState<Date>(() => parseCalendarDate(value || firstDay) ?? new Date());
  const selected = value ? parseCalendarDate(value) ?? undefined : undefined;

  const calendar = (
    <div className="space-y-3">
      <DayPicker
        mode="single"
        selected={selected}
        onDayClick={(date, modifiers) => {
          if (modifiers.disabled) return;
          onChange(toCalendarDate(date));
          setOpen(false);
        }}
        month={month}
        onMonthChange={setMonth}
        weekStartsOn={1}
        fromDate={parseCalendarDate(firstDay) ?? undefined}
        disabled={(date: Date) => {
          const day = toCalendarDate(date);
          return day < firstDay || booked.has(day);
        }}
        modifiers={{ booked: (date: Date) => booked.has(toCalendarDate(date)) }}
        modifiersClassNames={{ booked: "line-through decoration-2 text-muted-foreground/60" }}
        showOutsideDays={false}
        classNames={{
          caption: "relative flex items-center justify-center pt-1",
          caption_label: "text-sm font-semibold",
          nav: "flex items-center",
          nav_button: "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 hover:bg-muted",
          nav_button_previous: "absolute left-0",
          nav_button_next: "absolute right-0",
          table: "mt-3 w-full border-collapse",
          head_row: "flex",
          head_cell: "w-11 text-center text-[0.72rem] font-medium text-muted-foreground sm:w-10",
          row: "mt-1 flex w-full",
          cell: "h-11 w-11 p-0 text-center sm:h-10 sm:w-10",
          day: "h-11 w-11 rounded-full text-sm font-normal transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:w-10",
          day_selected: "bg-primary text-primary-foreground hover:bg-primary",
          day_today: "font-semibold underline underline-offset-4",
          day_disabled: "cursor-not-allowed text-muted-foreground/40 hover:bg-transparent",
          day_outside: "invisible",
        }}
        components={{
          IconLeft: () => <ChevronLeft className="h-4 w-4" />,
          IconRight: () => <ChevronRight className="h-4 w-4" />,
        }}
      />
      {booked.size > 0 ? <p className="text-xs text-muted-foreground">Dates with a line through them are booked.</p> : null}
    </div>
  );

  const trigger = (
    <button
      type="button"
      id={id}
      aria-label={value ? `${label}: ${formatTripDate(value)}` : label}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={() => {
        setMonth(parseCalendarDate(value || firstDay) ?? new Date());
        setOpen(true);
      }}
      data-testid={testId}
    >
      <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className={cn("min-w-0 flex-1 truncate", value ? "text-foreground" : "text-muted-foreground")}>
        {value ? formatTripDate(value) : placeholder}
      </span>
    </button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-sm rounded-2xl p-5">
            <DialogHeader className="text-left">
              <DialogTitle>{label}</DialogTitle>
              <DialogDescription>{value ? formatTripDate(value) : "Pick a day"}</DialogDescription>
            </DialogHeader>
            {calendar}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto rounded-2xl p-4" align="start">
        {calendar}
      </PopoverContent>
    </Popover>
  );
}
