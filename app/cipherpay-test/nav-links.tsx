"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/cipherpay-test", label: "Overview" },
  { href: "/cipherpay-test/storefront", label: "Storefront" },
  { href: "/cipherpay-test/admin", label: "Admin" },
];

export function CipherPayTestNavLinks() {
  const pathname = usePathname();

  return (
    <nav className="cipherpay-nav" aria-label="CipherPay Test sections">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={`button button-secondary button-small cipherpay-nav-link ${isActive ? "cipherpay-nav-link-active" : ""}`}
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
