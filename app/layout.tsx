import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XMonitor Dashboard",
  description: "ZODL Team Dashboards for monitoring and operations.",
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
