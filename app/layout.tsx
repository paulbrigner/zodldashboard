import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZODL Team Dashboards",
  description: "ZODL Team Dashboards for X monitoring, compliance operations, and risk workflows.",
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
