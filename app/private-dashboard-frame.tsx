"use client";

import { useEffect, useState } from "react";

type PrivateDashboardFrameProps = {
  className?: string;
  contentHref: string;
  title: string;
};

function frameHrefWithHash(contentHref: string): string {
  if (typeof window === "undefined" || !window.location.hash) {
    return contentHref;
  }

  const url = new URL(contentHref, window.location.origin);
  url.hash = window.location.hash.slice(1);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function PrivateDashboardFrame({ className, contentHref, title }: PrivateDashboardFrameProps) {
  const [frameHref, setFrameHref] = useState(contentHref);

  useEffect(() => {
    function syncFrameHash() {
      setFrameHref(frameHrefWithHash(contentHref));
    }

    syncFrameHash();
    window.addEventListener("hashchange", syncFrameHash);
    return () => window.removeEventListener("hashchange", syncFrameHash);
  }, [contentHref]);

  return <iframe className={className} src={frameHref} title={title} />;
}
