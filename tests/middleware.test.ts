import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { middleware } from "@/middleware";

afterEach(() => {
  delete process.env.CORS_ORIGINS;
});

describe("middleware CORS", () => {
  it("responde el preflight OPTIONS con 204 y permite x-api-key", () => {
    const response = middleware(
      new NextRequest("http://localhost/api/users", {
        method: "OPTIONS",
        headers: { origin: "https://localhost" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-headers")).toContain("x-api-key");
  });

  it("agrega los headers CORS a la respuesta normal", () => {
    const response = middleware(
      new NextRequest("http://localhost/api/users", { method: "GET" }),
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("respeta CORS_ORIGINS y refleja el origen permitido", () => {
    process.env.CORS_ORIGINS = "http://127.0.0.1:8080,https://localhost";
    const response = middleware(
      new NextRequest("http://localhost/api/users", {
        method: "GET",
        headers: { origin: "http://127.0.0.1:8080" },
      }),
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:8080",
    );
  });
});
