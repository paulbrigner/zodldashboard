import { NextResponse } from "next/server";

export function jsonOk(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function jsonError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
