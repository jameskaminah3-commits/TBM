// zaina-platform/web/console/pages/inbox.tsx
//
// The team's inbox: chats waiting for a person, the person's own, callbacks
// to make, and every recent chat; one chat's transcript with claim, reply,
// hand back to Zaina and close. WhatsApp chats show whether each reply was
// delivered and read, and when the 24-hour window closes.

import { useEffect, useRef, useState } from "react";
import { api, apiFile, businessPath } from "../api.ts";
import { go } from "../app.tsx";
import { clock, timeAgo } from "../format.ts";
import { atLeast, type ChatDetail, type ChatMedia, type ChatSummary, type Me, type Role, type TranscriptEvent } from "../types.ts";
import { Button, Empty, ErrorLine, Icon, Message, Modal, Tabs, useAction, useEvery, useLoad } from "../ui.tsx";

type Filter = "waiting" | "mine" | "active" | "callbacks" | "all" | "everything";

function status(chat: ChatSummary): { label: string; tone: "waiting" | "team" | "zaina" | "closed" | "callback" } {
  if (chat.managedBy === "CLOSED") return { label: "Closed", tone: "closed" };
  if (chat.managedBy === "HUMAN" && !chat.assignedAgentId) return { label: "Waiting", tone: "waiting" };
  if (chat.managedBy === "HUMAN") return { label: `With ${chat.claimedByName?.split(" ")[0] ?? "the team"}`, tone: "team" };
  if (chat.callbackRequestedAt) return { label: "Callback", tone: "callback" };
  return { label: "Zaina", tone: "zaina" };
}

export function InboxPage(props: { businessId: string; role: Role; me: Me; chatId: string | null; counts: { pending: number; mine: number; callbacks: number }; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>("waiting");
  const list = useLoad(() => api<{ sessions: ChatSummary[] }>("GET", businessPath(props.businessId, `/sessions?filter=${filter}`)), [props.businessId, filter]);
  useEvery(() => void list.reload(), 5_000, [props.businessId, filter]);

  const tabs: Array<{ id: Filter; label: string; count?: number }> = [
    { id: "waiting", label: "Waiting", count: props.counts.pending },
    ...(atLeast(props.role, "agent") ? [{ id: "mine" as const, label: "Mine", count: props.counts.mine }] : []),
    { id: "active", label: "With the team" },
    { id: "callbacks", label: "Callbacks", count: props.counts.callbacks },
    { id: "everything", label: "All chats" },
  ];

  return (
    <div className={`inbox${props.chatId ? " has-chat" : ""}`}>
      <section className="inbox-list" aria-label="Chats">
        <div className="page-head">
          <h1>Inbox</h1>
        </div>
        <Tabs tabs={tabs} active={filter} onChange={setFilter} label="Which chats" />
        <ErrorLine error={list.error} />
        {list.data && list.data.sessions.length === 0 ? (
          <Empty title={filter === "waiting" ? "Nobody is waiting" : "No chats here"}>
            {filter === "waiting" ? <p>When a customer asks for a person, the chat appears here and you get an alert.</p> : null}
          </Empty>
        ) : null}
        <ul className="chat-list">
          {list.data?.sessions.map((chat) => {
            const state = status(chat);
            const offeredToMe = chat.routedTo === props.me.user.id && !chat.assignedAgentId && chat.managedBy === "HUMAN";
            return (
              <li key={chat.id}>
                <a href={`#/b/${encodeURIComponent(props.businessId)}/inbox/${chat.id}`} className={`chat-item${props.chatId === chat.id ? " selected" : ""}`}>
                  <span className={`channel ${chat.channel}`} title={chat.channel === "whatsapp" ? "WhatsApp" : "Website"}>
                    <Icon name={chat.channel === "whatsapp" ? "whatsapp" : "globe"} size={16} label={chat.channel === "whatsapp" ? "WhatsApp" : "Website"} />
                  </span>
                  <span className="chat-item-body">
                    <span className="chat-item-top">
                      <strong>{chat.customer.label}</strong>
                      <span className="muted small">{timeAgo(chat.lastMessageAt ?? chat.updatedAt)}</span>
                    </span>
                    <span className="chat-item-preview">{chat.lastMessage ?? "—"}</span>
                    <span className="chat-item-tags">
                      <span className={`chip ${state.tone}`}>{state.label}</span>
                      {offeredToMe ? <span className="chip offered">Offered to you</span> : null}
                      {chat.handoffReason && chat.managedBy === "HUMAN" ? <span className="muted small ellipsis">{chat.handoffReason}</span> : null}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="inbox-chat" aria-label="Chat">
        {props.chatId ? (
          <ChatView key={props.chatId} businessId={props.businessId} chatId={props.chatId} role={props.role} onChanged={() => { props.onChanged(); void list.reload(); }} />
        ) : (
          <Empty title="Choose a chat">
            <p>Pick a chat on the left to read it, take it over, or reply.</p>
          </Empty>
        )}
      </section>
    </div>
  );
}

function DeliveryMark(props: { delivery: TranscriptEvent["delivery"] }) {
  const delivery = props.delivery;
  if (!delivery) return null;
  const text = {
    sent: "Sent",
    delivered: "Delivered",
    read: "Read",
    failed: `Not delivered${delivery.error ? `: ${delivery.error}` : ""}`,
    waiting: "Waiting for the customer to write (24-hour window)",
  }[delivery.status];
  return (
    <span className={`delivery ${delivery.status}`}>
      <Icon name={delivery.status === "failed" ? "alert" : delivery.status === "waiting" ? "clock" : "check"} size={13} />
      {text}
    </span>
  );
}

function MediaButton(props: { businessId: string; media: ChatMedia; channel: string }) {
  const [open, setOpen] = useState<{ url: string; type: string } | null>(null);
  const action = useAction();
  const label = { photo: "Photo", voice: "Voice note", video: "Video", document: props.media.fileName ?? "Document" }[props.media.kind] ?? "Attachment";
  if (props.channel !== "whatsapp") return <span className="chip">{label}</span>;
  return (
    <>
      <Button small busy={action.busy} onClick={() => void action.run(async () => setOpen(await apiFile(businessPath(props.businessId, `/whatsapp/media/${encodeURIComponent(props.media.id)}`))))}>
        <Icon name="photo" size={14} /> View {label.toLowerCase()}
      </Button>
      <Message message={action.message} />
      {open ? (
        <Modal title={label} onClose={() => { URL.revokeObjectURL(open.url); setOpen(null); }}>
          {open.type.startsWith("image/") ? <img className="media-view" src={open.url} alt={props.media.caption ?? "What the customer sent"} /> : null}
          {open.type.startsWith("audio/") ? <audio controls src={open.url} /> : null}
          {open.type.startsWith("video/") ? <video controls src={open.url} className="media-view" /> : null}
          {!/^(image|audio|video)\//.test(open.type) ? <a href={open.url} download>Download the file</a> : null}
        </Modal>
      ) : null}
    </>
  );
}

function ToolStep(props: { event: TranscriptEvent }) {
  const [open, setOpen] = useState(false);
  const ok = (props.event.toolResponse as { ok?: boolean } | null)?.ok;
  return (
    <div className="tool-step">
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        Zaina used <code>{props.event.toolName}</code>{ok === false ? " (didn't work)" : ""}
      </button>
      {open ? (
        <pre>{JSON.stringify({ asked: props.event.toolArguments, got: props.event.toolResponse }, null, 2)}</pre>
      ) : null}
    </div>
  );
}

function ChatView(props: { businessId: string; chatId: string; role: Role; onChanged: () => void }) {
  const detail = useLoad(() => api<ChatDetail>("GET", businessPath(props.businessId, `/sessions/${props.chatId}`)), [props.businessId, props.chatId]);
  useEvery(() => void detail.reload(), 3_000, [props.businessId, props.chatId]);
  const [draft, setDraft] = useState("");
  const [showSteps, setShowSteps] = useState(false);
  const action = useAction();
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const transcript = detail.data?.transcript ?? [];
  useEffect(() => {
    if (transcript.length !== lastCount.current) {
      lastCount.current = transcript.length;
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [transcript.length]);

  if (!detail.data) {
    return <div className="chat-empty">{detail.error ? <ErrorLine error={detail.error} /> : <p className="muted">Loading…</p>}</div>;
  }
  const { session, followups } = detail.data;
  const state = status(session);
  const canAct = atLeast(props.role, "agent");
  const act = (path: string, success: string) => action.run(async () => {
    await api("POST", businessPath(props.businessId, `/sessions/${props.chatId}/${path}`));
    await detail.reload();
    props.onChanged();
  }, success);
  const windowClosed = session.channel === "whatsapp" && session.window && !session.window.open;

  return (
    <div className="chat">
      <header className="chat-head">
        <button type="button" className="icon-button back" aria-label="Back to the list" onClick={() => go({ businessId: props.businessId, page: "inbox" })}>
          <Icon name="back" />
        </button>
        <div className="chat-who">
          <h2>{session.customer.label}</h2>
          <p className="muted small">
            {session.channel === "whatsapp" ? "WhatsApp" : "Website chat"}
            {session.customer.phone ? <> · <a href={`tel:${session.customer.phone}`}>{session.customer.phone}</a></> : null}
            {" · "}started {clock(session.createdAt)}
            {session.language === "sw" ? " · Swahili" : ""}
          </p>
        </div>
        <span className={`chip ${state.tone}`}>{state.label}</span>
      </header>

      {session.managedBy === "HUMAN" && session.handoffReason ? (
        <p className="handoff-note"><strong>Why it was handed over</strong> (only the team sees this): {session.handoffReason}
          {session.routedToName && !session.assignedAgentId ? <> · offered to {session.routedToName}</> : null}
        </p>
      ) : null}

      {canAct ? (
        <div className="chat-actions">
          {session.managedBy !== "CLOSED" && !session.assignedAgentId ? (
            <Button kind="primary" small busy={action.busy} onClick={() => void act("claim", "You have this chat. Zaina stays quiet until you hand it back.")}>
              {session.managedBy === "AI" ? "Take over from Zaina" : "Claim"}
            </Button>
          ) : null}
          {session.managedBy === "HUMAN" ? <Button small busy={action.busy} onClick={() => void act("release", "Zaina is answering again.")}>Hand back to Zaina</Button> : null}
          {session.callbackRequestedAt ? <Button small busy={action.busy} onClick={() => void act("callback-done", "Callback marked done.")}>Callback done</Button> : null}
          {session.managedBy !== "CLOSED" ? <Button small kind="ghost" busy={action.busy} onClick={() => void act("close", "Chat closed.")}>Close chat</Button> : null}
          <label className="steps-toggle"><input type="checkbox" checked={showSteps} onChange={(event) => setShowSteps(event.target.checked)} /> Show Zaina's steps</label>
        </div>
      ) : null}
      <Message message={action.message} />

      <div className="transcript" role="log" aria-label="Conversation">
        {transcript.map((event) => {
          if (event.actor === "SYSTEM_TOOL") return showSteps ? <ToolStep key={event.id} event={event} /> : null;
          if (event.actor === "SYSTEM") return <p key={event.id} className="system-note">{event.content} · {clock(event.createdAt)}</p>;
          const side = event.actor === "USER" ? "customer" : event.actor === "AGENT" ? "team" : "zaina";
          const who = side === "customer" ? session.customer.label : side === "team" ? (event.authorName ?? "Team") : "Zaina";
          return (
            <div key={event.id} className={`bubble-row ${side}`}>
              <span className="bubble-who">{who} · {clock(event.createdAt)}</span>
              {event.content ? <div className="bubble">{event.content}</div> : null}
              {event.media?.length ? (
                <div className="bubble-media">{event.media.map((media) => <MediaButton key={media.id} businessId={props.businessId} media={media} channel={session.channel} />)}</div>
              ) : null}
              <DeliveryMark delivery={event.delivery} />
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {canAct && session.managedBy !== "CLOSED" ? (
        <form
          className="composer"
          onSubmit={async (event) => {
            event.preventDefault();
            const message = draft.trim();
            if (!message) return;
            const outcome = { delivery: null as string | null };
            const sent = await action.run(async () => {
              outcome.delivery = (await api<{ delivery: string | null }>("POST", businessPath(props.businessId, `/sessions/${props.chatId}/messages`), { message })).delivery;
            });
            if (!sent) return;
            setDraft("");
            if (outcome.delivery === "window_closed") {
              action.setMessage({ kind: "success", text: "Saved. WhatsApp only allows free replies within 24 hours of the customer's last message, so this goes out when they write back." });
            } else if (outcome.delivery === "retry" || outcome.delivery === "pending" || outcome.delivery === "busy") {
              action.setMessage({ kind: "success", text: "Sending on WhatsApp…" });
            } else if (outcome.delivery === "auth_problem" || outcome.delivery === "not_connected") {
              action.setMessage({ kind: "error", text: "Saved, but WhatsApp isn't connected properly, so it wasn't sent. An owner can fix it in Settings → WhatsApp." });
            }
            await detail.reload();
            props.onChanged();
          }}
        >
          {windowClosed ? (
            <p className="window-note">
              <Icon name="clock" size={14} /> The customer last wrote over 24 hours ago. WhatsApp holds replies until they write again
              {followups.length ? "; the follow-up template has told them a reply is waiting." : ". Add a follow-up template in Settings → WhatsApp to let them know."}
            </p>
          ) : session.window?.closesAt ? (
            <p className="window-note muted small">Free replies on WhatsApp until {clock(session.window.closesAt)}.</p>
          ) : null}
          <label className="visually-hidden" htmlFor="reply">Your reply</label>
          <textarea
            id="reply"
            value={draft}
            maxLength={2000}
            rows={3}
            placeholder={session.managedBy === "AI" ? "Writing here takes the chat over from Zaina…" : "Write to the customer…"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) (event.currentTarget.form as HTMLFormElement).requestSubmit();
            }}
          />
          <div className="composer-bar">
            <span className="muted small">Ctrl+Enter to send</span>
            <Button kind="primary" type="submit" busy={action.busy} disabled={!draft.trim()}><Icon name="send" size={15} /> Send</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
