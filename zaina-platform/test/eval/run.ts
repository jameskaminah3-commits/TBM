// zaina-platform/test/eval/run.ts
//
// Runs the evaluation suite (cases.ts).
//
//   npm run eval -- --offline        knowledge search for every question with a known answer:
//                                    no model and no database needed
//   GEMINI_API_KEY=… npm run eval    the real model, end to end, graded (grade.ts)
//   npm run eval -- --scripted       the harness itself, with the scripted model
//                                    (checks the plumbing; its grades mean nothing)
//
// Options: --only <id prefix>, --concurrency <n> (default 4), --model <name>,
// --report <file> (default zaina-platform/eval-report.json), --min <pass rate> (default 0.9).
// A live run needs PLATFORM_TEST_DATABASE_URL and TBM_TEST_DATABASE_URL, local
// and ending in _test, as for test:e2e; both are overwritten.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { chunkDocument } from "../../src/knowledge/chunk.ts";
import { parseMarkdownSource } from "../../src/knowledge/import.ts";
import { KnowledgeIndex, type IndexedPassage } from "../../src/knowledge/search-index.ts";
import { CASES, type Category, type EvalCase } from "./cases.ts";
import { grade, type ToolCall, type Verdict } from "./grade.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const PLATFORM_ROOT = path.resolve(HERE, "../..");

const { values: options } = parseArgs({
  options: {
    offline: { type: "boolean", default: false },
    scripted: { type: "boolean", default: false },
    only: { type: "string" },
    concurrency: { type: "string", default: "4" },
    model: { type: "string" },
    report: { type: "string", default: "zaina-platform/eval-report.json" },
    min: { type: "string", default: "0.9" },
  },
});

const cases = CASES.filter((testCase) => !options.only || testCase.id.startsWith(options.only));

/** "{date:+15}" → "Friday 9 October": Kenya dates from today, so the suite never goes stale. */
function fillDates(text: string, now = new Date()): string {
  return text.replace(/\{date:\+(\d+)\}/g, (_whole, days: string) =>
    new Date(now.getTime() + Number(days) * 86_400_000).toLocaleDateString("en-GB", { timeZone: "Africa/Nairobi", weekday: "long", day: "numeric", month: "long" }));
}

function knowledgeIndex(dir: string): KnowledgeIndex {
  const passages: IndexedPassage[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".md")).sort()) {
    const source = parseMarkdownSource(readFileSync(path.join(dir, file), "utf8"), file);
    chunkDocument(source.content, { title: source.title }).forEach((passage) => passages.push({
      id: passages.length,
      sourceId: file,
      title: source.title,
      url: typeof source.url === "string" ? source.url : null,
      kind: String(source.kind ?? "page"),
      heading: passage.heading,
      content: passage.content,
    }));
  }
  return new KnowledgeIndex(passages);
}

// ── Offline: knowledge search ─────────────────────────────────────────
// Answerable questions must find their source in the top 3. For questions
// nothing answers, finding no passage is best, but a passage that doesn't
// answer is fine: Zaina must still say it doesn't know (graded live).
function runOffline(): number {
  const indexes = {
    tbm: knowledgeIndex(path.join(PLATFORM_ROOT, "knowledge/tbm")),
    acme: knowledgeIndex(path.join(HERE, "fixtures/acme")),
  };
  const answerable = cases.filter((testCase) => typeof testCase.source === "string");
  const unanswerable = cases.filter((testCase) => testCase.source === null);
  const misses: string[] = [];
  for (const testCase of answerable) {
    const question = fillDates(testCase.turns[0]);
    const hits = indexes[testCase.business].search(question);
    if (!hits.some((hit) => hit.title === testCase.source)) {
      misses.push(`${testCase.id}: "${question}" → ${hits.length ? hits.map((hit) => `${hit.title} (${hit.relevance})`).join(", ") : "nothing"}; expected ${testCase.source}`);
    }
  }
  const quiet = unanswerable.filter((testCase) => indexes[testCase.business].search(fillDates(testCase.turns[0])).length === 0).length;
  const found = answerable.length - misses.length;
  const recall = answerable.length ? found / answerable.length : 1;
  console.log(`Knowledge search: ${found}/${answerable.length} answerable questions find their source in the top 3 (${Math.round(100 * recall)}%).`);
  for (const miss of misses) console.log(`  ✗ ${miss}`);
  console.log(`Questions nothing answers: ${quiet}/${unanswerable.length} find no passage; the rest get passages that don't answer them.`);
  return recall >= Number(options.min) ? 0 : 1;
}

// ── Live or scripted: the whole service ──────────────────────────────
const PLATFORM_DB = process.env.PLATFORM_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/zaina_platform_test";
const TBM_DB = process.env.TBM_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tbm_test";
const PORT = 5076;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGINS = { tbm: "https://tembeabilamatata.com", acme: "https://acme.example" };
const OFFICIAL_PHONES = { tbm: ["+254718475264"], acme: ["+254700111222"] };
const ALLOWED_HOSTS = { tbm: ["tembeabilamatata.com", "wa.me", "whatsapp.com"], acme: ["acme.example", "wa.me", "whatsapp.com"] };
// Local test accounts only.
const PASSWORD = "LocalEval#2026";

async function json(method: string, route: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
}

async function signIn(email: string): Promise<string> {
  const response = await json("POST", "/v1/staff/login", { email, password: PASSWORD });
  if (response.status !== 200) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(response.body)}`);
  return response.body.token;
}

async function startService(scripted: boolean): Promise<ChildProcess> {
  for (const url of [PLATFORM_DB, TBM_DB]) {
    const parsed = new URL(url);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test")) {
      throw new Error(`Refusing to run against ${parsed.hostname}${parsed.pathname}: evaluation databases must be local and end in _test`);
    }
  }
  const platform = new pg.Client({ connectionString: PLATFORM_DB });
  await platform.connect();
  await platform.query("set client_min_messages = warning; drop schema public cascade; create schema public;");
  await platform.end();
  const tbm = new pg.Client({ connectionString: TBM_DB });
  await tbm.connect();
  await tbm.query(readFileSync(path.join(PLATFORM_ROOT, "test/e2e/tbm-seed.sql"), "utf8"));
  await tbm.query(readFileSync(path.join(HERE, "tbm-eval-seed.sql"), "utf8"));
  await tbm.end();

  const server = spawn(process.execPath, [
    ...(scripted ? ["--import", path.join(PLATFORM_ROOT, "test/e2e/scripted-model.mjs")] : []),
    "--import", "tsx", "zaina-platform/src/server.ts",
  ], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      PLATFORM_DATABASE_URL: PLATFORM_DB,
      TBM_DATABASE_URL: TBM_DB,
      SESSION_TOKEN_SECRET: "eval-session-secret-long-enough-1234567890",
      PLATFORM_SECRETS_KEY: Buffer.alloc(32, 9).toString("base64"),
      GEMINI_API_KEY: scripted ? "scripted" : process.env.GEMINI_API_KEY,
      ...(options.model ? { ZAINA_MODEL: options.model } : {}),
      MIGRATE_ON_START: "true",
      APP_BASE_URL: "https://tembeabilamatata.com",
      LIMIT_VISITOR_SESSIONS_PER_HOUR: "10000",
      LIMIT_VISITOR_MESSAGES_PER_10_MINUTES: "10000",
      LIMIT_SESSION_MESSAGES_PER_MINUTE: "100",
      LIMIT_BUSINESS_MESSAGES_PER_HOUR: "100000",
      ...(scripted ? { FAKE_USD_TO_KES: "129.24" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout?.on("data", (chunk) => { output += chunk; });
  server.stderr?.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/v1/health`)).ok) return server;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  server.kill("SIGTERM");
  throw new Error(`The service didn't start:\n${output}`);
}

/** TBM's knowledge, and Acme Guesthouse as a second business with its own. */
async function setUpBusinesses(): Promise<Record<"tbm" | "acme", string>> {
  const run = (args: string[], env: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", ...args], { cwd: REPO, env: { ...process.env, PLATFORM_DATABASE_URL: PLATFORM_DB, ...env }, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr + result.stdout);
  };
  run(["zaina-platform/src/cli/create-staff.ts", "--email", "eval-ops@example.com", "--name", "Eval", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  run(["zaina-platform/src/cli/import-knowledge.ts", "--business", "tbm", "--dir", "zaina-platform/knowledge/tbm"]);
  const ops = await signIn("eval-ops@example.com");
  const created = await json("POST", "/v1/platform/businesses", {
    id: "acme", name: "Acme Guesthouse", allowed_origins: [ORIGINS.acme],
    owner: { email: "eval-owner@example.com", name: "Otieno", password: PASSWORD },
  }, ops);
  if (created.status !== 201) throw new Error(`creating Acme failed: ${JSON.stringify(created.body)}`);
  const owner = await signIn("eval-owner@example.com");
  await json("PATCH", "/v1/staff/businesses/acme/settings", {
    about: "Acme Guesthouse: a family-run guesthouse with six rooms in Watamu, breakfast included.",
    contactPhone: "+254700111222", contactPhoneDisplay: "+254 700 111 222", websiteUrl: "https://acme.example",
  }, owner);
  const dir = path.join(HERE, "fixtures/acme");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
    const saved = await json("POST", "/v1/staff/businesses/acme/knowledge", parseMarkdownSource(readFileSync(path.join(dir, file), "utf8"), file), owner);
    if (saved.status !== 200) throw new Error(`importing ${file} failed: ${JSON.stringify(saved.body)}`);
  }
  const tbmKey = "pk_tbm_live";
  return { tbm: tbmKey, acme: created.body.business.public_key };
}

type Outcome = { testCase: EvalCase; replies: string[]; errors: string[]; verdict: Verdict; tokens: { input: number; output: number; cached: number; calls: number; turns: number } };

async function runCase(testCase: EvalCase, keys: Record<"tbm" | "acme", string>, database: pg.Pool, visitor: number): Promise<Outcome> {
  const origin = ORIGINS[testCase.business];
  const headers = { origin, "x-forwarded-for": `10.200.${Math.floor(visitor / 250)}.${visitor % 250}` };
  const opened = await json("POST", "/v1/sessions", { business_key: keys[testCase.business], display_currency: testCase.currency ?? "KES" }, undefined, headers);
  const turns = testCase.turns.map((turn) => fillDates(turn));
  const replies: string[] = [];
  const errors: string[] = [];
  if (opened.status !== 201) errors.push(`opening the chat: ${opened.status}`);
  for (const message of opened.status === 201 ? turns : []) {
    const response = await json("POST", "/v1/chat", { message }, opened.body.token, headers);
    if (response.status !== 200) errors.push(`"${message}": HTTP ${response.status} ${JSON.stringify(response.body)}`);
    replies.push(typeof response.body?.reply === "string" ? response.body.reply : "");
  }

  const sessionId = opened.body.session_id;
  const events = sessionId
    ? (await database.query("select actor, tool_name, tool_arguments, tool_response from chat_events where session_id = $1 order by id", [sessionId])).rows
    : [];
  const lastUser = events.map((event) => event.actor).lastIndexOf("USER");
  const toTool = (event: any): ToolCall => ({ name: event.tool_name, args: event.tool_arguments, response: event.tool_response });
  const tools = events.filter((event) => event.actor === "SYSTEM_TOOL").map(toTool);
  const lastTurnTools = events.slice(lastUser + 1).filter((event) => event.actor === "SYSTEM_TOOL").map(toTool);
  const leads = sessionId ? (await database.query("select phone from leads where session_id = $1", [sessionId])).rows : [];
  const metrics = sessionId
    ? (await database.query(
      "select coalesce(sum(input_tokens), 0)::int as input, coalesce(sum(output_tokens), 0)::int as output, coalesce(sum(cached_tokens), 0)::int as cached, coalesce(sum(model_calls), 0)::int as calls, count(*)::int as turns from turn_metrics where session_id = $1",
      [sessionId],
    )).rows[0]
    : { input: 0, output: 0, cached: 0, calls: 0, turns: 0 };

  const verdict = grade(testCase, {
    replies,
    customerTexts: turns,
    tools,
    lastTurnTools,
    leadPhones: leads.map((lead) => String(lead.phone ?? "")),
    officialPhones: OFFICIAL_PHONES[testCase.business],
    allowedHosts: ALLOWED_HOSTS[testCase.business],
  });
  if (errors.length) {
    verdict.pass = false;
    verdict.failures.unshift(...errors);
  }
  return { testCase, replies, errors, verdict, tokens: metrics };
}

async function runService(scripted: boolean): Promise<number> {
  if (!scripted && !process.env.GEMINI_API_KEY) {
    console.error("A live evaluation needs GEMINI_API_KEY (the real model). Use --offline for knowledge search only, or --scripted to check the harness.");
    return 2;
  }
  const server = await startService(scripted);
  const database = new pg.Pool({ connectionString: PLATFORM_DB, max: 4 });
  try {
    const keys = await setUpBusinesses();
    const outcomes: Outcome[] = [];
    const queue = [...cases.entries()];
    const workers = Array.from({ length: Math.max(1, Number(options.concurrency) || 4) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [index, testCase] = next;
        const outcome = await runCase(testCase, keys, database, index + 1);
        outcomes.push(outcome);
        process.stdout.write(outcome.verdict.pass ? "." : outcome.verdict.critical ? "!" : "x");
      }
    });
    await Promise.all(workers);
    process.stdout.write("\n");
    outcomes.sort((a, b) => cases.indexOf(a.testCase) - cases.indexOf(b.testCase));
    return report(outcomes, scripted);
  } finally {
    await database.end();
    server.kill("SIGTERM");
  }
}

function report(outcomes: Outcome[], scripted: boolean): number {
  const passed = outcomes.filter((outcome) => outcome.verdict.pass).length;
  const critical = outcomes.filter((outcome) => outcome.verdict.critical);
  const criticalPassed = critical.filter((outcome) => outcome.verdict.pass).length;
  const byCategory: Partial<Record<Category, { cases: number; passed: number }>> = {};
  for (const outcome of outcomes) {
    const entry = (byCategory[outcome.testCase.category] ??= { cases: 0, passed: 0 });
    entry.cases += 1;
    if (outcome.verdict.pass) entry.passed += 1;
  }
  const totals = outcomes.reduce((sum, outcome) => ({
    input: sum.input + outcome.tokens.input,
    cached: sum.cached + outcome.tokens.cached,
    calls: sum.calls + outcome.tokens.calls,
    turns: sum.turns + outcome.tokens.turns,
  }), { input: 0, cached: 0, calls: 0, turns: 0 });
  const summary = {
    mode: scripted ? "scripted (harness check only)" : "live",
    model: options.model ?? process.env.ZAINA_MODEL ?? "(service default)",
    ranAt: new Date().toISOString(),
    cases: outcomes.length,
    passed,
    passRate: outcomes.length ? passed / outcomes.length : 0,
    critical: { cases: critical.length, passed: criticalPassed },
    byCategory,
    tokens: {
      modelCalls: totals.calls,
      inputPerCall: totals.calls ? Math.round(totals.input / totals.calls) : 0,
      inputPerMessage: totals.turns ? Math.round(totals.input / totals.turns) : 0,
      cachedShare: totals.input ? Math.round((100 * totals.cached) / totals.input) / 100 : 0,
    },
    errors: outcomes.reduce((sum, outcome) => sum + outcome.errors.length, 0),
    failures: outcomes.filter((outcome) => !outcome.verdict.pass).map((outcome) => ({
      id: outcome.testCase.id,
      critical: outcome.verdict.critical,
      failures: outcome.verdict.failures,
      turns: outcome.testCase.turns.map((turn) => fillDates(turn)),
      replies: outcome.replies,
    })),
  };
  writeFileSync(options.report!, JSON.stringify(summary, null, 2));

  console.log(`\n${summary.mode}: ${passed}/${outcomes.length} cases passed (${Math.round(100 * summary.passRate)}%); critical ${criticalPassed}/${critical.length}`);
  for (const [category, entry] of Object.entries(byCategory)) console.log(`  ${category.padEnd(18)} ${entry!.passed}/${entry!.cases}`);
  console.log(`  input tokens: ${summary.tokens.inputPerCall} per model call, ${summary.tokens.inputPerMessage} per message, ${Math.round(summary.tokens.cachedShare * 100)}% cached`);
  console.log(`  report: ${options.report}`);
  if (scripted) {
    console.log(summary.errors ? `  harness: ${summary.errors} request error(s)` : "  harness: every conversation ran without errors");
    return summary.errors ? 1 : 0;
  }
  return summary.passRate >= Number(options.min) && criticalPassed === critical.length ? 0 : 1;
}

const exitCode = options.offline ? runOffline() : await runService(options.scripted === true);
process.exit(exitCode);
