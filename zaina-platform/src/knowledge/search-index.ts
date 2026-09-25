// zaina-platform/src/knowledge/search-index.ts
//
// Ranked search over one business's passages (BM25). A passage's section
// counts more than its body; its source's title adds a little to passages
// that already match, since every passage of a source shares it. A
// question's words match the same word, then a word sharing its first five
// letters ("verify" and "verification"), then related words and Swahili
// meanings, each counting a little less. The best passages are returned only
// when they match well enough: an unanswerable question must find nothing,
// not something.

import { prefixOf, relatedTerms, terms } from "./text.ts";

export type IndexedPassage = {
  id: number;
  sourceId: string;
  title: string;
  url: string | null;
  kind: string;
  heading: string | null;
  content: string;
};

export type SearchHit = IndexedPassage & { score: number; relevance: number };

const K1 = 1.2;
const B = 0.75;
const FIELD_WEIGHTS = { heading: 2, content: 1 };
const TITLE_BONUS = 0.5;
const PREFIX_WEIGHT = 0.5;
const RELATED_WEIGHT = 0.6;
const TRANSLATION_WEIGHT = 0.85;
/** How well a passage must match, relative to a perfect match of the question. */
export const MIN_RELEVANCE = 0.3;
/** Passages well below the best one are left out. */
const RELATIVE_TO_BEST = 0.5;

type Postings = Map<string, Map<number, number>>;

export class KnowledgeIndex {
  private readonly passages: IndexedPassage[];
  private readonly exact: Postings = new Map();
  private readonly prefixes: Postings = new Map();
  private readonly titleTerms: Array<Set<string>> = [];
  private readonly lengths: number[] = [];
  private readonly averageLength: number;

  constructor(passages: IndexedPassage[]) {
    this.passages = passages;
    passages.forEach((passage, index) => {
      this.titleTerms.push(new Set(terms(passage.title)));
      const weighted = new Map<string, number>();
      const add = (text: string | null, weight: number) => {
        for (const term of terms(text ?? "")) weighted.set(term, (weighted.get(term) ?? 0) + weight);
      };
      add(passage.heading, FIELD_WEIGHTS.heading);
      add(passage.content, FIELD_WEIGHTS.content);
      let length = 0;
      for (const [term, frequency] of weighted) {
        length += frequency;
        this.post(this.exact, term, index, frequency);
        const prefix = prefixOf(term);
        if (prefix) this.post(this.prefixes, prefix, index, frequency);
      }
      this.lengths.push(length);
    });
    this.averageLength = this.lengths.length ? this.lengths.reduce((sum, length) => sum + length, 0) / this.lengths.length : 1;
  }

  get size(): number {
    return this.passages.length;
  }

  private post(postings: Postings, term: string, index: number, frequency: number) {
    const list = postings.get(term) ?? new Map<number, number>();
    list.set(index, (list.get(index) ?? 0) + frequency);
    postings.set(term, list);
  }

  private idf(documentFrequency: number): number {
    const count = this.passages.length;
    return Math.log(1 + (count - documentFrequency + 0.5) / (documentFrequency + 0.5));
  }

  /** BM25 contribution of one posting list to each passage. */
  private scores(list: Map<number, number> | undefined): Map<number, number> {
    const result = new Map<number, number>();
    if (!list) return result;
    const idf = this.idf(list.size);
    for (const [index, frequency] of list) {
      const norm = frequency + K1 * (1 - B + (B * this.lengths[index]) / this.averageLength);
      result.set(index, (idf * frequency * (K1 + 1)) / norm);
    }
    return result;
  }

  search(question: string, limit = 3): SearchHit[] {
    const questionTerms = [...new Set(terms(question))];
    if (questionTerms.length === 0 || this.passages.length === 0) return [];
    const totals = new Map<number, number>();
    // The best a passage could score: every question word found once, exactly.
    let perfect = 0;

    for (const term of questionTerms) {
      const best = new Map<number, number>();
      const consider = (scores: Map<number, number>, weight: number) => {
        for (const [index, score] of scores) best.set(index, Math.max(best.get(index) ?? 0, score * weight));
      };
      const exact = this.exact.get(term);
      consider(this.scores(exact), 1);
      const prefix = prefixOf(term);
      if (prefix) consider(this.scores(this.prefixes.get(prefix)), PREFIX_WEIGHT);
      const { related, translations } = relatedTerms(term);
      for (const other of related) consider(this.scores(this.exact.get(other)), RELATED_WEIGHT);
      for (const meaning of translations) consider(this.scores(this.exact.get(meaning)), TRANSLATION_WEIGHT);
      for (const [index, score] of best) totals.set(index, (totals.get(index) ?? 0) + score);

      // A word no passage uses (or only as a related word) still counts
      // against a perfect match, at the rarest word's weight.
      const documentFrequency = exact?.size ?? 0;
      perfect += this.idf(documentFrequency > 0 ? documentFrequency : 1) * (K1 + 1) / (1 + K1);
    }

    // The source's title helps passages that already match something.
    for (const [index, total] of totals) {
      let bonus = 0;
      for (const term of questionTerms) {
        if (this.titleTerms[index].has(term)) bonus += TITLE_BONUS * this.idf(this.exact.get(term)?.size || 1);
      }
      if (bonus) totals.set(index, total + bonus);
    }

    const ranked = [...totals.entries()]
      .map(([index, score]) => ({ index, score, relevance: perfect > 0 ? score / perfect : 0 }))
      .filter((hit) => hit.relevance >= MIN_RELEVANCE)
      .sort((a, b) => b.score - a.score);
    if (ranked.length === 0) return [];
    const bestScore = ranked[0].score;
    return ranked
      .filter((hit) => hit.score >= bestScore * RELATIVE_TO_BEST)
      .slice(0, limit)
      .map((hit) => ({ ...this.passages[hit.index], score: Math.round(hit.score * 100) / 100, relevance: Math.round(hit.relevance * 100) / 100 }));
  }
}
