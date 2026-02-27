"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/regulatory-risk", label: "Snapshot" },
  { href: "/regulatory-risk/jurisdictions", label: "Jurisdictions" },
  { href: "/regulatory-risk/features", label: "Features" },
  { href: "/regulatory-risk/policy", label: "Policy" },
  { href: "/regulatory-risk/activity", label: "Activity" },
];

export function RegulatoryRiskNavLinks() {
  const pathname = usePathname();

  return (
    <nav className="regulatory-nav" aria-label="Regulatory Risk sections">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={`button button-secondary button-small regulatory-nav-link ${isActive ? "regulatory-nav-link-active" : ""}`}
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
