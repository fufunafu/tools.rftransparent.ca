import type { Metadata, Viewport } from "next";
import "./globals.css";
import SidebarLayout from "@/components/SidebarLayout";
import NativeAppRuntime from "@/components/NativeAppRuntime";
import PushRegistrar from "@/components/PushRegistrar";
import { isDemoWorkspace } from "@/lib/review-workspace";

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
          <SidebarLayout>
            {isDemoWorkspace() && (
              <div className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-center text-sm text-blue-950" role="status">
                Demo workspace. All records and actions use sample data.
              </div>
            )}
            {children}
          </SidebarLayout>
        </NativeAppRuntime>
      </body>
    </html>
  );
}
