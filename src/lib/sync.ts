import { uuidv7 } from "uuidv7";
import type { Prisma, User } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import type { UserPushInput } from "@/lib/validation";

const SYNC_LOCK_ID = 730141;

export const DEFAULT_PULL_LIMIT = 100;
export const MAX_PULL_LIMIT = 500;

export type PushResult = { kind: "ok"; user: User } | { kind: "conflict" };

export async function pushUser(input: UserPushInput): Promise<PushResult> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYNC_LOCK_ID}::bigint)`;

    const existing = await tx.user.findUnique({ where: { id: input.id } });

    const duplicated = await tx.user.findFirst({
      where: {
        documento: input.documento,
        deleted: false,
        id: { not: input.id },
      },
      select: { id: true },
    });

    if (duplicated) {
      await tx.syncConflict.create({
        data: {
          id: uuidv7(),
          userId: existing?.id ?? null,
          payload: input as unknown as Prisma.InputJsonValue,
          error: "documento_duplicado",
          createdAt: BigInt(Date.now()),
        },
      });
      return { kind: "conflict" };
    }

    const [sequence] = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('sync_seq') AS value
    `;
    const updatedAt = sequence.value;
    const now = BigInt(Date.now());

    const user = await tx.user.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        nombre: input.nombre,
        apellido: input.apellido,
        documento: input.documento,
        phone: input.phone ?? null,
        phonePrevious: input.phone_previous ?? null,
        email: input.email ?? null,
        emailPrevious: input.email_previous ?? null,
        address: input.address ?? null,
        addressPrevious: input.address_previous ?? null,
        passwordHash: input.password ?? null,
        updatedAt,
        deleted: input.deleted ?? false,
        createdAt: now,
        source: "app",
      },
      update: {
        nombre: input.nombre,
        apellido: input.apellido,
        documento: input.documento,
        phone: input.phone ?? null,
        phonePrevious: input.phone_previous ?? null,
        email: input.email ?? null,
        emailPrevious: input.email_previous ?? null,
        address: input.address ?? null,
        addressPrevious: input.address_previous ?? null,
        ...(input.password ? { passwordHash: input.password } : {}),
        updatedAt,
        deleted: input.deleted ?? existing?.deleted ?? false,
      },
    });

    await tx.syncEvent.create({
      data: {
        id: uuidv7(),
        userId: user.id,
        action: existing === null ? "create" : user.deleted ? "delete" : "update",
        source: "app",
        at: updatedAt,
      },
    });

    return { kind: "ok", user };
  });
}

export async function pullUsers(
  since: bigint | null,
  limit: number
): Promise<{ users: User[]; serverTime: bigint }> {
  const prisma = getPrisma();

  const users = await prisma.user.findMany({
    where: since === null ? {} : { updatedAt: { gt: since } },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  const serverTime =
    users.length > 0 ? users[users.length - 1].updatedAt : (since ?? 0n);

  return { users, serverTime };
}
