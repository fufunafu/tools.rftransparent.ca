import type { Metadata, Viewport } from "next";
import "./globals.css";
import SidebarLayout from "@/components/SidebarLayout";
import NativeAppRuntime from "@/components/NativeAppRuntime";
import PushRegistrar from "@/components/PushRegistrar";

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
  themeColor: "#1e3a8a",
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
    <html lang="en">
      <body className="min-h-screen">
        <NativeAppRuntime>
          <PushRegistrar />
          <SidebarLayout>{children}</SidebarLayout>
        </NativeAppRuntime>
      </body>
    </html>
  );
}
