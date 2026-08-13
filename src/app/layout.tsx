import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SidebarLayout from "@/components/SidebarLayout";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "RF Transparent Tools",
    template: "%s | RF Tools",
  },
  description: "Internal tools for RF Transparent",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "RF Tools",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#1c1917",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen">
        <SidebarLayout>{children}</SidebarLayout>
      </body>
    </html>
  );
}
