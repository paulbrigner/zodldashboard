type ViewerProxyIdentity = {
  email: string;
  authMode?: "oauth" | "local-bypass";
  mode?: "oauth" | "local-bypass";
};

function proxySecret(): string | null {
  const value = process.env.XMONITOR_USER_PROXY_SECRET;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildViewerProxyHeaders(viewer: ViewerProxyIdentity): Record<string, string> | null {
  const secret = proxySecret();
  if (!secret) return null;

  const authMode = viewer.authMode || viewer.mode;
  if (!viewer.email || !authMode) return null;

  return {
    "x-xmonitor-viewer-email": viewer.email.trim().toLowerCase(),
    "x-xmonitor-viewer-auth-mode": authMode,
    "x-xmonitor-viewer-secret": secret,
  };
}

