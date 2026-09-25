// zaina-platform/src/engine/history.ts
//
// The conversation as the model sees it, kept short (Phase 2). The latest
// exchanges go as they were; older tool results are cut to the facts a later
// turn needs (ids, names, prices, links, errors) and older messages are
// shortened. Beyond the window nothing is sent, except a note of anything
// payable created earlier in the chat, so its payment link can be given again.

import type { Content } from "@google/genai";
import type { HistoryRow } from "../conversations/store.ts";
import { formatToolHistoryEntry, neutralizeToolMarkers, redactMediaUrls } from "./reply-policy.ts";

/** Events sent as they were. */
export const RECENT_EVENTS = 12;
/** Events sent at all. */
export const MAX_EVENTS = 40;
const RECENT_TOOL_CHARS = 1500;
const OLDER_TOOL_CHARS = 500;
const OLDER_MESSAGE_CHARS = 500;
const ITEMS_KEPT = 5;
const TEXT_KEPT = 160;

/** The keys worth keeping from an older tool result. */
const KEPT_KEY = /^(ok|error|hint|status|available|title|name|option_index|region|location|mode|date|check_in|check_out|guests|payment_link|public_url|total|currency|message)$|(_id|_ids|_display|_url|_link)$/;

/** An older tool result, reduced to what later turns refer back to. */
export function compactToolData(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const items = value.slice(0, ITEMS_KEPT).map((item) => compactToolData(item, depth + 1));
    return value.length > ITEMS_KEPT ? [...items, `…${value.length - ITEMS_KEPT} more`] : items;
  }
  if (value && typeof value === "object") {
    const kept: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (KEPT_KEY.test(key)) kept[key] = compactToolData(item, depth + 1);
      else if (depth < 2 && (Array.isArray(item) || (item && typeof item === "object"))) {
        const inner = compactToolData(item, depth + 1);
        if (inner && (Array.isArray(inner) ? inner.length : Object.keys(inner as object).length)) kept[key] = inner;
      }
    }
    return kept;
  }
  if (typeof value === "string" && value.length > TEXT_KEPT) return `${value.slice(0, TEXT_KEPT)}…`;
  return value;
}

function capped(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text;
}

function toolEntry(row: HistoryRow, recent: boolean): string {
  const args = row.toolArguments ? redactMediaUrls(JSON.stringify(recent ? row.toolArguments : compactToolData(row.toolArguments))) : "{}";
  const result = row.toolResponse ? redactMediaUrls(JSON.stringify(recent ? row.toolResponse : compactToolData(row.toolResponse))) : "null";
  return formatToolHistoryEntry(row.toolName ?? "tool", capped(args, recent ? RECENT_TOOL_CHARS : 300), capped(result, recent ? RECENT_TOOL_CHARS : OLDER_TOOL_CHARS));
}

/** Something payable made earlier in the chat, for the note above the window. */
function payableNote(row: HistoryRow): string | null {
  const response = row.toolResponse as { ok?: boolean; booking_id?: string; payment_link?: string } | null;
  if (!row.toolName?.startsWith("create_") || response?.ok !== true || typeof response.payment_link !== "string") return null;
  return `${row.toolName.replace(/^create_/, "").replace(/_/g, " ")} ${response.booking_id ?? ""} (payment link ${response.payment_link})`.replace(/\s+/g, " ");
}

/**
 * The model's view of the conversation. `rows` are oldest first and may reach
 * further back than the window (fetch up to twice MAX_EVENTS): anything
 * payable before the window is noted.
 */
export function buildHistory(rows: HistoryRow[]): Content[] {
  const window = rows.slice(-MAX_EVENTS);
  const beforeWindow = rows.slice(0, rows.length - window.length);
  const notes = beforeWindow.map(payableNote).filter((note): note is string => note !== null);
  const contents: Content[] = [];
  if (notes.length) {
    contents.push({ role: "user", parts: [{ text: `[Earlier in this chat, not shown: ${notes.join("; ")}.]` }] });
  }
  const firstRecent = window.length - RECENT_EVENTS;
  window.forEach((row, index) => {
    const recent = index >= firstRecent;
    if (row.actor === "USER" && row.content) {
      const text = neutralizeToolMarkers(redactMediaUrls(row.content));
      contents.push({ role: "user", parts: [{ text: recent ? text : capped(text, OLDER_MESSAGE_CHARS) }] });
    } else if (row.actor === "ZAINA_REASONING" && row.content) {
      const text = redactMediaUrls(row.content);
      contents.push({ role: "model", parts: [{ text: recent ? text : capped(text, OLDER_MESSAGE_CHARS) }] });
    } else if (row.actor === "SYSTEM_TOOL" && row.toolName) {
      contents.push({ role: "user", parts: [{ text: toolEntry(row, recent) }] });
    }
  });
  return contents;
}
