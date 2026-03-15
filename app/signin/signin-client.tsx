"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { GUEST_EMAIL_PROVIDER_ID } from "@/lib/auth-guest-email";

const errorText: Record<string, string> = {
  AccessDenied: "Access denied. Use a verified account from the allowed company domain or the configured guest allowlist.",
  OAuthSignin: "Google sign-in could not start. Check OAuth client and callback URL settings.",
  OAuthCallback: "Google rejected the callback. This can be policy or consent-screen related.",
  OAuthCreateAccount: "Failed while creating a session from the Google profile.",
  EmailSignin: "Email link sign-in could not start. Check the guest magic-link configuration.",
  Verification: "That sign-in link is invalid or expired. Request a new one and try again.",
  Callback: "Authentication callback failed.",
  Default: "Sign-in failed. Check your OAuth setup and try again.",
};

type SignInClientProps = {
  error: string | null;
  guestOauthEnabled: boolean;
  guestEmailEnabled: boolean;
};

export default function SignInClient({ error, guestOauthEnabled, guestEmailEnabled }: SignInClientProps) {
  const [guestEmail, setGuestEmail] = useState("");
  const [guestEmailPending, setGuestEmailPending] = useState(false);

  async function handleGuestEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = guestEmail.trim().toLowerCase();
    if (!normalized) return;

    setGuestEmailPending(true);
    try {
      await signIn(GUEST_EMAIL_PROVIDER_ID, {
        email: normalized,
        callbackUrl: "/",
      });
    } finally {
      setGuestEmailPending(false);
    }
  }

  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">ZODL Dashboard Login</p>
        <h1>Sign in</h1>
        <p>Use your company Google account to continue. Guest sign-in may also be available through Google or an emailed magic link when pre-authorized. Email paul@zodl.com to request guest access.</p>
        <div className="button-row">
          <button className="button" onClick={() => signIn("google", { callbackUrl: "/" })} type="button">
            Continue with Google (zodl.com)
          </button>
          {guestOauthEnabled ? (
            <button className="button button-secondary" onClick={() => signIn("google-guest", { callbackUrl: "/" })} type="button">
              Continue with Google (Guest)
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
                disabled={guestEmailPending}
              />
            </label>
            <button className="button button-secondary" type="submit" disabled={guestEmailPending || !guestEmail.trim()}>
              {guestEmailPending ? "Sending link..." : "Email me a guest sign-in link"}
            </button>
          </form>
        ) : null}
        {error ? <p className="error-text">{errorText[error] || errorText.Default}</p> : null}
      </section>
    </main>
  );
}
