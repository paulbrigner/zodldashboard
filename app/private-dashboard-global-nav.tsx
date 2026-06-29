"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  DashboardUpdateSubscriptionToggle,
  type DashboardUpdateSubscriptionToggleProps,
} from "./dashboard-update-subscription-toggle";
import { SignOutButton } from "./sign-out-button";
import type { AuthSessionProvider } from "@/lib/server-auth-session";

export type PrivateDashboardGlobalNavItem = {
  href: string;
  label: string;
  active?: boolean;
  prefetch?: boolean;
};

type PrivateDashboardGlobalNavProps = {
  items: PrivateDashboardGlobalNavItem[];
  canSignOut: boolean;
  authProvider?: AuthSessionProvider;
  updateNotifications?: DashboardUpdateSubscriptionToggleProps;
};

function linkClassName(active?: boolean): string {
  return `private-dashboard-link${active ? " private-dashboard-link-active" : ""}`;
}

function menuLinkClassName(active?: boolean): string {
  return `private-dashboard-menu-link${active ? " private-dashboard-menu-link-active" : ""}`;
}

export function PrivateDashboardGlobalNav({ items, canSignOut, authProvider = "next-auth", updateNotifications }: PrivateDashboardGlobalNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpen]);

  return (
    <div className="private-dashboard-actions">
      <nav className="private-dashboard-links private-dashboard-links-desktop" aria-label="Dashboard navigation">
        {items.map((item) => (
          <Link
            aria-current={item.active ? "page" : undefined}
            className={linkClassName(item.active)}
            href={item.href}
            key={item.href}
            prefetch={item.prefetch}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {updateNotifications ? (
        <DashboardUpdateSubscriptionToggle {...updateNotifications} className="private-dashboard-notify-desktop" />
      ) : null}

      <div className="private-dashboard-menu" ref={menuRef}>
        <button
          aria-controls={menuId}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close dashboard navigation" : "Open dashboard navigation"}
          className="private-dashboard-menu-button"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          <span className="private-dashboard-menu-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="sr-only">Dashboard navigation</span>
        </button>

        {menuOpen ? (
          <div className="private-dashboard-menu-panel" id={menuId}>
            <nav className="private-dashboard-menu-links" aria-label="Dashboard navigation">
              {items.map((item) => (
                <Link
                  aria-current={item.active ? "page" : undefined}
                  className={menuLinkClassName(item.active)}
                  href={item.href}
                  key={item.href}
                  onClick={() => setMenuOpen(false)}
                  prefetch={item.prefetch}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            {updateNotifications ? (
              <DashboardUpdateSubscriptionToggle {...updateNotifications} className="private-dashboard-menu-notify" />
            ) : null}
            {canSignOut ? (
              <SignOutButton authProvider={authProvider} className="button button-secondary private-dashboard-menu-signout" />
            ) : null}
          </div>
        ) : null}
      </div>

      {canSignOut ? (
        <SignOutButton authProvider={authProvider} className="button button-secondary private-dashboard-signout-desktop" />
      ) : null}
    </div>
  );
}
