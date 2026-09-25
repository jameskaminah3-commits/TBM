// zaina-platform/src/channels/whatsapp/graph.ts
//
// The WhatsApp Cloud API (Meta's Graph API), as the platform uses it: send a
// text or an approved template, mark a message read, check a number and its
// token, subscribe the platform's app to a business's account, and fetch a
// customer's photo or document for the team. Every call names the business's
// own number and uses the business's own token.

export const GRAPH_HOST = "https://graph.facebook.com";

export type GraphTarget = { version: string; phoneNumberId: string; accessToken: string };

/** What went wrong, in the terms the platform acts on. */
export type GraphFailure = {
  ok: false;
  /** Meta's error code (0 when the request never got an answer). */
  code: number;
  title: string;
  /** Try again later: rate limits, Meta's own outages, network trouble. */
  retryable: boolean;
  /** The customer's 24-hour window has closed: only a template can reach them. */
  windowClosed: boolean;
  /** The token or the app's access is wrong: the business must fix its connection. */
  authProblem: boolean;
  status: number;
};

export type GraphResult<T> = ({ ok: true } & T) | GraphFailure;

const RETRYABLE_CODES = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);
const AUTH_CODES = new Set([10, 102, 190, 200, 3, 131005, 131031]);
const WINDOW_CODES = new Set([131047]);

export function describeFailure(status: number, body: any): GraphFailure {
  const error = body?.error ?? {};
  const code = Number.isInteger(error.code) ? error.code : 0;
  const details = typeof error.error_data?.details === "string" ? error.error_data.details : "";
  const title = String(error.error_user_title ?? error.message ?? (status ? `HTTP ${status}` : "No answer")).slice(0, 300)
    + (details && !String(error.message ?? "").includes(details) ? ` (${details.slice(0, 200)})` : "");
  return {
    ok: false,
    code,
    title,
    retryable: status === 0 || status >= 500 || status === 429 || RETRYABLE_CODES.has(code),
    windowClosed: WINDOW_CODES.has(code),
    authProblem: AUTH_CODES.has(code) || status === 401,
    status,
  };
}

async function call<T>(method: "GET" | "POST", url: string, accessToken: string, body?: unknown): Promise<GraphResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { ...describeFailure(0, { error: { message: (error as Error).message } }), retryable: true };
  }
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: { message: text.slice(0, 200) } };
  }
  if (!response.ok || parsed?.error) return describeFailure(response.status, parsed);
  return { ok: true, ...(parsed as T) };
}

const messagesUrl = (target: GraphTarget) => `${GRAPH_HOST}/${target.version}/${encodeURIComponent(target.phoneNumberId)}/messages`;

type Sent = { messageId: string };

function sentFrom(result: GraphResult<{ messages?: Array<{ id?: string }> }>): GraphResult<Sent> {
  if (!result.ok) return result;
  const messageId = result.messages?.[0]?.id;
  return messageId ? { ok: true, messageId } : describeFailure(502, { error: { message: "No message id in Meta's answer" } });
}

export async function sendText(target: GraphTarget, to: string, body: string): Promise<GraphResult<Sent>> {
  return sentFrom(await call("POST", messagesUrl(target), target.accessToken, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: /https?:\/\//.test(body), body },
  }));
}

export async function sendTemplate(
  target: GraphTarget,
  to: string,
  template: { name: string; language: string; bodyParameter: string | null },
): Promise<GraphResult<Sent>> {
  return sentFrom(await call("POST", messagesUrl(target), target.accessToken, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(template.bodyParameter !== null
        ? { components: [{ type: "body", parameters: [{ type: "text", text: template.bodyParameter }] }] }
        : {}),
    },
  }));
}

/** Blue ticks for the customer, and "typing…" while Zaina works on the answer. */
export async function markRead(target: GraphTarget, messageId: string, typing: boolean): Promise<GraphResult<{}>> {
  const body = { messaging_product: "whatsapp", status: "read", message_id: messageId };
  const withTyping = typing ? await call<{}>("POST", messagesUrl(target), target.accessToken, { ...body, typing_indicator: { type: "text" } }) : null;
  if (withTyping?.ok) return withTyping;
  return call<{}>("POST", messagesUrl(target), target.accessToken, body);
}

export type NumberDetails = { displayPhoneNumber: string | null; verifiedName: string | null; qualityRating: string | null };

/** Checks that the token can use the number, and reads how the number shows to customers. */
export async function checkNumber(version: string, phoneNumberId: string, accessToken: string): Promise<GraphResult<NumberDetails>> {
  const result = await call<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
    "GET",
    `${GRAPH_HOST}/${version}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
    accessToken,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    displayPhoneNumber: result.display_phone_number ?? null,
    verifiedName: result.verified_name ?? null,
    qualityRating: result.quality_rating ?? null,
  };
}

/** Subscribes the platform's app to the business's WhatsApp account, so its messages reach the webhook. */
export async function subscribeApp(version: string, wabaId: string, accessToken: string): Promise<GraphResult<{ success?: boolean }>> {
  return call("POST", `${GRAPH_HOST}/${version}/${encodeURIComponent(wabaId)}/subscribed_apps`, accessToken, {});
}

export type MediaFile = { body: ReadableStream<Uint8Array> | null; contentType: string; length: string | null };

/** A customer's photo, voice note or document, streamed for the team (never stored). */
export async function fetchMedia(version: string, mediaId: string, accessToken: string): Promise<GraphResult<MediaFile>> {
  const info = await call<{ url?: string; mime_type?: string }>("GET", `${GRAPH_HOST}/${version}/${encodeURIComponent(mediaId)}`, accessToken);
  if (!info.ok) return info;
  if (!info.url || !/^https:\/\//.test(info.url)) return describeFailure(502, { error: { message: "No media address in Meta's answer" } });
  try {
    const response = await fetch(info.url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return describeFailure(response.status, null);
    return {
      ok: true,
      body: response.body,
      contentType: info.mime_type ?? response.headers.get("content-type") ?? "application/octet-stream",
      length: response.headers.get("content-length"),
    };
  } catch (error) {
    return { ...describeFailure(0, { error: { message: (error as Error).message } }), retryable: true };
  }
}
