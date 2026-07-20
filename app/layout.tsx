import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZODL Team Dashboards",
  description: "Access-controlled ZODL team dashboards for X monitoring and operational workflows.",
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
