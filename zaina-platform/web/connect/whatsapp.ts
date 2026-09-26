// zaina-platform/web/connect/whatsapp.ts
//
// "Connect with Facebook" for a business's WhatsApp number (Meta's Embedded
// Signup), on a page of its own (/connect/whatsapp?business=<id>): it runs
// Meta's JavaScript SDK, which the console's own content policy never
// allows. The owner signs in with Facebook and chooses (or creates) the
// business's WhatsApp account and number; Meta hands this page a short-lived
// code (the sign-in's answer) and, in a message from facebook.com, the
// account's and number's ids. The platform then exchanges the code for the
// business's own token, checks the number is in that account, registers it
// and subscribes to its messages. Signed in to the console already: the
// console's cookie and header go with every call, as from the console.

type Signup = { app_id: string; config_id: string; graph_version: string };
type Whatsapp = { available: boolean; embedded_signup: Signup | null; connection: { display_phone_number: string | null } | null };
type FacebookSdk = {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void, options: Record<string, unknown>): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

(function start() {
  const status = document.getElementById("status")!;
  const button = document.getElementById("connect") as HTMLButtonElement;
  const back = document.getElementById("back") as HTMLAnchorElement;
  const business = new URLSearchParams(location.search).get("business") ?? "";
  const businessPath = `/v1/staff/businesses/${encodeURIComponent(business)}/whatsapp`;
  if (/^[a-z][a-z0-9-]{1,59}$/.test(business)) back.href = `/console/#/b/${encodeURIComponent(business)}/settings/whatsapp`;

  function say(text: string, kind: "error" | "success" | "info" = "info") {
    status.className = kind === "info" ? "muted" : `message ${kind}`;
    status.textContent = text;
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T & { message?: string } }> {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "x-zaina-console": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  // What Meta hands back: the code from the sign-in, and the ids from its message.
  let code: string | null = null;
  let ids: { phone_number_id: string; waba_id: string } | null = null;
  let finishing = false;
  let waitForIds: number | undefined;

  window.addEventListener("message", (event: MessageEvent) => {
    if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/.test(event.origin)) return;
    let data: any = event.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
    if (data.event === "FINISH" || data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
      const phone = String(data.data?.phone_number_id ?? "");
      const waba = String(data.data?.waba_id ?? "");
      if (/^\d{5,30}$/.test(phone) && /^\d{5,30}$/.test(waba)) {
        ids = { phone_number_id: phone, waba_id: waba };
        void finish();
      }
    } else if (data.event === "FINISH_ONLY_WABA") {
      say("The WhatsApp account was set up, but no phone number was chosen. Please try again and add the number customers message.", "error");
      button.disabled = false;
    } else if (data.event === "CANCEL") {
      const step = data.data?.current_step ? ` (at "${String(data.data.current_step).slice(0, 60)}")` : "";
      say(`The Facebook sign-in was closed before it finished${step}. Nothing was changed.`, "error");
      button.disabled = false;
    } else if (data.event === "ERROR") {
      say(`Meta reported a problem: ${String(data.data?.error_message ?? "unknown").slice(0, 200)}`, "error");
      button.disabled = false;
    }
  });

  async function finish() {
    if (!code || !ids || finishing) return;
    finishing = true;
    window.clearTimeout(waitForIds);
    say("Connecting your number…");
    const result = await call<{ connection: { display_phone_number: string | null } | null; warnings?: string[]; pin?: string | null }>("POST", `${businessPath}/embedded`, { code, ...ids });
    if (result.status !== 200) {
      finishing = false;
      code = null;
      button.disabled = false;
      say(result.body.message ?? "The number couldn't be connected. Please try again.", "error");
      return;
    }
    const number = result.body.connection?.display_phone_number ?? "Your number";
    const lines = [`Connected: ${number}. Customers who message it now get Zaina's answers.`];
    if (result.body.pin) lines.push(`Its two-step verification PIN is ${result.body.pin}. Keep it somewhere safe: Meta asks for it if the number is ever moved.`);
    for (const warning of result.body.warnings ?? []) lines.push(warning);
    say(lines.join(" "), "success");
    button.remove();
    back.textContent = "Back to WhatsApp settings";
  }

  button.addEventListener("click", () => {
    const sdk = window.FB;
    if (!sdk || !signup) return;
    button.disabled = true;
    code = null;
    ids = null;
    say("Finish the steps in the Facebook window…");
    sdk.login((response) => {
      const given = response.authResponse?.code;
      if (!given) {
        button.disabled = false;
        say("The Facebook sign-in was closed before it finished. Nothing was changed.", "error");
        return;
      }
      code = given;
      // The ids come in a message of their own; if it never comes, no number was chosen.
      waitForIds = window.setTimeout(() => {
        if (!ids && !finishing) {
          button.disabled = false;
          say("Facebook didn't say which number was chosen. Please try again and choose the number customers message.", "error");
        }
      }, 8000);
      void finish();
    }, {
      config_id: signup.config_id,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
    });
  });

  let signup: Signup | null = null;

  async function boot() {
    if (!/^[a-z][a-z0-9-]{1,59}$/.test(business)) {
      say("Open this page from the console: Settings → WhatsApp.", "error");
      return;
    }
    const state = await call<Whatsapp>("GET", businessPath).catch(() => null);
    if (!state || state.status === 401) {
      say("Sign in to the console first, then come back here from Settings → WhatsApp.", "error");
      back.textContent = "Sign in";
      return;
    }
    if (state.status !== 200) {
      say(state.body.message ?? "Only an owner of this business can connect WhatsApp.", "error");
      return;
    }
    if (!state.body.available || !state.body.embedded_signup) {
      say("Connecting with Facebook isn't set up on this platform yet. Connect with the number's ids and a token in Settings → WhatsApp instead.", "error");
      return;
    }
    signup = state.body.embedded_signup;
    if (state.body.connection) say(`Connected now: ${state.body.connection.display_phone_number ?? "a number"}. Connecting again replaces it.`);
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: signup!.app_id, autoLogAppEvents: true, xfbml: false, version: signup!.graph_version });
      button.disabled = false;
    };
    const sdk = document.createElement("script");
    sdk.src = "https://connect.facebook.net/en_US/sdk.js";
    sdk.async = true;
    sdk.crossOrigin = "anonymous";
    sdk.onerror = () => say("Facebook's sign-in couldn't load. Check the connection (or an ad blocker) and reload the page.", "error");
    document.head.append(sdk);
  }

  void boot();
})();

export {};
