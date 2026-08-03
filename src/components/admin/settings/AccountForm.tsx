"use client";

/* Profile photos use an authenticated API route, which is not compatible with the image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useRef, useState, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  HOME_PAGE_OPTIONS,
  applyAccountPreferences,
  type AccountPreferences,
} from "@/lib/account-preferences";

const MIN_PASSWORD_LENGTH = 8;
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

interface AccountFormProps {
  email: string;
  displayName: string;
  avatarUrl: string | null;
  providerLabel: string;
  lastSignInLabel: string;
  memberSinceLabel: string;
  initialPreferences: AccountPreferences;
}

interface AccountUpdateDetail {
  displayName: string;
  avatarUrl: string | null;
  preferences: AccountPreferences;
}

function createSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email.split("@")[0] || "RF";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const initials = words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0].slice(0, 2);
  return initials.toUpperCase();
}

function ProfilePhoto({
  src,
  name,
  email,
  className,
}: {
  src: string | null;
  name: string;
  email: string;
  className: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-blue-500 font-semibold text-white ${className}`}
    >
      {src ? (
        <img src={src} alt={`${name || email} profile`} className="h-full w-full object-cover" />
      ) : (
        initialsFor(name, email)
      )}
    </span>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
        {icon}
      </span>
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function ChoiceButton({
  selected,
  onClick,
  title,
  description,
  preview,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  preview?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`relative flex min-h-[82px] w-full items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
        selected
          ? "border-blue-500 bg-blue-50/70 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {preview}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-slate-500">{description}</span>
      </span>
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          selected ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white"
        }`}
        aria-hidden="true"
      >
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
    </button>
  );
}

function StatusMessage({ type, children }: { type: "success" | "error"; children: ReactNode }) {
  return (
    <div
      role={type === "error" ? "alert" : "status"}
      className={`rounded-xl border px-3.5 py-2.5 text-sm ${
        type === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
    >
      {children}
    </div>
  );
}

export default function AccountForm({
  email,
  displayName: initialDisplayName,
  avatarUrl: initialAvatarUrl,
  providerLabel,
  lastSignInLabel,
  memberSinceLabel,
  initialPreferences,
}: AccountFormProps) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const [savedDisplayName, setSavedDisplayName] = useState(initialDisplayName);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [savedPreferences, setSavedPreferences] = useState(initialPreferences);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const [sessionsSaving, setSessionsSaving] = useState(false);
  const [sessionsMessage, setSessionsMessage] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const trimmedName = displayName.trim();
  const profileChanged =
    trimmedName !== savedDisplayName || JSON.stringify(preferences) !== JSON.stringify(savedPreferences);

  const passwordScore = !password
    ? 0
    : password.length < MIN_PASSWORD_LENGTH
      ? 1
      : Math.min(
          4,
          1 +
            [
              password.length >= 12,
              /[a-z]/.test(password) && /[A-Z]/.test(password),
              /\d/.test(password) && /[^A-Za-z0-9]/.test(password),
            ].filter(Boolean).length,
        );
  const strengthLabel = ["Start typing", "Weak", "Fair", "Good", "Strong"][passwordScore];
  const passwordMatches = confirm.length > 0 && password === confirm;

  function updatePreference<K extends keyof AccountPreferences>(
    key: K,
    value: AccountPreferences[K],
  ) {
    setProfileSaved(false);
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  function announceAccountUpdate(nextAvatarUrl: string | null) {
    window.dispatchEvent(
      new CustomEvent<AccountUpdateDetail>("rf:account-updated", {
        detail: {
          displayName: displayName.trim() || savedDisplayName,
          avatarUrl: nextAvatarUrl,
          preferences,
        },
      }),
    );
  }

  async function uploadAvatar(file: File) {
    setAvatarSaving(true);
    setAvatarError(null);
    setAvatarMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/settings/account/avatar", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.avatarUrl !== "string") {
        throw new Error(data.error ?? "Could not upload the profile photo.");
      }

      await createSupabaseClient().auth.refreshSession();
      setAvatarUrl(data.avatarUrl);
      setAvatarMessage("Profile photo updated.");
      announceAccountUpdate(data.avatarUrl);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Could not upload the profile photo.");
    } finally {
      setAvatarSaving(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function removeAvatar() {
    setAvatarSaving(true);
    setAvatarError(null);
    setAvatarMessage(null);
    try {
      const res = await fetch("/api/settings/account/avatar", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not remove the profile photo.");

      await createSupabaseClient().auth.refreshSession();
      setAvatarUrl(null);
      setAvatarMessage("Profile photo removed.");
      announceAccountUpdate(null);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Could not remove the profile photo.");
    } finally {
      setAvatarSaving(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileSaved(false);

    if (trimmedName.length < 2) {
      setProfileError("Display name must be at least 2 characters.");
      return;
    }

    setProfileSaving(true);
    try {
      const supabase = createSupabaseClient();
      const { error } = await supabase.auth.updateUser({
        data: {
          display_name: trimmedName,
          rf_preferences: preferences,
        },
      });
      if (error) throw new Error(error.message);

      setSavedDisplayName(trimmedName);
      setSavedPreferences(preferences);
      setDisplayName(trimmedName);
      setProfileSaved(true);
      applyAccountPreferences(preferences);
      window.dispatchEvent(
        new CustomEvent<AccountUpdateDetail>("rf:account-updated", {
          detail: { displayName: trimmedName, avatarUrl, preferences },
        }),
      );
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not save your preferences.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setPasswordError("The two passwords do not match.");
      return;
    }

    setPasswordSaving(true);
    try {
      const supabase = createSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      setPassword("");
      setConfirm("");
      setPasswordSaved(true);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Could not change the password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function signOutOtherSessions() {
    setSessionsSaving(true);
    setSessionsError(null);
    setSessionsMessage(null);
    try {
      const supabase = createSupabaseClient();
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw new Error(error.message);
      setSessionsMessage("Other sessions have been signed out.");
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Could not sign out other sessions.");
    } finally {
      setSessionsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">Settings</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Account and preferences</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
            Manage your identity, personalize the workspace, and keep your sign-in secure.
          </p>
        </div>
        <a
          href="/api/logout"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        >
          Sign out
        </a>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-5 text-white shadow-soft-lg sm:p-6">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(circle at 85% 15%, rgba(59,130,246,0.28), transparent 34%), radial-gradient(circle at 15% 100%, rgba(14,165,233,0.16), transparent 36%)",
          }}
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <ProfilePhoto
            src={avatarUrl}
            name={displayName}
            email={email}
            className="h-16 w-16 rounded-2xl text-xl shadow-lg shadow-blue-950/40 ring-1 ring-white/20"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold">{displayName || email}</h2>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                Active
              </span>
            </div>
            <p className="mt-1 truncate text-sm text-slate-300">{email}</p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
              <span>
                <span className="text-slate-500">Sign-in</span> {providerLabel}
              </span>
              <span>
                <span className="text-slate-500">Last active</span> {lastSignInLabel}
              </span>
              <span>
                <span className="text-slate-500">Member since</span> {memberSinceLabel}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <form onSubmit={saveProfile} className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeading
              icon={<ProfileIcon />}
              title="Profile"
              description="Choose how your photo and name appear across the workspace."
            />
            <div className="mt-5 flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center">
              <ProfilePhoto
                src={avatarUrl}
                name={displayName}
                email={email}
                className="h-14 w-14 rounded-full text-base ring-2 ring-white shadow-sm"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">Profile photo</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">
                  JPG, PNG, or WebP up to 5 MB. Square photos work best.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadAvatar(file);
                    }}
                  />
                  <button
                    type="button"
                    disabled={avatarSaving}
                    onClick={() => avatarInputRef.current?.click()}
                    className="text-xs font-semibold text-blue-600 transition hover:text-blue-700 disabled:text-slate-400"
                  >
                    {avatarSaving ? "Working…" : avatarUrl ? "Change photo" : "Upload photo"}
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      disabled={avatarSaving}
                      onClick={() => void removeAvatar()}
                      className="text-xs font-semibold text-red-600 transition hover:text-red-700 disabled:text-slate-400"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
            {avatarError && <div className="mt-3"><StatusMessage type="error">{avatarError}</StatusMessage></div>}
            {avatarMessage && !avatarError && (
              <div className="mt-3"><StatusMessage type="success">{avatarMessage}</StatusMessage></div>
            )}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-700">Display name</span>
                <input
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    setProfileSaved(false);
                  }}
                  maxLength={80}
                  autoComplete="name"
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-700">Email address</span>
                <input
                  type="email"
                  value={email}
                  readOnly
                  aria-describedby="email-help"
                  className={`${INPUT_CLASS} cursor-not-allowed bg-slate-50 text-slate-500 shadow-none`}
                />
                <span id="email-help" className="mt-1.5 block text-[11px] text-slate-400">
                  Managed by your sign-in provider.
                </span>
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeading
              icon={<SlidersIcon />}
              title="Workspace preferences"
              description="These preferences follow your account on every device."
            />

            <fieldset className="mt-6">
              <legend className="text-xs font-semibold text-slate-800">Home page</legend>
              <p className="mt-1 text-xs text-slate-500">Where the RF logo takes you and where new sign-ins begin.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {HOME_PAGE_OPTIONS.map((option) => (
                  <ChoiceButton
                    key={option.value}
                    selected={preferences.homePage === option.value}
                    onClick={() => updatePreference("homePage", option.value)}
                    title={option.label}
                    description={option.description}
                  />
                ))}
              </div>
            </fieldset>

            <div className="my-6 h-px bg-slate-100" />

            <div className="grid gap-6 sm:grid-cols-2">
              <fieldset>
                <legend className="text-xs font-semibold text-slate-800">Page canvas</legend>
                <p className="mt-1 text-xs text-slate-500">Choose the background behind your tools.</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <ChoiceButton
                    selected={preferences.canvasTone === "soft"}
                    onClick={() => updatePreference("canvasTone", "soft")}
                    title="Soft"
                    description="Light gray"
                    preview={<CanvasPreview tone="soft" />}
                  />
                  <ChoiceButton
                    selected={preferences.canvasTone === "clean"}
                    onClick={() => updatePreference("canvasTone", "clean")}
                    title="Clean"
                    description="Pure white"
                    preview={<CanvasPreview tone="clean" />}
                  />
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs font-semibold text-slate-800">Sidebar on sign-in</legend>
                <p className="mt-1 text-xs text-slate-500">Set the default navigation width.</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <ChoiceButton
                    selected={preferences.sidebarMode === "expanded"}
                    onClick={() => updatePreference("sidebarMode", "expanded")}
                    title="Expanded"
                    description="Labels visible"
                    preview={<SidebarPreview compact={false} />}
                  />
                  <ChoiceButton
                    selected={preferences.sidebarMode === "compact"}
                    onClick={() => updatePreference("sidebarMode", "compact")}
                    title="Compact"
                    description="Icons only"
                    preview={<SidebarPreview compact />}
                  />
                </div>
              </fieldset>
            </div>

            <div className="my-6 h-px bg-slate-100" />

            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800">Reduce motion</p>
                <p className="mt-0.5 text-xs text-slate-500">Limit interface animations and smooth scrolling.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={preferences.motion === "reduced"}
                onClick={() =>
                  updatePreference(
                    "motion",
                    preferences.motion === "reduced" ? "system" : "reduced",
                  )
                }
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                  preferences.motion === "reduced" ? "bg-blue-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    preferences.motion === "reduced" ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
                <span className="sr-only">Reduce motion</span>
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {profileError && <StatusMessage type="error">{profileError}</StatusMessage>}
              {profileSaved && !profileError && (
                <StatusMessage type="success">Profile and workspace preferences saved.</StatusMessage>
              )}
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-slate-400">
                  {profileChanged ? "You have unsaved changes." : "Everything is up to date."}
                </span>
                <button
                  type="submit"
                  disabled={profileSaving || !profileChanged}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {profileSaving ? "Saving…" : "Save preferences"}
                </button>
              </div>
            </div>
          </section>
        </form>

        <div className="space-y-6">
          <form onSubmit={savePassword} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeading
              icon={<LockIcon />}
              title="Password"
              description="Add or change the password used as an alternative to Google sign-in."
            />

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-700">New password</span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setPasswordSaved(false);
                    }}
                    autoComplete="new-password"
                    className={`${INPUT_CLASS} pr-16`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-800"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden="true">
                    {[1, 2, 3, 4].map((level) => (
                      <span
                        key={level}
                        className={`h-1 rounded-full ${
                          passwordScore >= level
                            ? passwordScore >= 4
                              ? "bg-emerald-500"
                              : passwordScore >= 3
                                ? "bg-blue-500"
                                : "bg-amber-400"
                            : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] text-slate-500">{strengthLabel}</span>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-slate-400">
                  Use at least {MIN_PASSWORD_LENGTH} characters. A mix of words, numbers, and symbols is strongest.
                </p>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-700">Confirm password</span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    setPasswordSaved(false);
                  }}
                  autoComplete="new-password"
                  className={INPUT_CLASS}
                />
                {confirm && (
                  <span className={`mt-1.5 block text-[11px] ${passwordMatches ? "text-emerald-600" : "text-red-600"}`}>
                    {passwordMatches ? "Passwords match." : "Passwords do not match yet."}
                  </span>
                )}
              </label>

              {passwordError && <StatusMessage type="error">{passwordError}</StatusMessage>}
              {passwordSaved && !passwordError && (
                <StatusMessage type="success">Password changed successfully.</StatusMessage>
              )}

              <button
                type="submit"
                disabled={passwordSaving || !password || !confirm}
                className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {passwordSaving ? "Updating…" : "Update password"}
              </button>
            </div>
          </form>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeading
              icon={<ShieldIcon />}
              title="Sign-in security"
              description="Review your connected method and active sessions."
            />
            <div className="mt-5 divide-y divide-slate-100">
              <div className="flex items-center gap-3 pb-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                  {providerLabel.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{providerLabel}</p>
                  <p className="truncate text-xs text-slate-500">{email}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Connected
                </span>
              </div>
              <div className="pt-4">
                <p className="text-sm font-medium text-slate-800">Other devices</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  End every other browser session while keeping this one active.
                </p>
                {sessionsError && <div className="mt-3"><StatusMessage type="error">{sessionsError}</StatusMessage></div>}
                {sessionsMessage && !sessionsError && (
                  <div className="mt-3"><StatusMessage type="success">{sessionsMessage}</StatusMessage></div>
                )}
                <button
                  type="button"
                  onClick={signOutOtherSessions}
                  disabled={sessionsSaving}
                  className="mt-3 text-xs font-semibold text-red-600 transition hover:text-red-700 disabled:text-slate-400"
                >
                  {sessionsSaving ? "Signing out…" : "Sign out other devices"}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function CanvasPreview({ tone }: { tone: "soft" | "clean" }) {
  return (
    <span
      className={`mt-0.5 flex h-8 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 ${
        tone === "soft" ? "bg-slate-100" : "bg-white"
      }`}
      aria-hidden="true"
    >
      <span className="h-4 w-5 rounded-sm border border-slate-200 bg-white shadow-sm" />
    </span>
  );
}

function SidebarPreview({ compact }: { compact: boolean }) {
  return (
    <span className="mt-0.5 flex h-8 w-9 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50" aria-hidden="true">
      <span className={`${compact ? "w-2" : "w-3.5"} h-full bg-slate-700`} />
      <span className="flex-1" />
    </span>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.1a7.5 7.5 0 0 1 15 0A17.9 17.9 0 0 1 12 21.75c-2.68 0-5.22-.59-7.5-1.65Z" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0m-9.75 0h9.75" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 0 0-9 0v3.75m-.75 10.5h10.5A2.25 2.25 0 0 0 19.5 18.75v-6A2.25 2.25 0 0 0 17.25 10.5H6.75A2.25 2.25 0 0 0 4.5 12.75v6A2.25 2.25 0 0 0 6.75 21Z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m5.25-3c0 6.1-3.62 11.38-8.25 13.75C7.37 18.13 3.75 12.85 3.75 6.75c3.02 0 5.9-1.3 8.25-3.6 2.35 2.3 5.23 3.6 8.25 3.6Z" />
    </svg>
  );
}
