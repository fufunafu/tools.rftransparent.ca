import type { Metadata } from "next";
import Link from "next/link";
import PublicInfoLayout from "@/components/PublicInfoLayout";

export const metadata: Metadata = {
  title: "Support",
  description: "Support information for RF Transparent Tools.",
  robots: { index: true, follow: true },
};

function HelpCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-6 text-slate-600">{children}</div>
    </section>
  );
}

export default function SupportPage() {
  return (
    <PublicInfoLayout
      eyebrow="RF Tools support"
      title="Help with your account or app"
      intro="RF Tools is available to authorized RF Transparent personnel. Use the guidance below for common sign-in, connection, location, and notification issues."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <HelpCard title="Sign-in help">
          <p>Use the work email and password provided by your manager. Google sign-in is available in a regular browser, but the iOS app uses email and password.</p>
          <p>If your password is missing or your account is not authorized, ask a manager to confirm your employee profile and access.</p>
        </HelpCard>
        <HelpCard title="Connection problems">
          <p>Confirm Wi-Fi or cellular data is available, then use Retry. The app shows an offline recovery screen when the live service cannot load.</p>
          <p>Clock and report actions are not saved as successful while offline.</p>
        </HelpCard>
        <HelpCard title="Location and clock-in">
          <p>Open iOS Settings, choose RF Tools, and allow location while using the app. Return to RF Tools and try clock-in again.</p>
          <p>For an inaccurate or outside-workplace result, move to an open area near the approved store and request a fresh location.</p>
        </HelpCard>
        <HelpCard title="Face ID and notifications">
          <p>Set up Face ID, Touch ID, or a device passcode in iOS Settings to unlock a returning signed-in session.</p>
          <p>Notification access can be changed at any time in iOS Settings without affecting normal app access.</p>
        </HelpCard>
      </div>

      <section className="rounded-2xl bg-blue-950 px-6 py-6 text-white">
        <h2 className="text-xl font-bold">Contact support</h2>
        <p className="mt-2 text-sm leading-6 text-blue-100">Include your name, app version and build number from More, the screen you were using, and what happened. Do not email passwords or sensitive customer information.</p>
        <address className="mt-4 not-italic text-sm leading-6 text-blue-100">
          <span className="block font-bold text-white">15041074 Canada Inc., operating as RF Transparent</span>
          <span className="block">67 Westmore Drive, Unit 19</span>
          <span className="block">Etobicoke, Ontario, Canada</span>
          <a className="block font-semibold text-white underline underline-offset-2" href="tel:+14166134388">+1 416 613 4388</a>
          <a className="block font-semibold text-white underline underline-offset-2" href="mailto:info@glass-railing.com?subject=RF%20Tools%20support">info@glass-railing.com</a>
        </address>
        <a href="mailto:info@glass-railing.com?subject=RF%20Tools%20support" className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-white px-5 text-sm font-bold text-blue-950 hover:bg-blue-50">
          Email support
        </a>
      </section>

      <p className="text-sm text-slate-600">For information about how the app handles personal information, read the <Link href="/privacy" className="font-semibold text-blue-700 underline underline-offset-2">RF Tools Privacy Policy</Link>.</p>
    </PublicInfoLayout>
  );
}
