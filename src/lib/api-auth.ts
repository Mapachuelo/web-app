import { timingSafeEqual } from "node:crypto";

export function isValidApiKey(request: Request): boolean {
  const provided = request.headers.get("x-api-key");
  const expected = process.env.API_KEY;
  if (!provided || !expected) {
    return false;
  }
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}
