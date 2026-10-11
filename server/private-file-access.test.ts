import assert from "node:assert/strict";
import test from "node:test";
import { decidePrivateFileAccess } from "./private-file-access.ts";
import { isPrivateFileKey, privateFileKeyFromUrl, privateFileUrl } from "./private-file-key.ts";

const logbook = { kind: "vehicle-document", ownerUserId: "provider-1" };
const none = { managesReferencingCar: false, bookingAccess: null };

test("protected files: admins, the uploader and the car's manager only", () => {
  assert.deepEqual(decidePrivateFileAccess({ id: "admin-1", role: "admin" }, { file: logbook, ...none }), { allowed: true, reason: "admin" });
  assert.deepEqual(decidePrivateFileAccess({ id: "provider-1", role: "provider" }, { file: logbook, ...none }), { allowed: true, reason: "uploader" });
  assert.deepEqual(decidePrivateFileAccess({ id: "provider-3", role: "provider" }, { file: logbook, managesReferencingCar: true, bookingAccess: null }), { allowed: true, reason: "car-manager" });
  assert.equal(decidePrivateFileAccess({ id: "provider-2", role: "provider" }, { file: logbook, ...none }).allowed, false, "another partner");
  assert.equal(decidePrivateFileAccess({ id: "jane-1", role: "customer" }, { file: logbook, ...none }).allowed, false, "a guest");
  assert.deepEqual(decidePrivateFileAccess({ id: null, role: null }, { file: logbook, ...none }), { allowed: false, reason: "signed-out" });
  assert.deepEqual(decidePrivateFileAccess({ id: "admin-1", role: "admin" }, { file: null, ...none }), { allowed: false, reason: "not-found" });
});

test("fleet application files are for TBM until the car is approved and its manager holds them", () => {
  const application = { kind: "fleet-application", ownerUserId: null };
  assert.equal(decidePrivateFileAccess({ id: "provider-2", role: "provider" }, { file: application, ...none }).allowed, false);
  assert.equal(decidePrivateFileAccess({ id: "provider-2", role: "provider" }, { file: application, managesReferencingCar: true, bookingAccess: null }).allowed, true);
  assert.equal(decidePrivateFileAccess({ id: "admin-1", role: "admin" }, { file: application, ...none }).allowed, true);
});

test("a guest's attachment: the guest and partners on that booking", () => {
  const attachment = { kind: "guest-attachment", ownerUserId: "jane-1" };
  assert.equal(decidePrivateFileAccess({ id: "jane-1", role: "customer" }, { file: attachment, ...none }).reason, "uploader");
  assert.equal(decidePrivateFileAccess({ id: "provider-2", role: "provider" }, { file: attachment, managesReferencingCar: false, bookingAccess: "partner" }).reason, "booking-partner");
  assert.equal(decidePrivateFileAccess({ id: "provider-1", role: "provider" }, { file: attachment, ...none }).allowed, false);
  assert.equal(decidePrivateFileAccess({ id: "provider-2", role: "provider" }, { file: logbook, managesReferencingCar: false, bookingAccess: "partner" }).allowed, false, "booking access never opens a vehicle document");
});

test("quarantined files are TBM's only", () => {
  const quarantined = { kind: "quarantine", ownerUserId: "provider-1" };
  assert.equal(decidePrivateFileAccess({ id: "provider-1", role: "provider" }, { file: quarantined, managesReferencingCar: true, bookingAccess: null }).allowed, false);
  assert.equal(decidePrivateFileAccess({ id: "admin-1", role: "admin" }, { file: quarantined, ...none }).allowed, true);
});

test("file links: well-formed keys only, no path tricks", () => {
  assert.equal(privateFileUrl("vehicle-document/2026-10/ab12.pdf"), "/api/files/vehicle-document/2026-10/ab12.pdf");
  assert.equal(privateFileKeyFromUrl("/api/files/vehicle-document/2026-10/ab12.pdf"), "vehicle-document/2026-10/ab12.pdf");
  assert.equal(privateFileKeyFromUrl("https://tembeabilamatata.com/api/files/guest-attachment/2026-10/x.jpg"), "guest-attachment/2026-10/x.jpg");
  assert.equal(privateFileKeyFromUrl("/api/files/vehicle-document/../../etc/passwd"), null);
  assert.equal(privateFileKeyFromUrl("/api/files/other-kind/x.pdf"), null);
  assert.equal(privateFileKeyFromUrl("https://abc.supabase.co/storage/v1/object/public/media/x.pdf"), null);
  assert.equal(privateFileKeyFromUrl("javascript:/api/files/vehicle-document/x.pdf"), null);
  assert.equal(isPrivateFileKey("quarantine/migrated/2026-01-02/1700-ab.pdf"), true);
});
