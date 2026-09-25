import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentContact, resolveCustomerContact, sharesPhoneNumber, textArg } from "./tool-args.ts";

test("text arguments of any JSON type are read without throwing", () => {
  assert.equal(textArg("  Nyali "), "Nyali");
  assert.equal(textArg(254712345678), "254712345678");
  assert.equal(textArg(null), "");
  assert.equal(textArg(undefined), "");
  assert.equal(textArg(["Nyali"]), "");
  assert.equal(textArg({ area: "Nyali" }), "");
  assert.equal(textArg(Number.NaN), "");
});

// The conversation from production session 8657091d: no name or email given.
const productionConversation = [
  "Hi, there is an Airbnb I wat you to help me confirm",
  "Some agent sent it to me via whatsapp.. I have the pictures.",
  "The pictures provides if they do match the current state of the property..Also if its close to the beach, " +
    "and if possible a live video call. The property is in Nyali. A three bedrooms and it has swimming pool, and very close to the beach",
];

test("contact details the customer never gave are rejected", () => {
  for (const [name, email] of [
    ["Guest", "guest@example.com"],
    ["Customer", "customer@tbm.com"],
    ["Unknown", "unknown@unknown.com"],
    ["Not provided", "not provided"],
    ["", ""],
  ]) {
    assert.deepEqual(
      resolveCustomerContact({ name, email }, productionConversation),
      { ok: false, missing: ["name", "email"] },
      `${name} / ${email}`,
    );
  }
});

test("contact details the customer typed are accepted", () => {
  const texts = [...productionConversation, "Sure — Aisha Mohamed, Aisha.M@gmail.com, 0712 345 678"];
  assert.deepEqual(
    resolveCustomerContact({ name: "Aisha Mohamed", email: "aisha.m@gmail.com", phone: "+254712345678" }, texts),
    { ok: true, name: "Aisha Mohamed", email: "aisha.m@gmail.com", phone: "+254712345678" },
  );
});

test("a partly corrected name still counts, a made-up one does not", () => {
  const texts = ["my name is jhon kamau, email jk@yahoo.com"];
  assert.equal(resolveCustomerContact({ name: "John Kamau", email: "jk@yahoo.com" }, texts).ok, true);
  assert.deepEqual(resolveCustomerContact({ name: "Mr Otieno", email: "jk@yahoo.com" }, texts), { ok: false, missing: ["name"] });
});

test("placeholder words only match whole words the customer used", () => {
  // "guests" does not make "Guest" a name, and a title alone is not a name.
  const texts = ["We are 4 guests, I'm Mr. Baraka, baraka@gmail.com"];
  assert.deepEqual(resolveCustomerContact({ name: "Guest", email: "baraka@gmail.com" }, texts), { ok: false, missing: ["name"] });
  assert.deepEqual(resolveCustomerContact({ name: "Mr", email: "baraka@gmail.com" }, texts), { ok: false, missing: ["name"] });
  assert.equal(resolveCustomerContact({ name: "Baraka", email: "baraka@gmail.com" }, texts).ok, true);
});

test("an email must be one the customer typed", () => {
  const texts = ["I'm Wanjiru, my email is wanjiru @ gmail.com"];
  assert.equal(resolveCustomerContact({ name: "Wanjiru", email: "wanjiru@gmail.com" }, texts).ok, true);
  assert.deepEqual(
    resolveCustomerContact({ name: "Wanjiru", email: "wanjiru@example.com" }, texts),
    { ok: false, missing: ["email"] },
  );
});

test("a phone number is kept only if the customer typed it", () => {
  const texts = ["Wanjiru, wanjiru@gmail.com. The agent wants KSh 25,000 for 3 nights"];
  const contact = resolveCustomerContact({ name: "Wanjiru", email: "wanjiru@gmail.com", phone: 254700000000 }, texts);
  assert.deepEqual(contact, { ok: true, name: "Wanjiru", email: "wanjiru@gmail.com", phone: null });
});

test("the agent's number is kept only if the customer typed it", () => {
  const texts = [...productionConversation, "The agent is Mary, her number is 0722 111 333"];
  assert.equal(resolveAgentContact("Mary, +254 722 111 333", texts), "Mary, +254 722 111 333");
  assert.equal(resolveAgentContact(254722111333, texts), "254722111333");
  assert.equal(resolveAgentContact("Mary, 0799 000 000", texts), null);
  assert.equal(resolveAgentContact("the agent", texts), null);
  assert.equal(resolveAgentContact(undefined, texts), null);
});

test("an agent reachable by handle or profile link counts as a contact", () => {
  const texts = ["No number, but she's @nyali_homes on Instagram and facebook.com/mary.homes"];
  assert.equal(resolveAgentContact("@Nyali_Homes (Instagram)", texts), "@Nyali_Homes (Instagram)");
  assert.equal(resolveAgentContact("https://facebook.com/mary.homes", texts), "https://facebook.com/mary.homes");
  assert.equal(resolveAgentContact("@coastal_stays", texts), null);
});

test("phone numbers are compared regardless of format", () => {
  assert.equal(sharesPhoneNumber("0712 345 678", "Mary +254-712-345-678"), true);
  assert.equal(sharesPhoneNumber("0712 345 678", "KSh 25,000 for 3 nights"), false);
});
