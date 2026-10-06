import { describe, expect, it } from "vitest";
import { userPushSchema } from "@/lib/validation";

const gsonCreate = {
  id: "019384a1-7c2d-7b3e-8f4a-1b2c3d4e5f60",
  nombre: "Ana",
  apellido: "Perez",
  documento: "10203040",
  phone: "+57 300 000 0000",
  email: "ana@example.com",
  address: "Calle 1 #2-3",
  password: "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
  updated_at: 0,
  deleted: false,
};

describe("userPushSchema", () => {
  it("acepta el JSON que envia la APK al crear (Gson omite los null)", () => {
    const parsed = userPushSchema.parse(gsonCreate);
    expect(parsed.id).toBe(gsonCreate.id);
    expect(parsed.phone).toBe(gsonCreate.phone);
    expect(parsed.password).toBe(gsonCreate.password);
    expect(parsed.deleted).toBe(false);
  });

  it("acepta el JSON minimo de una actualizacion", () => {
    const parsed = userPushSchema.parse({
      id: gsonCreate.id,
      nombre: "Ana",
      apellido: "Perez",
      documento: "10203040",
      updated_at: 1730000000000,
      deleted: false,
    });
    expect(parsed.phone).toBeUndefined();
    expect(parsed.password).toBeUndefined();
  });

  it("rechaza id que no es UUID", () => {
    expect(() => userPushSchema.parse({ ...gsonCreate, id: "1" })).toThrow();
  });

  it("rechaza nombre vacio o ausente", () => {
    expect(() => userPushSchema.parse({ ...gsonCreate, nombre: "  " })).toThrow();
    const { nombre: _nombre, ...sinNombre } = gsonCreate;
    expect(() => userPushSchema.parse(sinNombre)).toThrow();
  });

  it("rechaza documento ausente", () => {
    const { documento: _documento, ...sinDocumento } = gsonCreate;
    expect(() => userPushSchema.parse(sinDocumento)).toThrow();
  });
});
