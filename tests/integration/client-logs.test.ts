import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/client-logs/route";
import { getPrisma } from "@/lib/db";

process.env.API_KEY = "test_api_key";

const API_KEY = "test_api_key";

function post(body: unknown, key: string | null = API_KEY): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) {
    headers["x-api-key"] = key;
  }
  return POST(
    new Request("http://localhost/api/client-logs", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    at: Date.now(),
    level: "INFO",
    tag: "sync",
    message: "pull completado",
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    device_id: "device-abc",
    app_version: "1.0.0-debug",
    base_url: "http://100.71.51.75:3000",
    entries: [entry()],
    ...overrides,
  };
}

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("contrato /api/client-logs", () => {
  const prisma = getPrisma();

  beforeEach(async () => {
    await prisma.$executeRawUnsafe("DELETE FROM client_logs");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rechaza peticiones sin X-Api-Key", async () => {
    expect((await post(payload(), null)).status).toBe(401);
  });

  it("rechaza payload invalido", async () => {
    expect((await post({ device_id: "x" })).status).toBe(400);
    expect((await post(payload({ entries: [] }))).status).toBe(400);
    expect((await post(payload({ entries: [entry({ level: "TRACE" })] }))).status).toBe(400);
  });

  it("rechaza lotes con mas de 200 entradas", async () => {
    const entries = Array.from({ length: 201 }, () => entry());
    expect((await post(payload({ entries }))).status).toBe(400);
  });

  it("rechaza bodies mayores a 256 KB", async () => {
    const big = entry({ message: "x".repeat(2000) });
    const entries = Array.from({ length: 199 }, () => big);
    const response = await post(payload({ entries }));
    expect([400, 413]).toContain(response.status);
  });

  it("guarda el lote y responde la cantidad recibida", async () => {
    const response = await post(payload({ entries: [entry(), entry({ tag: "push" })] }));
    expect(response.status).toBe(200);
    expect((await response.json()).received).toBe(2);

    const stored = await prisma.clientLog.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].deviceId).toBe("device-abc");
    expect(stored[0].entriesCount).toBe(2);
    expect(stored[0].baseUrl).toBe("http://100.71.51.75:3000");
  });
});
