import { isValidApiKey } from "@/lib/api-auth";
import { jsonEnvelope } from "@/lib/envelope";
import {
  DEFAULT_PULL_LIMIT,
  MAX_PULL_LIMIT,
  pullUsers,
  pushUser,
} from "@/lib/sync";
import { userPushSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isValidApiKey(request)) {
    return Response.json({ error: "no_autorizado" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "payload_invalido" }, { status: 400 });
  }

  const parsed = userPushSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "payload_invalido" }, { status: 400 });
  }

  const result = await pushUser(parsed.data);
  if (result.kind === "conflict") {
    return Response.json(
      { error: "documento_duplicado" },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }

  return jsonEnvelope(result.user.updatedAt, [result.user]);
}

export async function GET(request: Request): Promise<Response> {
  if (!isValidApiKey(request)) {
    return Response.json({ error: "no_autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);

  const sinceParam = url.searchParams.get("since");
  let since: bigint | null = null;
  if (sinceParam) {
    if (!/^\d+$/.test(sinceParam)) {
      return Response.json({ error: "since_invalido" }, { status: 400 });
    }
    since = BigInt(sinceParam);
  }

  const limitParam = url.searchParams.get("limit");
  let limit = DEFAULT_PULL_LIMIT;
  if (limitParam) {
    if (!/^\d+$/.test(limitParam)) {
      return Response.json({ error: "limit_invalido" }, { status: 400 });
    }
    limit = Math.min(Math.max(Number(limitParam), 1), MAX_PULL_LIMIT);
  }

  const { users, serverTime } = await pullUsers(since, limit);
  return jsonEnvelope(serverTime, users);
}
