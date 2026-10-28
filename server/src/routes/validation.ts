import { z } from "zod";
import { HttpError, notFound } from "../http-error.js";

export const MESSAGE_MAX_CHARS = 4000;

const codePointLength = (value: string) => [...value].length;

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const sendMessageSchema = z.object({
  content: z
    .string()
    .refine((v) => v.trim().length > 0, "empty")
    .refine((v) => codePointLength(v) <= MESSAGE_MAX_CHARS, "too_long"),
  clientMessageId: z.uuid(),
});

const uuidSchema = z.uuid();

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const tooLong = result.error.issues.some((i) => i.message === "too_long");
    throw new HttpError(
      400,
      "invalid_input",
      tooLong
        ? `ข้อความยาวเกิน ${MESSAGE_MAX_CHARS.toLocaleString("en-US")} ตัวอักษร`
        : "ข้อมูลที่ส่งมาไม่ถูกต้อง",
    );
  }
  return result.data;
}

/** Invalid ids are treated as "not found" so ids cannot be probed. */
export function parseId(value: unknown): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw notFound();
  return result.data;
}
