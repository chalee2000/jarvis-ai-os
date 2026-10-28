/** An error whose message is safe to show to the user (Thai). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: { retryable?: boolean; messageId?: string; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = () => new HttpError(404, "not_found", "ไม่พบข้อมูลที่ร้องขอ");
export const unauthorized = () => new HttpError(401, "unauthorized", "กรุณาเข้าสู่ระบบ");
export const forbidden = (message = "คำขอถูกปฏิเสธเพื่อความปลอดภัย") =>
  new HttpError(403, "forbidden", message);
