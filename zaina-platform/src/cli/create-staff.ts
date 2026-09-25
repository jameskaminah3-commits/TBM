// zaina-platform/src/cli/create-staff.ts
//
// Creates a staff account, for setting up the platform (the first platform
// admin, or a business's first owner). The password comes from the
// STAFF_PASSWORD environment variable, never the command line.
//
//   STAFF_PASSWORD=… npm run staff:create -- --email a@b.co --name "Amina" [--platform-admin] [--business tbm --role owner]

import "dotenv/config";
import { parseArgs } from "node:util";
import { staffMemberships, staffRoles, type StaffRole } from "../db/schema.ts";
import { closePlatformDb, initPlatformDb } from "../db/platform-db.ts";
import { createStaffUser, findStaffByEmail } from "../db/platform-scope.ts";
import { inBusiness } from "../db/tenant.ts";
import { hashPassword, passwordProblem } from "../staff/passwords.ts";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    "platform-admin": { type: "boolean", default: false },
    business: { type: "string" },
    role: { type: "string" },
  },
});

async function main() {
  const url = process.env.PLATFORM_DATABASE_URL?.trim();
  if (!url) throw new Error("PLATFORM_DATABASE_URL is required");
  if (!values.email || !values.name) throw new Error("--email and --name are required");
  if (values.business && !staffRoles.includes(values.role as StaffRole)) throw new Error(`--role is one of ${staffRoles.join(", ")}`);
  initPlatformDb(url, { max: 2 });
  let user = await findStaffByEmail(values.email);
  if (!user) {
    const password = process.env.STAFF_PASSWORD ?? "";
    const problem = passwordProblem(password);
    if (problem) throw new Error(`STAFF_PASSWORD: ${problem}`);
    user = await createStaffUser({ email: values.email, name: values.name, passwordHash: await hashPassword(password), isPlatformAdmin: values["platform-admin"] });
    console.log(`[staff] created ${user.email}${user.isPlatformAdmin ? " (platform admin)" : ""}`);
  } else {
    console.log(`[staff] ${user.email} already exists`);
  }
  if (values.business) {
    const userId = user.id;
    const role = values.role as StaffRole;
    await inBusiness((db) => db
      .insert(staffMemberships)
      .values({ businessId: values.business!, userId, role })
      .onConflictDoUpdate({ target: [staffMemberships.businessId, staffMemberships.userId], set: { role } }), values.business);
    console.log(`[staff] ${user.email} is ${role} of ${values.business}`);
  }
}

main()
  .catch((error) => {
    console.error(`[staff] ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => closePlatformDb());
