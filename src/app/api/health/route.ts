import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const prisma = getPrisma();
    const [row] = await prisma.$queryRaw<Array<{ server_time: bigint | null }>>`
      SELECT MAX(updated_at) AS server_time FROM users
    `;
    return Response.json(
      {
        status: "ok",
        db: "ok",
        server_time: Number(row?.server_time ?? 0n),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { status: "error", db: "down" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
