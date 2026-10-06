import { describe, expect, it } from "vitest";
import type { User } from "@/generated/prisma/client";
import { toUserDto } from "@/lib/envelope";

const user = {
  id: "019384a1-7c2d-7b3e-8f4a-1b2c3d4e5f60",
  nombre: "Ana",
  apellido: "Perez",
  documento: "10203040",
  phone: "+57 300 000 0000",
  phonePrevious: "+57 300 111 1111",
  email: "ana@example.com",
  emailPrevious: null,
  address: "Calle 1 #2-3",
  addressPrevious: "Calle 9 #9-9",
  passwordHash: "hash",
  updatedAt: 1730000000123n,
  deleted: false,
  createdAt: 1729999999999n,
  source: "app",
} as unknown as User;

describe("toUserDto", () => {
  it("expone exactamente el contrato del UserDto", () => {
    expect(toUserDto(user)).toEqual({
      id: "019384a1-7c2d-7b3e-8f4a-1b2c3d4e5f60",
      nombre: "Ana",
      apellido: "Perez",
      documento: "10203040",
      phone: "+57 300 000 0000",
      phone_previous: "+57 300 111 1111",
      email: "ana@example.com",
      email_previous: null,
      address: "Calle 1 #2-3",
      address_previous: "Calle 9 #9-9",
      password: null,
      updated_at: 1730000000123,
      deleted: false,
    });
  });

  it("nunca devuelve el hash de la contrasena", () => {
    expect(toUserDto(user).password).toBeNull();
  });
});
