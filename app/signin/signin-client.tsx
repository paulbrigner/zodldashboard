"use client";

import { useState, type FormEvent } from "react";
import { BETTER_AUTH_BASE_PATH, BETTER_AUTH_GUEST_GOOGLE_PROVIDER_ID } from "@/lib/better-auth-constants";

const errorText: Record<string, string> = {
  AccessDenied: "Access denied. Use a verified account from the allowed company domain or the configured guest allowlist.",
  EMAIL_NOT_AUTHORIZED: "This email address is not authorized for ZODL Dashboard.",
  OAuthSignin: "Google sign-in could not start. Check OAuth client and callback URL settings.",
  OAuthCallback: "Google rejected the callback. This can be policy or consent-screen related.",
  OAuthCreateAccount: "Failed while creating a session from the Google profile.",
  EmailSignin: "Email link sign-in could not start. Check the guest magic-link configuration.",
  INVALID_TOKEN: "That sign-in link is invalid or expired. Request a new one and try again.",
  Verification: "That sign-in link is invalid or expired. Request a new one and try again.",
  Callback: "Authentication callback failed.",
  Default: "Sign-in failed. Check your OAuth setup and try again.",
};

type FlowState = "idle" | "workspace" | "guest" | "email";

type BetterAuthResponse = {
  status?: boolean;
  url?: string;
  message?: string;
  error?: string;
};

type SignInClientProps = {
  error: string | null;
  guestOauthEnabled: boolean;
  guestEmailEnabled: boolean;
};

async function postBetterAuth(path: string, body: Record<string, unknown>): Promise<BetterAuthResponse> {
  const response = await fetch(`${BETTER_AUTH_BASE_PATH}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as BetterAuthResponse | null;
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Sign-in request failed with HTTP ${response.status}.`);
  }
  return payload || {};
}

async function startBetterAuthRedirect(path: string, body: Record<string, unknown>): Promise<void> {
  const payload = await postBetterAuth(path, body);
  if (!payload.url) {
    throw new Error(payload.message || payload.error || "Google sign-in could not start.");
  }
  window.location.assign(payload.url);
}

export default function SignInClient({ error, guestOauthEnabled, guestEmailEnabled }: SignInClientProps) {
  const [guestEmail, setGuestEmail] = useState("");
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [clientError, setClientError] = useState<string | null>(null);

  async function startWorkspaceGoogle() {
    setFlowState("workspace");
    setClientError(null);
    try {
      await startBetterAuthRedirect("/sign-in/social", {
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/signin",
      });
    } catch (caught) {
      setClientError(caught instanceof Error ? caught.message : "Workspace Google sign-in failed.");
      setFlowState("idle");
    }
  }

  async function startGuestGoogle() {
    setFlowState("guest");
    setClientError(null);
    try {
      await startBetterAuthRedirect("/sign-in/oauth2", {
        providerId: BETTER_AUTH_GUEST_GOOGLE_PROVIDER_ID,
        callbackURL: "/",
        errorCallbackURL: "/signin",
      });
    } catch (caught) {
      setClientError(caught instanceof Error ? caught.message : "Guest Google sign-in failed.");
      setFlowState("idle");
    }
  }

  async function handleGuestEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = guestEmail.trim().toLowerCase();
    if (!normalized) return;

    setFlowState("email");
    setClientError(null);
    try {
      const payload = await postBetterAuth("/sign-in/magic-link", {
        email: normalized,
        callbackURL: "/",
        errorCallbackURL: "/signin",
      });
      if (payload.status !== true) {
        throw new Error(payload.message || payload.error || "Email link sign-in could not start.");
      }
      window.location.assign("/signin/verify-request");
    } catch (caught) {
      setClientError(caught instanceof Error ? caught.message : "Email link sign-in could not start.");
      setFlowState("idle");
    }
  }

  function displayedError(): string | null {
    if (clientError) return clientError;
    if (!error) return null;
    return errorText[error] || errorText.Default;
  }

  const pending = flowState !== "idle";
  const errorMessage = displayedError();

  function buttonText(flow: FlowState, idleText: string): string {
    if (flowState === flow) {
      return flow === "email" ? "Sending link..." : "Opening Google...";
    }
    return idleText;
  }

  return (
    <main className="page">
      <section className="card">
        <div className="brand-lockup" aria-label="Zodl and Zcash">
          <img className="brand-logo brand-logo-zodl" src="/brand/zodl-logo-black.png" alt="Zodl" width={1673} height={344} />
          <span className="brand-divider" aria-hidden="true" />
          <img className="brand-logo brand-logo-zcash" src="/brand/zcash-logo.svg" alt="Zcash" width={65} height={65} />
        </div>
        <p className="eyebrow">ZODL Dashboard Login</p>
        <h1>Sign in</h1>
        <p>Use your company Google account to continue. Guest sign-in may also be available through Google or an emailed magic link when pre-authorized. Email paul@zodl.com to request guest access.</p>
        <div className="button-row">
          <button className="button" onClick={startWorkspaceGoogle} type="button" disabled={pending}>
            {buttonText("workspace", "Continue with Google (zodl.com)")}
          </button>
          {guestOauthEnabled ? (
            <button className="button button-secondary" onClick={startGuestGoogle} type="button" disabled={pending}>
              {buttonText("guest", "Continue with Google (Guest)")}
            </button>
          ) : null}
        </div>
        {guestEmailEnabled ? (
          <form className="stack" onSubmit={handleGuestEmailSubmit}>
            <label>
              <span className="eyebrow">Guest Email Link</span>
              <input
                className="input"
                type="email"
                autoComplete="email"
                placeholder="guest@example.com"
                value={guestEmail}
                onChange={(event) => setGuestEmail(event.target.value)}
                disabled={pending}
              />
            </label>
            <button className="button button-secondary" type="submit" disabled={pending || !guestEmail.trim()}>
              {buttonText("email", "Email me a guest sign-in link")}
            </button>
          </form>
        ) : null}
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      </section>
    </main>
  );
}
