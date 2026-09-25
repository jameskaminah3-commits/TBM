// zaina-platform/src/knowledge/routes.ts
//
// A business's knowledge, for its staff (least role needed):
//
//   GET    /v1/staff/businesses/:businessId/knowledge              viewer   the sources
//   GET    …/knowledge/:sourceId                                   viewer   one source, with its text
//   POST   …/knowledge/search { query }                            viewer   what Zaina would find
//   GET    …/knowledge/misses?days=30                              agent    questions nothing answered
//   POST   …/knowledge { title, kind?, url?, language?, content | faqs, status? }   manager   add, or replace by title
//   PUT    …/knowledge/:sourceId { … }                             manager  change
//   DELETE …/knowledge/:sourceId                                   manager  remove
//
// A save answers with how many passages it made and how many amounts it
// hides from Zaina (prices belong in the booking system, not in documents).

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { faqToMarkdown } from "./import.ts";
import { searchKnowledge } from "./search.ts";
import {
  deleteKnowledgeSource,
  getKnowledgeSource,
  listKnowledgeMisses,
  listKnowledgeSources,
  saveKnowledgeSource,
  validateKnowledgeInput,
  type SaveResult,
} from "./store.ts";

/** Knowledge routes take bigger bodies than the rest of the API. */
export const KNOWLEDGE_PATH = /^\/v1\/staff\/businesses\/[^/]+\/knowledge(?:\/|$)/;
const knowledgeBody = express.json({ limit: "400kb" });

function inputFrom(body: Record<string, unknown>): Record<string, unknown> {
  if (body.faqs !== undefined) {
    const content = faqToMarkdown(body.faqs);
    return { kind: "faq", ...body, content: content ?? "" };
  }
  return body;
}

function saved(result: SaveResult) {
  const { source } = result;
  return {
    source: { id: source.id, title: source.title, kind: source.kind, url: source.url, language: source.language, status: source.status, updated_at: source.updatedAt },
    passages: result.passages,
    hidden_amounts: result.hiddenAmounts,
    unchanged: result.unchanged,
  };
}

const isTitleTaken = (error: unknown) => {
  const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
  return database.code === "23505" && database.constraint === "knowledge_sources_business_id_title_key";
};

export function registerKnowledgeRoutes(app: Express, secret: string): void {
  const staff = requireStaff(secret);
  const base = "/v1/staff/businesses/:businessId/knowledge";

  app.get(base, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ sources: await listKnowledgeSources(staffOf(req).business!.id) });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/misses`, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30) || 30));
      res.json({ days, misses: await listKnowledgeMisses(staffOf(req).business!.id, days) });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/search`, knowledgeBody, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
      if (!query) return res.status(400).json({ error: "query_required" });
      res.json({ passages: await searchKnowledge(staffOf(req).business!.id, query.slice(0, 200)) });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/:sourceId`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const source = await getKnowledgeSource(staffOf(req).business!.id, req.params.sourceId);
      if (!source) return res.status(404).json({ error: "not_found" });
      res.json({ source });
    } catch (error) {
      next(error);
    }
  });

  app.post(base, knowledgeBody, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const checked = validateKnowledgeInput(inputFrom(req.body ?? {}));
      if (!checked.ok) return res.status(400).json({ error: "invalid_source", message: checked.error });
      const { business, user } = staffOf(req);
      const result = await saveKnowledgeSource(business!.id, checked.value, user.id);
      res.json(saved(result!));
    } catch (error) {
      next(error);
    }
  });

  app.put(`${base}/:sourceId`, knowledgeBody, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const checked = validateKnowledgeInput(inputFrom(req.body ?? {}));
      if (!checked.ok) return res.status(400).json({ error: "invalid_source", message: checked.error });
      const { business, user } = staffOf(req);
      if (!/^[0-9a-f-]{36}$/i.test(req.params.sourceId)) return res.status(404).json({ error: "not_found" });
      const result = await saveKnowledgeSource(business!.id, checked.value, user.id, req.params.sourceId);
      if (!result) return res.status(404).json({ error: "not_found" });
      res.json(saved(result));
    } catch (error) {
      if (isTitleTaken(error)) return res.status(409).json({ error: "title_taken", message: "Another source already has this title." });
      next(error);
    }
  });

  app.delete(`${base}/:sourceId`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await deleteKnowledgeSource(staffOf(req).business!.id, req.params.sourceId);
      res.status(deleted ? 200 : 404).json({ deleted });
    } catch (error) {
      next(error);
    }
  });
}
