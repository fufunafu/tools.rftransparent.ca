import type { Metadata } from "next";
import PublicInfoLayout from "@/components/PublicInfoLayout";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for RF Transparent Tools.",
  robots: { index: true, follow: true },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold text-slate-950">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <PublicInfoLayout
      eyebrow="Privacy policy"
      title="Your information is used to operate RF Tools"
      intro="RF Transparent Tools is a private workforce and operations application provided by 15041074 Canada Inc., operating as RF Transparent. This policy explains what the app processes, why it is needed, and the choices available to authorized users."
    >
      <p className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-blue-950">
        Effective September 17, 2026. RF Tools does not sell personal information, show advertising, or track users across other companies&apos; apps and websites.
      </p>

      <Section title="Information we process">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Account and profile information:</strong> name, work email, employee profile, department, location, role, profile image, access permissions, and authentication session.</li>
          <li><strong>Work activity:</strong> time entries, assigned tasks, warehouse reports, sales and customer-service activity, performance information, survey responses, reimbursement requests, bug reports, comments, and files submitted through authorized workflows.</li>
          <li><strong>Location at clock-in or customer visit check-in:</strong> latitude, longitude, reported accuracy, capture time, and distance from the configured workplace or saved customer site. RF Tools requests location only after the user starts a location-protected check-in. It does not continuously monitor location.</li>
          <li><strong>Field-sales information:</strong> customer appointments, store visits, odometer readings, calculated mileage, visit outcomes, notes, business contacts, and optional business-card images submitted by the user.</li>
          <li><strong>Device and app information:</strong> iOS push-notification token, app version, build number, notification preference, and limited technical information needed to deliver notifications and diagnose availability problems.</li>
        </ul>
      </Section>

      <Section title="How information is used">
        <p>We use this information to authenticate authorized personnel, enforce role-based access, record attendance, coordinate work, provide operational reporting, deliver requested notifications, protect company systems, investigate problems, and meet employment, accounting, security, and legal obligations.</p>
        <p>Location is used to confirm that a clock-in or customer visit check-in was attempted near an approved workplace or saved customer site and to retain an audit record. For a customer site without a saved location, a user can choose to establish the site pin during the first confirmed visit. An inaccurate or denied location prevents the protected check-in rather than starting background tracking.</p>
      </Section>

      <Section title="Service providers and disclosure">
        <p>RF Tools uses service providers to operate the application, including Supabase for authentication, database, and file storage; Vercel for application hosting; and Apple for App Store, TestFlight, device security, and push-notification delivery. Company workflows may also connect to approved business systems such as Google Workspace, Shopify, Meta, or communications providers when the user&apos;s role requires that work.</p>
        <p>Information may be shared with authorized managers, administrators, service providers acting on our instructions, or public authorities when required by law. It is not shared for third-party advertising.</p>
      </Section>

      <Section title="Retention and security">
        <p>Information is retained for as long as the user&apos;s account, employment relationship, operational record, security need, or legal obligation requires it. Records may then be deleted, de-identified, or archived under company retention practices.</p>
        <p>RF Tools uses encrypted transport, authenticated sessions, server-side authorization, device authentication for returning native-app sessions, restricted navigation, and access controls appropriate to the sensitivity of workforce data. No internet service can guarantee absolute security.</p>
      </Section>

      <Section title="Choices and requests">
        <p>Users can decline location or notification access in device settings. Declining notifications does not prevent normal app use. Declining location prevents location-protected clock-ins and field-sales visit check-ins, and the user should contact a manager for the approved alternative process.</p>
        <p>Authorized users may request access, correction, or deletion of eligible personal information. Accounts are provisioned by the company rather than created publicly, so account closure requests are handled by an administrator.</p>
      </Section>

      <Section title="Children and international processing">
        <p>RF Tools is intended only for authorized workforce users and is not directed to children. Information may be processed in Canada, the United States, or other locations where our service providers operate, subject to contractual and legal safeguards.</p>
      </Section>

      <Section title="Contact us">
        <p>Questions or privacy requests can be sent to <a className="font-semibold text-blue-700 underline underline-offset-2" href="mailto:info@glass-railing.com?subject=RF%20Tools%20privacy">info@glass-railing.com</a>. Please include “RF Tools privacy” in the subject line.</p>
      </Section>
    </PublicInfoLayout>
  );
}
