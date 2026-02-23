"use client";

import { useEffect, useState } from "react";

type FeedUpdateIndicatorProps = {
  pollUrl: string;
  refreshUrl: string;
  initialLatestKey: string | null;
};

type FeedPollResponse = {
  items?: Array<{
    status_id?: string;
    discovered_at?: string;
  }>;
};

const POLL_INTERVAL_MS = 3 * 60 * 1000;

function latestKeyFromPayload(payload: FeedPollResponse): string | null {
  const item = payload.items?.[0];
  if (!item?.status_id || !item.discovered_at) {
    return null;
  }
  return `${item.discovered_at}|${item.status_id}`;
}

export function FeedUpdateIndicator({ pollUrl, refreshUrl, initialLatestKey }: FeedUpdateIndicatorProps) {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    let disposed = false;

    async function checkForUpdate(): Promise<void> {
      if (document.visibilityState !== "visible" || disposed || hasUpdate) {
        return;
      }

      setIsChecking(true);
      try {
        const response = await fetch(pollUrl, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as FeedPollResponse;
        const latestKey = latestKeyFromPayload(payload);
        if (latestKey && latestKey !== initialLatestKey) {
          setHasUpdate(true);
        }
      } catch {
        // Best-effort polling only. Ignore transient network failures.
      } finally {
        if (!disposed) {
          setIsChecking(false);
        }
      }
    }

    // First check after one full interval so page load itself is not doubled.
    const firstCheck = window.setTimeout(checkForUpdate, POLL_INTERVAL_MS);
    const intervalId = window.setInterval(checkForUpdate, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearTimeout(firstCheck);
      window.clearInterval(intervalId);
    };
  }, [hasUpdate, initialLatestKey, pollUrl]);

  return (
    <div className="update-inline" aria-live="polite">
      <span aria-hidden="true" className={hasUpdate ? "update-dot update-dot-live" : "update-dot"} />
      <p className="subtle-text update-inline-text">
        {hasUpdate ? "New data available" : isChecking ? "Checking..." : "Up to date"}
      </p>
      <button
        className={hasUpdate ? "button button-small" : "button button-small button-disabled"}
        disabled={!hasUpdate}
        onClick={() => {
          window.location.assign(refreshUrl);
        }}
        type="button"
      >
        Refresh
      </button>
    </div>
  );
}
