import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { GET, POST } from "@/app/api/users/route";
import { getPrisma } from "@/lib/db";

const API_KEY = "test_api_key";
process.env.API_KEY = API_KEY;

const MIN_EPOCH_MS = 1_700_000_000_000;

function push(body: unknown, key: string | null = API_KEY): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) {
    headers["x-api-key"] = key;
  }
  return POST(
    new Request("http://localhost/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

function pull(query = "", key: string | null = API_KEY): Promise<Response> {
  const headers: Record<string, string> = {};
  if (key) {
    headers["x-api-key"] = key;
  }
  return GET(new Request(`http://localhost/api/users${query}`, { headers }));
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    nombre: "Ana",
    apellido: "Perez",
    documento: `DOC-${Math.random().toString(36).slice(2, 10)}`,
    updated_at: 0,
    deleted: false,
    ...overrides,
  };
}

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("contrato /api/users contra PostgreSQL", () => {
  const prisma = getPrisma();

  beforeEach(async () => {
    await prisma.$executeRawUnsafe("DELETE FROM sync_events");
    await prisma.$executeRawUnsafe("DELETE FROM sync_conflicts");
    await prisma.$executeRawUnsafe("DELETE FROM files");
    await prisma.$executeRawUnsafe("DELETE FROM users");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rechaza peticiones sin X-Api-Key", async () => {
    expect((await push(payload(), null)).status).toBe(401);
    expect((await pull("", null)).status).toBe(401);
  });

  it("rechaza payload invalido", async () => {
    const response = await push({ id: "no-es-uuid" });
    expect(response.status).toBe(400);
  });

  it("crea el usuario y responde el envelope del contrato", async () => {
    const body = payload({ phone: "+57 300 000 0000", password: "hash-inicial" });
    const response = await push(body);
    expect(response.status).toBe(200);

    const envelope = await response.json();
    expect(envelope.server_time).toBeGreaterThanOrEqual(MIN_EPOCH_MS);
    expect(envelope.users).toHaveLength(1);

    const [user] = envelope.users;
    expect(user.id).toBe(body.id);
    expect(user.phone).toBe("+57 300 000 0000");
    expect(user.password).toBeNull();
    expect(user.updated_at).toBe(envelope.server_time);
    expect(user.deleted).toBe(false);

    const stored = await prisma.user.findUnique({ where: { id: body.id } });
    expect(stored?.passwordHash).toBe("hash-inicial");
    expect(stored?.source).toBe("app");
  });

  it("es idempotente: mismo UUID actualiza, no duplica", async () => {
    const body = payload();
    const first = await (await push(body)).json();
    const second = await (
      await push({ ...body, phone: "+57 300 222 2222", phone_previous: null })
    ).json();

    expect(await prisma.user.count()).toBe(1);
    expect(second.users[0].updated_at).toBeGreaterThan(first.users[0].updated_at);
    expect(second.users[0].phone).toBe("+57 300 222 2222");
  });

  it("conserva el hash si la actualizacion no envia password", async () => {
    const body = payload({ password: "hash-inicial" });
    await push(body);
    await push({ ...body, phone: "+57 300 333 3333" });

    const stored = await prisma.user.findUnique({ where: { id: body.id } });
    expect(stored?.passwordHash).toBe("hash-inicial");
  });

  it("responde 409 si el documento ya existe con otro id y registra el conflicto", async () => {
    const documento = "DOC-DUPLICADO";
    await push(payload({ documento }));

    const response = await push(payload({ documento }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("documento_duplicado");

    expect(await prisma.user.count()).toBe(1);
    const conflicts = await prisma.syncConflict.findMany();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].error).toBe("documento_duplicado");
  });

  it("serializa pushes concurrentes con el mismo documento: uno gana, otro 409", async () => {
    const documento = "DOC-CONCURRENTE";
    const [a, b] = await Promise.all([
      push(payload({ documento })),
      push(payload({ documento })),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(await prisma.user.count()).toBe(1);
  });

  it("pull incremental respeta el cursor server_time", async () => {
    const first = await (await push(payload())).json();
    const second = await (await push(payload())).json();

    const all = await (await pull()).json();
    expect(all.users).toHaveLength(2);
    expect(all.server_time).toBe(second.users[0].updated_at);
    expect(all.users[0].updated_at).toBe(first.users[0].updated_at);

    const empty = await (await pull(`?since=${all.server_time}`)).json();
    expect(empty.users).toHaveLength(0);
    expect(empty.server_time).toBe(all.server_time);

    const target = payload();
    await push(target);
    const after = await (await pull(`?since=${empty.server_time}`)).json();
    expect(after.users).toHaveLength(1);
    expect(after.users[0].id).toBe(target.id);
    expect(after.server_time).toBeGreaterThan(empty.server_time);
  });

  it("pagina el pull con limit y deja el cursor listo para la pagina siguiente", async () => {
    await push(payload());
    await push(payload());
    await push(payload());

    const page1 = await (await pull("?limit=2")).json();
    expect(page1.users).toHaveLength(2);
    expect(page1.server_time).toBe(page1.users[1].updated_at);

    const page2 = await (await pull(`?since=${page1.server_time}&limit=2`)).json();
    expect(page2.users).toHaveLength(1);
    expect(page2.server_time).toBe(page2.users[0].updated_at);
  });

  it("propaga el borrado logico y libera el documento", async () => {
    const body = payload();
    await push(body);
    await push({ ...body, deleted: true });

    const pulled = await (await pull()).json();
    expect(pulled.users).toHaveLength(1);
    expect(pulled.users[0].deleted).toBe(true);

    const replacement = payload({ documento: body.documento });
    expect((await push(replacement)).status).toBe(200);
  });

  it("marca la sincronizacion de un borrado remoto con accion delete", async () => {
    const body = payload();
    await push(body);
    await push({ ...body, deleted: true });

    const events = await prisma.syncEvent.findMany({ orderBy: { at: "asc" } });
    expect(events.map((event) => event.action)).toEqual(["create", "delete"]);
  });
});
