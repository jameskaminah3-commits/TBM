// Rules for what a provider may do with work TBM has assigned to them.

type AssignmentState = { status: string; providerResponse?: string | null };

export type AssignmentResponseDecision = { allowed: true } | { allowed: false; reason: string };

// A provider accepts or declines before the job starts. Once they have accepted,
// a change of plan goes to TBM through the Admin Channel, so the guest is looked after.
export function canRespondToAssignment(
  assignment: AssignmentState,
  response: "accepted" | "declined",
): AssignmentResponseDecision {
  if (assignment.status === "completed" || assignment.status === "cancelled") {
    return { allowed: false, reason: "This booking is closed." };
  }
  if (assignment.status === "in-progress") {
    return { allowed: false, reason: "This job has started. If something has changed, message TBM in the Admin Channel." };
  }
  if (assignment.providerResponse === "declined") {
    return { allowed: false, reason: "You've already declined this booking." };
  }
  if (assignment.providerResponse === "accepted" && response === "declined") {
    return { allowed: false, reason: "You've already accepted this booking. If you can no longer do it, message TBM in the Admin Channel." };
  }
  return { allowed: true };
}
