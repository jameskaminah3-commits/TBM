// Who may open a protected file. Everyone else, including signed-out visitors
// and other partners, is refused.
export type PrivateFileViewer = { id: string | null; role: string | null };
export type PrivateFileFacts = {
  file: { kind: string; ownerUserId: string | null } | null;
  managesReferencingCar: boolean;
  bookingAccess: "guest" | "partner" | null;
};
export type PrivateFileDecision = { allowed: boolean; reason: string };

export function decidePrivateFileAccess(viewer: PrivateFileViewer, facts: PrivateFileFacts): PrivateFileDecision {
  if (!facts.file) {
    return { allowed: false, reason: "not-found" };
  }
  if (!viewer.id) {
    return { allowed: false, reason: "signed-out" };
  }
  if (viewer.role === "admin") {
    return { allowed: true, reason: "admin" };
  }
  // Files kept aside from the clean-up (nothing pointed at them) are for TBM only.
  if (facts.file.kind === "quarantine") {
    return { allowed: false, reason: "not-permitted" };
  }
  if (facts.file.ownerUserId && facts.file.ownerUserId === viewer.id) {
    return { allowed: true, reason: "uploader" };
  }
  if (facts.managesReferencingCar) {
    return { allowed: true, reason: "car-manager" };
  }
  if (facts.file.kind === "guest-attachment" && facts.bookingAccess) {
    return { allowed: true, reason: facts.bookingAccess === "guest" ? "booking-guest" : "booking-partner" };
  }
  return { allowed: false, reason: "not-permitted" };
}
