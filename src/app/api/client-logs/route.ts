import { uuidv7 } from "uuidv7";
import type { Prisma } from "@/generated/prisma/client";
import { isValidApiKey } from "@/lib/api-auth";
import { getPrisma } from "@/lib/db";
import { clientLogsSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  if (!isValidApiKey(request)) {
    return Response.json({ error: "no_autorizado" }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_demasiado_grande" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "payload_invalido" }, { status: 400 });
  }

  const parsed = clientLogsSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "payload_invalido" }, { status: 400 });
  }

  const input = parsed.data;

  await getPrisma().clientLog.create({
    data: {
      id: uuidv7(),
      deviceId: input.device_id,
      appVersion: input.app_version,
      baseUrl: input.base_url,
      entries: input.entries as unknown as Prisma.InputJsonValue,
      entriesCount: input.entries.length,
      receivedAt: BigInt(Date.now()),
    },
  });

  return Response.json(
    { received: input.entries.length },
    { headers: { "Cache-Control": "no-store" } }
  );
}
