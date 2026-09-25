// zaina-platform/src/engine/language.ts
//
// Which language the customer writes in, for the fixed texts the server adds
// and for the model's instructions. A message counts as Swahili or English
// only when it clearly is: more words of one than the other, and at least
// two. Short or mixed messages ("asante", "ok", "Sawa, thanks") keep the
// chat's current language.

import type { ChatLanguage } from "../db/schema.ts";
import { words } from "../knowledge/text.ts";

const SWAHILI = new Set([
  "habari", "jambo", "mambo", "sijambo", "shikamoo", "karibu", "asante", "sana", "tafadhali", "samahani", "pole",
  "nataka", "tunataka", "ningependa", "tungependa", "naomba", "tunaomba", "nahitaji", "tunahitaji", "ninahitaji",
  "nina", "tuna", "una", "kuna", "niko", "tuko", "uko", "yuko", "ni", "na", "ya", "wa", "za", "la", "kwa", "katika",
  "je", "gani", "nini", "wapi", "lini", "vipi", "ngapi", "bei", "gharama", "chumba", "vyumba", "nyumba", "usiku",
  "siku", "wiki", "mwezi", "leo", "kesho", "jana", "watoto", "mtoto", "watu", "mtu", "wawili", "watatu", "wanne",
  "gari", "magari", "pwani", "sawa", "ndiyo", "ndio", "hapana", "hii", "hiyo", "huyu", "hapa", "pale", "pia",
  "lakini", "kama", "kuhusu", "kutoka", "mpaka", "hadi", "sasa", "bado", "mimi", "sisi", "wewe", "yeye", "wao",
  "yangu", "yetu", "yako", "wangu", "wetu", "wako", "naweza", "tunaweza", "unaweza", "inawezekana", "kulipa",
  "malipo", "kuweka", "kuhifadhi", "nafasi", "tarehe", "familia", "rafiki", "chakula", "mpishi", "dereva", "safari",
  "ziara", "ufukwe", "bahari", "hoteli", "karibu", "zuri", "nzuri", "vizuri", "salama", "usalama", "haraka",
  "tu", "sio", "si", "hakuna", "kitu", "vitu", "fanya", "kufanya", "kwenda", "kuja", "tutakuja", "nitakuja",
]);

const ENGLISH = new Set([
  "the", "is", "are", "was", "and", "you", "your", "i", "we", "our", "to", "for", "of", "a", "an", "in", "on", "with",
  "my", "can", "could", "would", "do", "does", "what", "how", "when", "where", "which", "please", "thanks", "thank",
  "hello", "hi", "want", "need", "like", "book", "booking", "room", "stay", "night", "nights", "people", "kids",
  "children", "car", "price", "cost", "much", "available", "there", "this", "that", "it", "have", "has", "be", "will",
  "from", "at", "about", "any", "some", "get", "going", "coming", "looking", "help", "also", "but", "or", "if", "so",
]);

/** The language a message is clearly written in, or null when it isn't clear. */
export function detectLanguage(text: string): ChatLanguage | null {
  const tokens = words(text);
  let swahili = 0;
  let english = 0;
  for (const token of tokens) {
    if (SWAHILI.has(token)) swahili += 1;
    else if (ENGLISH.has(token)) english += 1;
  }
  if (swahili >= 2 && swahili > english) return "sw";
  if (english >= 2 && english > swahili) return "en";
  return null;
}

/** The chat's language after this message. */
export function languageAfter(message: string, current: ChatLanguage): ChatLanguage {
  return detectLanguage(message) ?? current;
}
