import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XMonitor Dashboard",
  description: "XMonitor Stream A dashboard, migration API, and feed UI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
