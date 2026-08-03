import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import AccountForm from "@/components/admin/settings/AccountForm";
import { getAccountPreferences, getPreferredName } from "@/lib/account-preferences";
import { getProfileAvatarUrl } from "@/lib/profile-avatar";

export const metadata: Metadata = {
  title: "Account & Preferences | Settings",
  robots: { index: false, follow: false },
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Toronto",
});

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  year: "numeric",
  timeZone: "America/Toronto",
});

function formatDate(value: string | undefined, formatter: Intl.DateTimeFormat): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : formatter.format(date);
}

function providerLabel(user: Awaited<ReturnType<typeof getAuthenticatedUser>>): string {
  const providers = user?.app_metadata.providers;
  const provider = Array.isArray(providers) ? providers[0] : user?.app_metadata.provider;
  if (provider === "google") return "Google";
  if (provider === "email") return "Email and password";
  return typeof provider === "string" && provider
    ? `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`
    : "Secure account";
}

export default async function AccountPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const email = user.email ?? "";
  const displayName = getPreferredName(user.user_metadata) ?? email.split("@")[0] ?? "My account";

  return (
    <div className="mx-auto max-w-6xl">
      <AccountForm
        email={email}
        displayName={displayName}
        avatarUrl={getProfileAvatarUrl(user.user_metadata)}
        providerLabel={providerLabel(user)}
        lastSignInLabel={formatDate(user.last_sign_in_at, dateTimeFormatter)}
        memberSinceLabel={formatDate(user.created_at, dateFormatter)}
        initialPreferences={getAccountPreferences(user.user_metadata)}
      />
    </div>
  );
}
