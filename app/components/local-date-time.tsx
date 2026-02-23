"use client";

import { useEffect, useState } from "react";

type LocalDateTimeProps = {
  iso: string;
};

function fallbackUtcText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function localText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function LocalDateTime({ iso }: LocalDateTimeProps) {
  const [text, setText] = useState<string>(() => fallbackUtcText(iso));

  useEffect(() => {
    setText(localText(iso));
  }, [iso]);

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}

