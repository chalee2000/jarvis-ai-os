import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

// Argon2id with the OWASP-recommended baseline (19 MiB, t=2, p=1).
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns roughly the same time as a real verification when the username does
 * not exist, so response timing does not reveal valid usernames.
 */
export async function dummyVerify(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  await verifyPassword(await dummyHash, password);
  return false;
}

export function validateNewPassword(password: string): string | undefined {
  if ([...password].length < PASSWORD_MIN_LENGTH) {
    return `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `รหัสผ่านต้องยาวไม่เกิน ${PASSWORD_MAX_LENGTH} ตัวอักษร`;
  }
  if (password.trim() !== password) return "รหัสผ่านต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง";
  return undefined;
}
