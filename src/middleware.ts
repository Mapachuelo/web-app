import { NextResponse, type NextRequest } from "next/server";

function resolveOrigin(request: NextRequest): string {
  const configured = process.env.CORS_ORIGINS?.trim();
  if (!configured || configured === "*") return "*";
  const allowed = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin") ?? "";
  return allowed.includes(origin) ? origin : (allowed[0] ?? "");
}

export function middleware(request: NextRequest): NextResponse {
  const origin = resolveOrigin(request);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-api-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
