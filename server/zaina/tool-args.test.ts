import assert from "node:assert/strict";
import test from "node:test";
import { resolveCustomerContact, textArg } from "./tool-args.ts";

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
