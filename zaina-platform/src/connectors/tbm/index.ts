// zaina-platform/src/connectors/tbm/index.ts
//
// Tembea Bila Matata as a business on the platform: TBM's instructions, its
// tools over TBM's own data, its team alerts and its chat M-Pesa recording.

import type { FunctionDeclaration } from "@google/genai";
import { TBM_OFFICIAL_PHONE_DISPLAY } from "../../engine/reply-policy.ts";
import type { BusinessConnector, ToolContext } from "../types.ts";
import { tbmToolDeclarations } from "./declarations.ts";
import { notifyTbmTeam } from "./notify.ts";
import { recordTbmChatPayment } from "./payments.ts";
import { buildTbmSystemPrompt } from "./prompt.ts";
import {
  calculateChefPrice,
  calculateMamaCarePrice,
  checkServiceAvailability,
  checkStayAvailability,
  composeTripPackage,
  createCustomOffer,
  createDraftBooking,
  createLead,
  createListingVerificationRequest,
  createServiceBooking,
  searchCars,
  searchCooks,
  searchErrands,
  searchExperiences,
  searchStays,
} from "./tools.ts";

const handlers: Record<string, (args: any, sessionId: string) => Promise<any>> = {
  search_stays: searchStays,
  search_cooks: searchCooks,
  search_cars: searchCars,
  search_errands: searchErrands,
  search_experiences: searchExperiences,
  check_stay_availability: checkStayAvailability,
  check_service_availability: checkServiceAvailability,
  calculate_chef_price: calculateChefPrice,
  calculate_mamacare_price: calculateMamaCarePrice,
  compose_trip_package: composeTripPackage,
  create_draft_booking: createDraftBooking,
  create_service_booking: createServiceBooking,
  create_custom_offer: createCustomOffer,
  create_listing_verification_request: createListingVerificationRequest,
  create_lead: createLead,
};

export const tbmConnector: BusinessConnector = {
  systemPrompt: () => buildTbmSystemPrompt(),
  toolDeclarations: (): FunctionDeclaration[] => tbmToolDeclarations.flatMap((group) => group.functionDeclarations),
  readOnlyTools: new Set([
    "search_stays",
    "search_cooks",
    "search_cars",
    "search_errands",
    "search_experiences",
    "check_stay_availability",
    "check_service_availability",
    "calculate_chef_price",
    "calculate_mamacare_price",
  ]),
  async executeTool(name: string, args: unknown, context: ToolContext) {
    const handler = handlers[name];
    if (!handler) return { ok: false, error: `unknown_tool:${name}` };
    return await handler(args ?? {}, context.sessionId);
  },
  notifyTeam: notifyTbmTeam,
  recordChatPayment: (_business, input) => recordTbmChatPayment(input),
  contactLine: (_business, language) => (language === "sw" ? `WhatsApp au piga simu ${TBM_OFFICIAL_PHONE_DISPLAY}` : `WhatsApp or call ${TBM_OFFICIAL_PHONE_DISPLAY}`),
};
