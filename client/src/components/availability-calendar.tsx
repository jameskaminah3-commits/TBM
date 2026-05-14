import { Calendar as CalendarIcon } from "lucide-react";
import { addMonths, format, eachDayOfInterval, parseISO, startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";

type BlockedRange = {
  id: string;
  source: "booking" | "manual";
  startDate: string;
  endDate: string;
  checkoutDate?: string;
  status: string;
  guestName: string;
  serviceMode?: string;
};

type AvailabilityCalendarProps = {
  blockedRanges: BlockedRange[];
  availableFrom?: string;
  mode: "single" | "range";
  selectedDate?: Date;
  selectedRange?: DateRange;
  onSelectDate?: (date: Date | undefined) => void;
  onSelectRange?: (range: DateRange | undefined) => void;
  onBlockedDayClick?: (date: Date, range?: BlockedRange) => void;
};

export function AvailabilityCalendar({
  blockedRanges,
  availableFrom,
  mode,
  selectedDate,
  selectedRange,
  onSelectDate,
  onSelectRange,
  onBlockedDayClick,
}: AvailabilityCalendarProps) {
  const today = startOfDay(new Date());
  const monthsToRender = Array.from({ length: 18 }, (_, index) => addMonths(today, index));
  const blockedDateMap = new Map<string, BlockedRange>();

  blockedRanges.forEach((range) => {
    eachDayOfInterval({
      start: parseISO(range.startDate),
      end: parseISO(range.endDate),
    }).forEach((date) => {
      blockedDateMap.set(format(date, "yyyy-MM-dd"), range);
    });
  });

  const blockedDates = Array.from(blockedDateMap.keys()).map((value) => parseISO(value));

  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <CalendarIcon className="h-3.5 w-3.5 text-primary" />
            <span>Reserved Days</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Scroll for more dates. Red days are reserved.
          </p>
        </div>
        {availableFrom ? (
          <Badge variant="outline" className="w-fit text-[11px]">
            Available from {availableFrom}
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 max-h-[24rem] overflow-y-auto rounded-xl border border-border/50 bg-muted/15 px-2 py-2">
        <div className="space-y-3">
          {monthsToRender.map((monthDate) =>
            mode === "range" ? (
              <Calendar
                key={monthDate.toISOString()}
                mode="range"
                month={monthDate}
                selected={selectedRange}
                onSelect={onSelectRange}
                disabled={[
                  { before: today },
                  ...blockedDates,
                ]}
                modifiers={{
                  blocked: blockedDates,
                }}
                modifiersClassNames={{
                  blocked: "bg-red-100 text-red-700 hover:bg-red-200 hover:text-red-800 rounded-md font-medium",
                }}
                onDayClick={(date) => {
                  const matchingRange = blockedDateMap.get(format(date, "yyyy-MM-dd"));
                  if (matchingRange) {
                    onBlockedDayClick?.(date, matchingRange);
                  }
                }}
                className="rounded-xl border border-border/40 bg-background px-2 py-3 shadow-sm"
                classNames={{
                  month: "space-y-2",
                  caption: "flex items-center justify-center pt-1 relative",
                  caption_label: "text-sm font-semibold",
                  head_row: "flex",
                  head_cell: "w-8 text-[10px] font-medium text-muted-foreground",
                  row: "mt-1 flex w-full",
                  cell: "h-8 w-8 p-0 text-center text-sm",
                  day: "h-8 w-8 rounded-md text-xs font-normal",
                  day_today: "bg-primary/10 text-primary font-semibold",
                  day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                  day_range_middle: "bg-primary/15 text-foreground",
                }}
              />
            ) : (
              <Calendar
                key={monthDate.toISOString()}
                mode="single"
                month={monthDate}
                selected={selectedDate}
                onSelect={onSelectDate}
                disabled={[
                  { before: today },
                  ...blockedDates,
                ]}
                modifiers={{
                  blocked: blockedDates,
                }}
                modifiersClassNames={{
                  blocked: "bg-red-100 text-red-700 hover:bg-red-200 hover:text-red-800 rounded-md font-medium",
                }}
                onDayClick={(date) => {
                  const matchingRange = blockedDateMap.get(format(date, "yyyy-MM-dd"));
                  if (matchingRange) {
                    onBlockedDayClick?.(date, matchingRange);
                  }
                }}
                className="rounded-xl border border-border/40 bg-background px-2 py-3 shadow-sm"
                classNames={{
                  month: "space-y-2",
                  caption: "flex items-center justify-center pt-1 relative",
                  caption_label: "text-sm font-semibold",
                  head_row: "flex",
                  head_cell: "w-8 text-[10px] font-medium text-muted-foreground",
                  row: "mt-1 flex w-full",
                  cell: "h-8 w-8 p-0 text-center text-sm",
                  day: "h-8 w-8 rounded-md text-xs font-normal",
                  day_today: "bg-primary/10 text-primary font-semibold",
                  day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                }}
              />
            ),
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-red-100" />
          Reserved days
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-primary/20" />
          Your selection
        </span>
      </div>
    </div>
  );
}
