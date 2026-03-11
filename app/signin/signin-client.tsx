"use client";

import { signIn } from "next-auth/react";

const errorText: Record<string, string> = {
  AccessDenied: "Access denied. Use a verified account from the allowed company domain or the configured guest allowlist.",
  OAuthSignin: "Google sign-in could not start. Check OAuth client and callback URL settings.",
  OAuthCallback: "Google rejected the callback. This can be policy or consent-screen related.",
  OAuthCreateAccount: "Failed while creating a session from the Google profile.",
  Callback: "Authentication callback failed.",
  Default: "Sign-in failed. Check your OAuth setup and try again.",
};

type SignInClientProps = {
  error: string | null;
  guestOauthEnabled: boolean;
};

export default function SignInClient({ error, guestOauthEnabled }: SignInClientProps) {
  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">Google Workspace Login</p>
        <h1>Sign in</h1>
        <p>Use your company Google account to continue. Guest Google sign-in may also be available when enabled.</p>
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
        {error ? <p className="error-text">{errorText[error] || errorText.Default}</p> : null}
      </section>
    </main>
  );
}
