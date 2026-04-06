import type { User } from "@shared/schema";

export function sanitizeUserRecord(user: User): User {
  return {
    ...user,
    passwordHash: null,
  };
}

export function sanitizeOptionalUserRecord(user: User | null | undefined): User | undefined {
  return user ? sanitizeUserRecord(user) : undefined;
}

export function sanitizeUserRecords(users: User[]): User[] {
  return users.map(sanitizeUserRecord);
}
