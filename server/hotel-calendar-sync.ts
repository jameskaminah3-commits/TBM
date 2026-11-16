// server/hotel-calendar-sync.ts
//
// Reads the calendars hotels linked from other booking sites, and blocks
// the nights taken there (server/hotel-calendar.ts). Each link is read when
// it's added, when the hotel asks, and every half hour.

import type { StayCalendarFeed } from "@shared/schema";
import { loadCalendarEvents } from "./hotel-calendar";
import { storage } from "./storage";

const SYNC_EVERY_MS = 30 * 60 * 1000;
const FIRST_SYNC_AFTER_MS = 90 * 1000;

/** Reads one calendar and makes its blocks the nights it lists now. */
export async function syncCalendarFeed(feed: StayCalendarFeed): Promise<StayCalendarFeed> {
  const result = await loadCalendarEvents(feed.url);
  await storage.replaceCalendarFeedBlocks(
    feed,
    (result.events ?? []).map((event) => ({ startDate: event.startDate, endDate: event.endDate, externalUid: event.uid })),
    { error: result.error },
  );
  return (await storage.getStayCalendarFeed(feed.id)) ?? feed;
}

let running = false;

async function syncAllCalendarFeeds() {
  if (running) {
    return;
  }
  running = true;
  try {
    // One at a time: a slow site holds up nothing else on the server.
    for (const feed of await storage.getAllStayCalendarFeeds()) {
      try {
        await syncCalendarFeed(feed);
      } catch (error) {
        console.error("[CALENDAR_SYNC] Could not sync a calendar:", error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    console.error("[CALENDAR_SYNC] Could not list calendars:", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startCalendarSync() {
  if (timer) {
    return;
  }
  setTimeout(() => void syncAllCalendarFeeds(), FIRST_SYNC_AFTER_MS).unref?.();
  timer = setInterval(() => void syncAllCalendarFeeds(), SYNC_EVERY_MS);
  timer.unref?.();
}
