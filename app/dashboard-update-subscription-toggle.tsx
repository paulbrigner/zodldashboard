"use client";

import { useState } from "react";

export type DashboardUpdateSubscriptionToggleProps = {
  dashboardId: string;
  dashboardName: string;
  initialEnabled: boolean;
  available?: boolean;
  className?: string;
};

export function DashboardUpdateSubscriptionToggle({
  dashboardId,
  dashboardName,
  initialEnabled,
  available = true,
  className,
}: DashboardUpdateSubscriptionToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(available ? null : "Unavailable");

  async function toggle() {
    if (saving || !available) return;
    const nextEnabled = !enabled;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/dashboard-update-subscriptions", {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          dashboard_id: dashboardId,
          enabled: nextEnabled,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { subscription?: { enabled?: boolean }; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error || "Could not save email updates");
      }
      setEnabled(body?.subscription?.enabled === true);
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save email updates");
    } finally {
      setSaving(false);
    }
  }

  const label = enabled ? "Email updates on" : "Email updates off";

  return (
    <div className={`dashboard-update-control${className ? ` ${className}` : ""}`}>
      <button
        aria-label={`${label} for ${dashboardName}`}
        aria-pressed={enabled}
        className={`dashboard-update-toggle${enabled ? " dashboard-update-toggle-active" : ""}`}
        disabled={saving || !available}
        onClick={() => void toggle()}
        type="button"
      >
        <span className="dashboard-update-toggle-dot" aria-hidden="true" />
        <span>{saving ? "Saving updates" : label}</span>
      </button>
      {message ? <span className="dashboard-update-status">{message}</span> : null}
    </div>
  );
}
