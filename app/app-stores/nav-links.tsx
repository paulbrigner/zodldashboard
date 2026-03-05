"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/app-stores", label: "Overview" },
  { href: "/app-stores/submissions", label: "Submissions" },
  { href: "/app-stores/declarations", label: "Declarations & Licensing" },
  { href: "/app-stores/matrix", label: "Feature-to-Claim Matrix" },
  { href: "/app-stores/reviewer-comms", label: "Reviewer Comms / Cases" },
  { href: "/app-stores/evidence-vault", label: "Evidence Vault" },
  { href: "/app-stores/settings", label: "Settings" },
];

export function AppStoresNavLinks() {
  const pathname = usePathname();

  return (
    <nav className="appstores-nav" aria-label="App Stores sections">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={`button button-secondary button-small appstores-nav-link ${isActive ? "appstores-nav-link-active" : ""}`}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
