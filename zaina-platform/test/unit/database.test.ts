// How the platform reaches its database: local Postgres, and Supabase
// through its session pooler (db/connection.ts), and the release step's
// check of the restricted role's address.

import assert from "node:assert/strict";
import test from "node:test";
import { appRolePassword } from "../../src/cli/release.ts";
import { loadConfig } from "../../src/config.ts";
import {
  appAddressProblem,
  connectionHint,
  databaseConnection,
  describeCa,
  describeDatabaseUrl,
  isLocalHost,
  parseDatabaseCa,
} from "../../src/db/connection.ts";

// A throwaway certificate made for these tests (its key was discarded).
const TEST_CA = `-----BEGIN CERTIFICATE-----
MIIDRTCCAi2gAwIBAgIUKJ4+2klLb5tyxl6oNahM9VVxjtMwDQYJKoZIhvcNAQEL
BQAwMjEbMBkGA1UEAwwSWmFpbmEgVGVzdCBSb290IENBMRMwEQYDVQQKDApaYWlu
YSBUZXN0MB4XDTI2MDkyNTE4NTkyOFoXDTM2MDkyMjE4NTkyOFowMjEbMBkGA1UE
AwwSWmFpbmEgVGVzdCBSb290IENBMRMwEQYDVQQKDApaYWluYSBUZXN0MIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArc1b3Jm9DTLwpy1wjOVp3gOTnclm
edcxXKXgtUicJpnT7UgTDLypBSjRVP3QmjP7MK+StSNHg3heU9LhwJPtGWdxiNHM
6o0Oxj+aM6DgIw39/AD+KpzcChQ0pdUAfGfjhwWu9s5mtyYqI77X9CH7z5vlOS44
kJAiB57DGH0tC9DxCII9tZzh8mWhf3ZJ+1dXATYn7UA3a/VoOpAm1NGsTfBI+Y9v
pfuTQcPLBJt6aY1I6eTPJQdBqy9yEoWEBhtY9di/4lcecKXda85A+YGg42KdErNE
wHJONCJqpQS3iD7B6YUESUB73BQugEXzw4jb+77e4DvefsjhAN7qcLkfXQIDAQAB
o1MwUTAdBgNVHQ4EFgQU9NO0I1aiHGq2piqLQE6dbNyXicgwHwYDVR0jBBgwFoAU
9NO0I1aiHGq2piqLQE6dbNyXicgwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0B
AQsFAAOCAQEAC5Tsw3p77bn55bugMmT2qhTFBhgVqd5A8TxfX1SN4B7fBXqDF4Cq
OdGS2CgrOuXHdzbsxSRCJ3kMyl7TYSe6q7mwtPbpg22/Qovb3L6SkDWL/B5lzs9R
UgR0CvFIHxGpewobg10I4rIkjZ89C5o9p2JqvpcYc7ol0BbFnHDg+w71rkmTop1D
t2D2XOXfhu2prPkaa5kYQAhYP5oSTWp4jFb3wUsVAIqI/uPpIGHU5hFMaiPjhbBp
xnxn9mXd42MQmrQ4JOAQzlhpmOBLYbhzysZJvx1CIjwf6cSGOC51Wmhy3jcbrnBl
dInxfakosN0IH/oCydWTcI5+6HJQ8v0BVg==
-----END CERTIFICATE-----`;

const REF = "abcdefghijklmnopqrst";
const POOLER = `aws-0-eu-west-2.pooler.supabase.com`;
const OWNER = `postgresql://postgres.${REF}:owner-password-123456@${POOLER}:5432/postgres?sslmode=require`;
const APP = `postgresql://zaina_app.${REF}:app-password-12345678@${POOLER}:5432/postgres?sslmode=require`;

test("a local database isn't encrypted unless asked, and never needs a certificate", () => {
  for (const url of ["postgres://postgres@127.0.0.1:55432/zaina_platform_test", "postgres://u:p@localhost/db", "postgres://u:p@db:5432/x", "postgres://u:p@zaina-db.railway.internal:5432/railway"]) {
    const connection = databaseConnection(url, { max: 5 });
    assert.equal(connection.tls, "off", url);
    assert.equal(connection.config.ssl, false);
    assert.deepEqual(connection.warnings, []);
  }
  assert.equal(databaseConnection("postgres://u:p@localhost/db?sslmode=disable", { max: 1 }).tls, "off");
  assert.equal(databaseConnection("postgres://u:p@localhost/db?sslmode=require", { max: 1 }).tls, "encrypted");
  assert.ok(isLocalHost("192.168.1.20") && isLocalHost("10.0.0.4") && isLocalHost("[::1]") && isLocalHost(""));
  assert.ok(!isLocalHost("172.40.0.1") && !isLocalHost(POOLER) && !isLocalHost("8.8.8.8"));
});

test("Supabase's session pooler: sslmode means what it means to psql, and a certificate makes it checked", () => {
  const unchecked = databaseConnection(OWNER, { max: 3 });
  assert.equal(unchecked.tls, "encrypted");
  assert.deepEqual(unchecked.config.ssl, { rejectUnauthorized: false });
  assert.ok(!unchecked.config.connectionString!.includes("sslmode"), "node-postgres would read sslmode=require as verify-full");
  assert.match(unchecked.warnings.join("\n"), /isn't checked\. Set PLATFORM_DATABASE_CA/);
  assert.equal(unchecked.address.role, "postgres");
  assert.equal(unchecked.address.supabaseProject, REF);
  assert.ok(unchecked.address.supabasePooler && !unchecked.address.local);

  const checked = databaseConnection(OWNER, { max: 3, ca: parseDatabaseCa(TEST_CA) });
  assert.equal(checked.tls, "verified");
  const ssl = checked.config.ssl as { ca: string; rejectUnauthorized: boolean; checkServerIdentity?: () => undefined };
  assert.equal(ssl.rejectUnauthorized, true);
  assert.match(ssl.ca, /BEGIN CERTIFICATE/);
  assert.equal(typeof ssl.checkServerIdentity, "function", "require with a certificate checks the chain (like psql's verify-ca)");
  assert.deepEqual(checked.warnings, []);

  const full = databaseConnection(OWNER.replace("sslmode=require", "sslmode=verify-full"), { max: 3, ca: parseDatabaseCa(TEST_CA) });
  assert.equal(full.tls, "verified");
  assert.equal((full.config.ssl as { checkServerIdentity?: unknown }).checkServerIdentity, undefined, "verify-full checks the host name too");

  // No sslmode: a remote database is encrypted anyway.
  assert.equal(databaseConnection(OWNER.replace("?sslmode=require", ""), { max: 3 }).tls, "encrypted");
  assert.equal(databaseConnection(OWNER.replace("sslmode=require", "sslmode=no-verify"), { max: 3, ca: parseDatabaseCa(TEST_CA) }).tls, "encrypted");
  assert.equal(databaseConnection(OWNER, { max: 7 }).config.max, 7);
  assert.equal(databaseConnection(OWNER, { max: 7 }).config.keepAlive, true);
});

test("setups that can't work on Supabase are refused with what to do instead", () => {
  assert.throws(() => describeDatabaseUrl(OWNER.replace(":5432/", ":6543/")), /transaction pooler \(port 6543\)\. Use the session pooler/);
  assert.throws(() => describeDatabaseUrl(`postgresql://postgres:pw@${POOLER}:5432/postgres`), /user name ends with the project/);
  assert.throws(() => databaseConnection(OWNER.replace("sslmode=require", "sslmode=disable"), { max: 1 }), /only for a database on this machine/);
  assert.throws(() => databaseConnection(`${OWNER}&sslrootcert=/etc/ca.crt`, { max: 1 }), /PLATFORM_DATABASE_CA instead/);
  assert.throws(() => databaseConnection(OWNER.replace("sslmode=require", "sslmode=sometimes"), { max: 1 }), /isn't one of/);
  assert.throws(() => describeDatabaseUrl("mysql://u:p@h/db"), /valid postgresql/);
  assert.throws(() => describeDatabaseUrl("not a url"), /valid postgresql/);

  const direct = databaseConnection(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`, { max: 1 });
  assert.equal(direct.address.supabaseProject, REF);
  assert.match(direct.warnings.join("\n"), /IPv6 only/);
});

test("the certificate is accepted as pasted: with line breaks, with \\n, on one line, or in base64", () => {
  const expected = parseDatabaseCa(TEST_CA);
  assert.ok(expected);
  assert.equal(parseDatabaseCa(TEST_CA.replace(/\n/g, "\\n")), expected);
  assert.equal(parseDatabaseCa(TEST_CA.replace(/\n/g, " ")), expected);
  assert.equal(parseDatabaseCa(Buffer.from(TEST_CA).toString("base64")), expected);
  assert.equal(parseDatabaseCa(`  ${TEST_CA}\n\n`), expected);
  assert.equal(parseDatabaseCa(""), null);
  assert.equal(parseDatabaseCa(undefined), null);
  assert.throws(() => parseDatabaseCa("hello"), /certificate's text/);
  assert.throws(() => parseDatabaseCa("-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----"), /isn't a valid certificate/);
  assert.throws(() => parseDatabaseCa("-----BEGIN CERTIFICATE-----\nMIID"), /no complete certificate/);
  assert.equal(describeCa(expected), "Zaina Test Root CA, until 2036-09-22");
});

test("the restricted role's address must be zaina_app on the owner's own database", () => {
  const owner = describeDatabaseUrl(OWNER);
  assert.equal(appAddressProblem(owner, describeDatabaseUrl(APP)), null);
  assert.match(appAddressProblem(owner, describeDatabaseUrl(OWNER))!, /must sign in as zaina_app \(user zaina_app\.<project-ref>\), not "postgres"/);
  assert.match(appAddressProblem(owner, describeDatabaseUrl(APP.replace(REF, "tsrqponmlkjihgfedcba")))!, /same database/);
  assert.match(appAddressProblem(owner, describeDatabaseUrl(APP.replace("eu-west-2", "us-east-1")))!, /same database/);
  assert.match(appAddressProblem(owner, describeDatabaseUrl(APP.replace("/postgres?", "/other?")))!, /same database/);
  const local = describeDatabaseUrl("postgres://postgres@127.0.0.1:55432/zaina_platform");
  assert.equal(appAddressProblem(local, describeDatabaseUrl("postgres://zaina_app:pw@127.0.0.1:55432/zaina_platform")), null);

  // The release step reads the password from it.
  assert.equal(appRolePassword(APP), "app-password-12345678");
  assert.throws(() => appRolePassword(OWNER), /must sign in as zaina_app \(user zaina_app\.<project-ref>\)/);
  assert.throws(() => appRolePassword(APP.replace("app-password-12345678", "short")), /at least 16/);
});

test("the service refuses a restricted-role address for another database, before it starts", () => {
  const env = {
    SESSION_TOKEN_SECRET: "a-session-secret-that-is-long-enough-123",
    GEMINI_API_KEY: "test",
    PLATFORM_DATABASE_URL: OWNER,
  };
  const config = loadConfig({ ...env, PLATFORM_APP_DATABASE_URL: APP, PLATFORM_DATABASE_CA: TEST_CA, PLATFORM_DB_POOL_MAX: "6" });
  assert.equal(config.databasePoolMax, 6);
  assert.match(config.platformDatabaseCa!, /BEGIN CERTIFICATE/);
  assert.equal(loadConfig(env).databasePoolMax, 10);
  assert.throws(() => loadConfig({ ...env, PLATFORM_APP_DATABASE_URL: APP.replace(REF, "tsrqponmlkjihgfedcba") }), /same database/);
  assert.throws(() => loadConfig({ ...env, PLATFORM_DATABASE_URL: OWNER.replace(":5432/", ":6543/") }), /session pooler/);
  assert.throws(() => loadConfig({ ...env, PLATFORM_DATABASE_CA: "not a certificate" }), /PLATFORM_DATABASE_CA/);
});

test("known connection failures come with what to check", () => {
  const address = describeDatabaseUrl(OWNER);
  assert.match(connectionHint(new Error("self-signed certificate in certificate chain"), address)!, /PLATFORM_DATABASE_CA/);
  assert.match(connectionHint(new Error("Hostname/IP does not match certificate's altnames: Host: x. is not in the cert's altnames"), address)!, /sslmode=require/);
  assert.match(connectionHint(new Error("Tenant or user not found"), address)!, /<role>\.<project-ref>/);
  assert.match(connectionHint(new Error("password authentication failed for user \"postgres\""), address)!, /Wrong password/);
  assert.match(connectionHint(new Error("Connection terminated due to connection timeout"), address)!, /paused/);
  assert.equal(connectionHint(new Error("something else"), address), null);
});
