import type { User } from "@/generated/prisma/client";

export type UserDto = {
  id: string;
  nombre: string;
  apellido: string;
  documento: string;
  phone: string | null;
  phone_previous: string | null;
  email: string | null;
  email_previous: string | null;
  address: string | null;
  address_previous: string | null;
  password: string | null;
  updated_at: number;
  deleted: boolean;
};

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    nombre: user.nombre,
    apellido: user.apellido,
    documento: user.documento,
    phone: user.phone,
    phone_previous: user.phonePrevious,
    email: user.email,
    email_previous: user.emailPrevious,
    address: user.address,
    address_previous: user.addressPrevious,
    password: null,
    updated_at: Number(user.updatedAt),
    deleted: user.deleted,
  };
}

export function jsonEnvelope(serverTime: bigint, users: User[]): Response {
  return Response.json(
    {
      server_time: Number(serverTime),
      users: users.map(toUserDto),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
