// zaina-platform/src/channels/whatsapp/routes.ts
//
// WhatsApp's routes.
//
//   Meta (one webhook for the whole platform):
//     GET  /v1/whatsapp/webhook   the set-up handshake (hub.verify_token)
//     POST /v1/whatsapp/webhook   messages and status updates, signed with the app secret
//
//   Per business (/v1/staff/businesses/:businessId/…):
//     GET    whatsapp                    manager   the connection, and the webhook address to give Meta
//     PUT    whatsapp                    owner     connect or update: { phone_number_id, waba_id?, access_token?,
//                                                  followup_template?, followup_template_language?, followup_template_parameter? }
//     DELETE whatsapp                    owner     disconnect (the token is deleted)
//     GET    whatsapp/media/:mediaId     viewer    a photo, voice note or document a customer sent, streamed from Meta

import { Readable } from "node:stream";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { PlatformConfig } from "../../config.ts";
import { followupParameters, type FollowupParameter } from "../../db/schema.ts";
import { inBusiness } from "../../db/tenant.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../../staff/auth.ts";
import type { WhatsappContext } from "./context.ts";
import { checkNumber, fetchMedia, subscribeApp } from "./graph.ts";
import { acceptDelivery, scheduleAnswer } from "./inbound.ts";
import { connectionFor, disconnect, getNumber, saveConnection } from "./numbers.ts";
import { requestDelivery } from "./runtime.ts";
import { validSignature, verificationChallenge } from "./webhook.ts";

export const WEBHOOK_PATH = "/v1/whatsapp/webhook";

const MEDIA_TYPES = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|amr)|video\/(mp4|3gpp)|application\/pdf)(;.*)?$/i;

export function registerWhatsappRoutes(app: Express, config: PlatformConfig, ctx: WhatsappContext | null): void {
  app.get(WEBHOOK_PATH, (req: Request, res: Response) => {
    if (!ctx) return res.status(404).json({ error: "not_found" });
    const challenge = verificationChallenge(req.query as Record<string, unknown>, ctx.whatsapp.verifyToken);
    if (!challenge) return res.status(403).json({ error: "verification_failed" });
    res.type("text/plain").send(challenge);
  });

  app.post(WEBHOOK_PATH, express.raw({ type: () => true, limit: "2mb" }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!ctx) return res.status(404).json({ error: "not_found" });
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!validSignature(ctx.whatsapp.appSecret, raw, req.header("x-hub-signature-256"))) {
        console.warn("[whatsapp] refused a webhook delivery without a valid signature");
        return res.status(401).json({ error: "invalid_signature" });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "invalid_json" });
      }
      // Stored before answering Meta: if storing fails, Meta sends it again.
      const accepted = await acceptDelivery(ctx, payload);
      res.status(200).json({ ok: true });
      for (const chat of accepted.toAnswer) scheduleAnswer(ctx, chat);
      for (const chat of accepted.toDeliver) void requestDelivery(chat.businessId, chat.sessionId);
    } catch (error) {
      next(error);
    }
  });

  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId/whatsapp";

  const describe = async (businessId: string) => {
    const number = await getNumber(businessId);
    const connection = number ? await connectionFor(businessId) : null;
    return {
      available: Boolean(ctx),
      webhook_url: config.publicBaseUrl ? `${config.publicBaseUrl}${WEBHOOK_PATH}` : null,
      connection: number
        ? {
            phone_number_id: number.phoneNumberId,
            waba_id: number.wabaId,
            display_phone_number: number.displayPhoneNumber,
            verified_name: number.verifiedName,
            followup_template: number.followupTemplate,
            followup_template_language: number.followupTemplateLanguage,
            followup_template_parameter: number.followupTemplateParameter,
            status: number.status,
            connected_at: number.connectedAt,
            has_token: Boolean(connection),
          }
        : null,
    };
  };

  app.get(base, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await describe(staffOf(req).business!.id));
    } catch (error) {
      next(error);
    }
  });

  app.put(base, staff, requireBusinessRole("owner"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!ctx) return res.status(503).json({ error: "whatsapp_not_configured", message: "WhatsApp isn't set up on this platform yet." });
      const { business, user } = staffOf(req);
      const body = req.body ?? {};
      const phoneNumberId = String(body.phone_number_id ?? "").trim();
      const wabaId = body.waba_id === undefined || body.waba_id === null || body.waba_id === "" ? null : String(body.waba_id).trim();
      const newToken = typeof body.access_token === "string" && body.access_token.trim() ? body.access_token.trim() : null;
      const template = typeof body.followup_template === "string" && body.followup_template.trim() ? body.followup_template.trim() : null;
      const language = typeof body.followup_template_language === "string" && body.followup_template_language.trim() ? body.followup_template_language.trim() : "en";
      const parameter = (body.followup_template_parameter ?? "none") as FollowupParameter;

      if (!/^\d{5,30}$/.test(phoneNumberId)) return res.status(400).json({ error: "invalid_phone_number_id", message: "The phone number ID is the long number in WhatsApp Manager → API setup." });
      if (wabaId !== null && !/^\d{5,30}$/.test(wabaId)) return res.status(400).json({ error: "invalid_waba_id", message: "The WhatsApp Business Account ID is a long number." });
      if (newToken !== null && (newToken.length < 20 || newToken.length > 2048 || /\s/.test(newToken))) return res.status(400).json({ error: "invalid_token" });
      if (template !== null && !/^[a-z0-9_]{1,512}$/.test(template)) return res.status(400).json({ error: "invalid_template", message: "Template names are lowercase letters, digits and underscores." });
      if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) return res.status(400).json({ error: "invalid_language", message: "Use the template's language code, for example en or en_US." });
      if (!followupParameters.includes(parameter)) return res.status(400).json({ error: "invalid_parameter", message: `followup_template_parameter is one of ${followupParameters.join(", ")}.` });

      const existing = await connectionFor(business!.id);
      const accessToken = newToken ?? (existing?.phoneNumberId === phoneNumberId ? existing.accessToken : null);
      if (!accessToken) return res.status(400).json({ error: "token_required", message: "Add the access token for this number." });

      // Meta must accept the number and token before anything is saved.
      const checked = await checkNumber(ctx.whatsapp.graphVersion, phoneNumberId, accessToken);
      if (!checked.ok) {
        return res.status(400).json({ error: "whatsapp_check_failed", message: `WhatsApp didn't accept this number and token: ${checked.title}` });
      }
      const warnings: string[] = [];
      if (wabaId) {
        const subscribed = await subscribeApp(ctx.whatsapp.graphVersion, wabaId, accessToken);
        if (!subscribed.ok) warnings.push(`Couldn't subscribe the platform to the WhatsApp account (${subscribed.title}); messages may not arrive until that's fixed.`);
      }
      try {
        await saveConnection(business!.id, {
          phoneNumberId,
          wabaId,
          displayPhoneNumber: checked.displayPhoneNumber,
          verifiedName: checked.verifiedName,
          followupTemplate: template,
          followupTemplateLanguage: language,
          followupTemplateParameter: parameter,
        }, newToken, user.id);
      } catch (error) {
        const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
        if (database.code === "23505" && database.constraint === "whatsapp_numbers_phone_number_id_key") {
          return res.status(409).json({ error: "number_in_use", message: "This number is already connected to another business." });
        }
        throw error;
      }
      res.json({ ...(await describe(business!.id)), warnings });
    } catch (error) {
      next(error);
    }
  });

  app.delete(base, staff, requireBusinessRole("owner"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const removed = await disconnect(staffOf(req).business!.id);
      res.status(removed ? 200 : 404).json({ disconnected: removed });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/media/:mediaId`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!ctx) return res.status(404).json({ error: "not_found" });
      const businessId = staffOf(req).business!.id;
      const mediaId = req.params.mediaId;
      if (!/^[\w.-]{1,100}$/.test(mediaId)) return res.status(404).json({ error: "not_found" });
      // Only media a customer sent to this business.
      const { rows } = await inBusiness((_db, client) => client.query(
        "select 1 from chat_events where business_id = $1 and media @> $2::jsonb limit 1",
        [businessId, JSON.stringify([{ id: mediaId }])],
      ), businessId);
      if (rows.length === 0) return res.status(404).json({ error: "not_found" });
      const connection = await connectionFor(businessId);
      if (!connection) return res.status(404).json({ error: "not_found" });
      const media = await fetchMedia(ctx.whatsapp.graphVersion, mediaId, connection.accessToken);
      if (!media.ok) return res.status(media.status === 404 ? 404 : 502).json({ error: "media_unavailable", message: `WhatsApp didn't return the file: ${media.title}` });
      const displayable = MEDIA_TYPES.test(media.contentType);
      res.setHeader("Content-Type", displayable ? media.contentType : "application/octet-stream");
      res.setHeader("Content-Disposition", displayable ? "inline" : `attachment; filename="whatsapp-${mediaId}"`);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      if (media.length && /^\d+$/.test(media.length)) res.setHeader("Content-Length", media.length);
      if (!media.body) return res.end();
      Readable.fromWeb(media.body as any).on("error", (error) => {
        console.error("[whatsapp] streaming media failed:", error.message);
        res.destroy(error);
      }).pipe(res);
    } catch (error) {
      next(error);
    }
  });
}
