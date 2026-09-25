// zaina-platform/src/knowledge/text.ts
//
// How text becomes search terms, for passages and questions alike: lower
// case, accents and punctuation dropped, common words left out, and a light
// stemmer so "beaches" finds "beach" and "cancelled" finds "cancellation".
// Questions also match through a short list of related words, including
// everyday Swahili ("watoto" finds "children"), so a customer's own words
// reach the business's passages.

const ENGLISH_STOP_WORDS = [
  "a", "about", "above", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be",
  "because", "been", "before", "being", "below", "between", "both", "but", "by", "can", "could", "did", "do",
  "does", "doing", "down", "during", "each", "else", "few", "for", "from", "further", "get", "got", "had", "has",
  "have", "having", "he", "her", "here", "hers", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its",
  "just", "know", "like", "me", "might", "more", "most", "much", "must", "my", "no", "nor", "not", "now", "of",
  "off", "ok", "okay", "on", "once", "only", "or", "other", "our", "ours", "out", "over", "own", "please", "same",
  "she", "should", "so", "some", "such", "tell", "than", "thank", "thanks", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "us", "very", "want",
  "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "will", "with", "would",
  "you", "your", "yours", "hi", "hello", "hey", "dear", "anything", "something", "thing", "things", "way", "need",
  // Everyday verbs say little about what a question is about.
  "bring", "brings", "take", "takes", "make", "makes", "give", "go", "goes", "come", "comes", "see", "let", "find",
  "use", "say", "ask", "look", "try", "put", "keep", "anyone", "someone", "possible",
];

const SWAHILI_STOP_WORDS = [
  "na", "ya", "wa", "za", "la", "cha", "vya", "kwa", "ni", "si", "je", "hii", "huu", "hizi", "hiyo", "huo", "ile",
  "yule", "hapa", "pale", "kama", "lakini", "au", "pia", "sana", "tu", "nini", "gani", "vipi", "wapi", "lini",
  "mimi", "wewe", "yeye", "sisi", "nyinyi", "wao", "katika", "kwenye", "ndani", "habari", "jambo", "mambo",
  "tafadhali", "asante", "sawa", "naomba", "nataka", "ningependa", "tunataka", "kuna", "iko", "yupo", "nina",
  "una", "ana", "tuna", "mna", "wana", "hakuna", "ndiyo", "hapana", "karibu",
];

const STOP_WORDS = new Set([...ENGLISH_STOP_WORDS, ...SWAHILI_STOP_WORDS]);

/** Lower-case words without accents or punctuation. "M-Pesa", "wi-fi" and "check-in" stay one word. */
export function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b([a-z]{1,2})-([a-z]{2,})\b/g, "$1$2")
    .replace(/\bcheck-(in|out)\b/g, "check$1")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

const DOUBLED = /([bdglmnprt])\1$/;

/** Porter's measure: how many vowel-consonant runs a stem has ("div" 1, "open" 2). */
function measure(stemmed: string): number {
  const pattern = [...stemmed]
    .map((letter, index) => (/[aeiou]/.test(letter) || (letter === "y" && index > 0 && !/[aeiou]/.test(stemmed[index - 1])) ? "v" : "c"))
    .join("")
    .replace(/(.)\1+/g, "$1");
  return (pattern.match(/vc/g) ?? []).length;
}

/** Drops one of a doubled final consonant, or restores a silent "e" ("div" → "dive"). */
function tidyStem(stemmed: string): string {
  if (DOUBLED.test(stemmed)) return stemmed.slice(0, -1);
  if (measure(stemmed) === 1 && /[^aeiou][aeiou][^aeiouwxy]$/.test(stemmed)) return `${stemmed}e`;
  return stemmed;
}

/** A light English stemmer: plurals, -ing, -ed and -ation. Conservative on purpose. */
export function stem(word: string): string {
  if (word.length <= 3 || /^\d+$/.test(word)) return word;
  let result = word;
  if (result.endsWith("ies") && result.length > 4) result = `${result.slice(0, -3)}y`;
  else if (/(ches|shes|sses|xes|zes)$/.test(result)) result = result.slice(0, -2);
  else if (result.endsWith("s") && !/(ss|us|is)$/.test(result)) result = result.slice(0, -1);

  if (result.endsWith("ing") && result.length > 5) result = tidyStem(result.slice(0, -3));
  else if (result.endsWith("ed") && result.length > 4) result = tidyStem(result.slice(0, -2));
  if (result.endsWith("ation") && result.length >= 10) result = tidyStem(result.slice(0, -5));
  return result;
}

/** Search terms of a text: stemmed words, common words left out. */
export function terms(text: string): string[] {
  return words(text)
    .filter((word) => !STOP_WORDS.has(word) && (word.length > 1 || /\d/.test(word)))
    .map(stem);
}

/** The first five letters of a term, so "verify" and "verification" meet. */
export function prefixOf(term: string): string | null {
  return term.length >= 5 && !/^\d+$/.test(term) ? term.slice(0, 5) : null;
}

// Words a customer may use for what a business writes differently. Each
// group matches in both directions. Swahili words point to their English
// meaning (businesses mostly write in English).
const RELATED_GROUPS: string[][] = [
  ["kid", "child", "children", "toddler", "baby", "infant", "family"],
  ["childcare", "nanny", "babysitter", "babysitting", "mamacare"],
  ["safe", "safety", "secure", "security", "crime", "danger"],
  ["cancel", "cancellation", "refund"],
  ["pay", "payment", "deposit", "card", "mpesa"],
  ["airport", "flight", "fly", "mba"],
  ["sgr", "train", "railway", "madaraka"],
  ["weather", "rain", "rainy", "season", "climate", "monsoon"],
  ["car", "vehicle", "driver", "chauffeur", "transport", "taxi", "transfer", "pickup"],
  ["chef", "cook", "dining", "meal", "food", "dinner", "restaurant"],
  ["verify", "verification", "legit", "scam", "genuine", "fake", "fraud", "inspect"],
  ["wifi", "internet", "connectivity", "network", "data"],
  ["swim", "snorkel", "dive", "diving", "marine", "reef"],
  ["nightlife", "party", "club", "bar"],
  ["romantic", "honeymoon", "couple", "anniversary"],
  ["quiet", "peaceful", "calm", "relax"],
  ["stay", "accommodation", "villa", "apartment", "room", "house", "lodging", "hotel"],
  ["grocery", "groceries", "shopping", "errand"],
  ["laundry", "washing", "clothes"],
  ["cleaning", "cleaner", "housekeeping"],
  ["tour", "trip", "excursion", "experience", "activity", "safari"],
  ["checkin", "arrival", "arrive"],
  ["checkout", "departure"],
  ["tip", "tipping", "gratuity"],
  ["visa", "eta", "entry", "passport"],
  ["health", "malaria", "vaccine", "vaccination", "medical", "hospital", "doctor"],
  ["language", "swahili", "english"],
  ["open", "hours", "opening", "closing"],
  ["price", "cost", "rate", "fee", "charge", "expensive", "cheap", "budget"],
  ["book", "booking", "reserve", "reservation"],
  ["pet", "dog", "cat"],
  ["breakfast", "lunch", "meal"],
  ["far", "distance", "journey", "minutes", "km"],
  ["max", "maximum", "limit", "capacity", "sleeps"],
  ["min", "minimum"],
];

const SWAHILI_MEANINGS: Record<string, string[]> = {
  watoto: ["children"], mtoto: ["child"], mchanga: ["infant"],
  usalama: ["safety"], salama: ["safe"],
  ndege: ["airport", "flight"], uwanja: ["airport"],
  treni: ["train", "sgr"], reli: ["railway", "sgr"],
  gari: ["car", "transport"], magari: ["car"], dereva: ["driver", "chauffeur"], teksi: ["taxi"],
  chakula: ["food", "meal"], mpishi: ["chef", "cook"], mgahawa: ["restaurant"],
  pwani: ["beach", "coast"], ufukwe: ["beach"], bahari: ["sea", "beach"],
  chumba: ["room"], vyumba: ["room"], nyumba: ["house"], malazi: ["accommodation", "stay"], hoteli: ["hotel"],
  kulipa: ["pay"], malipo: ["payment"], lipa: ["pay"], pesa: ["money"], kadi: ["card"], amana: ["deposit"],
  kughairi: ["cancel"], ghairi: ["cancel"], kurejeshewa: ["refund"],
  hewa: ["weather"], mvua: ["rain"], msimu: ["season"], jua: ["sun", "weather"],
  ziara: ["tour"], safari: ["safari", "trip"], matembezi: ["tour", "walk"],
  ununuzi: ["shopping"], nguo: ["laundry", "clothes"], usafi: ["cleaning"], kufua: ["laundry"],
  kuthibitisha: ["verify"], uthibitisho: ["verification"], halali: ["legit"], utapeli: ["scam"],
  mtandao: ["internet"], intaneti: ["internet"], lugha: ["language"],
  bei: ["price"], gharama: ["cost", "price"], ghali: ["expensive"], nafuu: ["cheap", "budget"],
  kuhifadhi: ["book", "reserve"], kuweka: ["book"], nafasi: ["availability", "space"],
  usiku: ["night"], siku: ["day"], wiki: ["week"], mwezi: ["month"],
  daktari: ["doctor"], hospitali: ["hospital"], dawa: ["medicine"], afya: ["health"],
  kuogelea: ["swim"], mbizi: ["dive"], samaki: ["fish"],
  familia: ["family"], wazee: ["elderly"], mzee: ["elderly"],
  mbwa: ["dog"], paka: ["cat"], mnyama: ["pet"], wanyama: ["pet"], kuvuta: ["smoke"], sigara: ["smoke"],
  kiamsha: ["breakfast"], kifungua: ["breakfast"], bwawa: ["pool"], maegesho: ["parking"], mahali: ["location"],
  wikendi: ["weekend"], likizo: ["holiday"], fungate: ["honeymoon"],
};

const related = new Map<string, Set<string>>();
for (const group of RELATED_GROUPS) {
  const stems = group.flatMap((word) => terms(word));
  for (const term of stems) {
    const set = related.get(term) ?? new Set<string>();
    for (const other of stems) if (other !== term) set.add(other);
    related.set(term, set);
  }
}
const swahili = new Map<string, string[]>(
  Object.entries(SWAHILI_MEANINGS).map(([word, meanings]) => [stem(word), meanings.flatMap((meaning) => terms(meaning))]),
);

/** Words related to a question's term, and a Swahili word's English meaning. */
export function relatedTerms(term: string): { related: string[]; translations: string[] } {
  return {
    related: [...(related.get(term) ?? [])],
    translations: swahili.get(term) ?? [],
  };
}
