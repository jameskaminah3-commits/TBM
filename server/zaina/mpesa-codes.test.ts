import assert from "node:assert/strict";
import test from "node:test";
import { findMpesaCodes, mentionsPayment } from "./mpesa-codes.ts";

test("M-Pesa codes are spotted in what customers actually type", () => {
  assert.deepEqual(findMpesaCodes("Done, code is QGH7X8Y9Z1"), ["QGH7X8Y9Z1"]);
  assert.deepEqual(findMpesaCodes("sent! tjk12ab3cd"), ["TJK12AB3CD"]);
  assert.deepEqual(findMpesaCodes("SGR4H7K2LM Confirmed. Ksh2,500.00 sent to ..."), ["SGR4H7K2LM"]);
  assert.deepEqual(findMpesaCodes("(QGH7X8Y9Z1)."), ["QGH7X8Y9Z1"]);
});

test("things that look a bit like codes are not codes", () => {
  assert.deepEqual(findMpesaCodes("my number is 0712345678"), []);
  assert.deepEqual(findMpesaCodes("email john123456@example.com"), []);
  assert.deepEqual(findMpesaCodes("see https://site.example/AB12CD34EF"), []);
  assert.deepEqual(findMpesaCodes("booking EAE050B0 please"), []);
  assert.deepEqual(findMpesaCodes("PAYMENTNOW is a word"), []);
  assert.deepEqual(findMpesaCodes("reference 1234567ABC starts with a digit"), []);
  assert.deepEqual(findMpesaCodes("MOMBASA2026X is eleven characters"), []);
});

test("a payment message is recognised by its words", () => {
  assert.equal(mentionsPayment("I've sent the mpesa"), true);
  assert.equal(mentionsPayment("M-Pesa code QGH7X8Y9Z1"), true);
  assert.equal(mentionsPayment("Do you have a villa in Diani?"), false);
});
