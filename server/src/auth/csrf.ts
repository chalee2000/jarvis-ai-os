import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CSRF_HEADER = "x-csrf-token";

export function preSessionCsrfCookieName(isProduction: boolean): string {
  return isProduction ? "__Host-jarvis_csrf" : "jarvis_csrf";
}

function sign(secret: string, nonce: string): string {
  return createHmac("sha256", secret).update(`csrf:${nonce}`).digest("base64url");
}

/** Signed token for the double-submit cookie used before login. */
export function createPreSessionCsrfToken(secret: string): string {
  const nonce = randomBytes(24).toString("base64url");
  return `${nonce}.${sign(secret, nonce)}`;
}

export function isValidPreSessionCsrfToken(secret: string, token: string): boolean {
  const [nonce, signature, ...rest] = token.split(".");
  if (!nonce || !signature || rest.length > 0) return false;
  return safeEqual(signature, sign(secret, nonce));
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
