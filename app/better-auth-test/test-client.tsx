"use client";

import { useState } from "react";
import { BETTER_AUTH_BASE_PATH } from "@/lib/better-auth-constants";

type FlowState = "idle" | "workspace" | "guest";

async function startBetterAuthFlow(path: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${BETTER_AUTH_BASE_PATH}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as { url?: string; message?: string } | null;
  if (!response.ok || !payload?.url) {
    throw new Error(payload?.message || `Better Auth flow failed with HTTP ${response.status}`);
  }

  window.location.assign(payload.url);
}

export default function BetterAuthTestClient() {
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function startWorkspaceGoogle() {
    setFlowState("workspace");
    setError(null);
    try {
      await startBetterAuthFlow("/sign-in/social", {
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/better-auth-test",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workspace Google sign-in failed.");
      setFlowState("idle");
    }
  }

  async function startGuestGoogle() {
    setFlowState("guest");
    setError(null);
    try {
      await startBetterAuthFlow("/sign-in/oauth2", {
        providerId: "google-guest",
        callbackURL: "/",
        errorCallbackURL: "/better-auth-test",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Guest Google sign-in failed.");
      setFlowState("idle");
    }
  }

  return (
    <main className="page">
      <section className="card">
        <div className="brand-lockup" aria-label="Zodl and Zcash">
          <img className="brand-logo brand-logo-zodl" src="/brand/zodl-logo-black.png" alt="Zodl" width={1673} height={344} />
          <span className="brand-divider" aria-hidden="true" />
          <img className="brand-logo brand-logo-zcash" src="/brand/zcash-logo.svg" alt="Zcash" width={65} height={65} />
        </div>
        <p className="eyebrow">Better Auth Migration Test</p>
        <h1>Parallel sign-in</h1>
        <p className="subtle-text">
          This page starts the new Better Auth flow only. The production sign-in page still uses the existing NextAuth route.
        </p>
        <div className="button-row">
          <button className="button" onClick={startWorkspaceGoogle} type="button" disabled={flowState !== "idle"}>
            {flowState === "workspace" ? "Opening Google..." : "Continue with Google (zodl.com)"}
          </button>
          <button className="button button-secondary" onClick={startGuestGoogle} type="button" disabled={flowState !== "idle"}>
            {flowState === "guest" ? "Opening Google..." : "Continue with Google (Guest)"}
          </button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}
