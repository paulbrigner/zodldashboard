import { NextResponse } from "next/server";
import { acceptAccessInvitation } from "@/lib/access-control";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const redirectUrl = new URL("/signin", url.origin);

  try {
    await acceptAccessInvitation(token);
    redirectUrl.searchParams.set("notice", "invitation-accepted");
  } catch (error) {
    redirectUrl.searchParams.set("error", error instanceof Error ? error.message : "invitation failed");
  }

  return NextResponse.redirect(redirectUrl);
}
