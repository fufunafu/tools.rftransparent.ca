"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { amazonPasswordProblem } from "@/lib/amazon/security-policy";

type SecurityState = { mfaVerified: boolean; recentMfa: boolean; passwordCurrent: boolean; passwordExpiresAt: string | null; ready: boolean };
type Factor = { id: string; friendly_name?: string };
const field = "w-full rounded-lg border border-sand-300 bg-white px-3 py-2";
const button = "rounded-lg bg-sand-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const auth = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!).auth;

async function readState(): Promise<SecurityState> {
  const response = await fetch("/api/amazon/security", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Security setup could not be loaded.");
  return body;
}

export default function AmazonSecuritySetup() {
  const [state, setState] = useState<SecurityState | null>(null);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [factorId, setFactorId] = useState("");
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; setupKey: string; appleUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nonce, setNonce] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const initial = await readState();
        const result = await auth().mfa.listFactors();
        if (result.error) throw new Error("Authenticator settings could not be loaded.");
        if (!cancelled) {
          setState(initial);
          setFactors(result.data.totp);
          setFactorId(result.data.totp[0]?.id ?? "");
        }
      } catch (problem) { if (!cancelled) setError(problem instanceof Error ? problem.message : "Security setup could not be loaded."); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (problem) { setError(problem instanceof Error ? problem.message : "Please try again."); }
    finally { setBusy(false); }
  }

  async function enroll() {
    const result = await auth().mfa.enroll({ factorType: "totp", friendlyName: `RF Tools ${new Date().toISOString()}`, issuer: "RF Tools" });
    if (result.error) throw new Error("Authenticator enrollment failed. Check your account's MFA settings or contact the administrator.");
    const svg = result.data.totp.qr_code.replace(/^data:image\/svg\+xml;utf-8,/, "");
    const appleUrl = new URL(result.data.totp.uri);
    appleUrl.protocol = "apple-otpauth:";
    appleUrl.searchParams.set("issuer", window.location.hostname);
    setEnrollment({ id: result.data.id, qr: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, setupKey: result.data.totp.secret, appleUrl: appleUrl.toString() });
    setFactorId(result.data.id);
  }

  async function verifyCode() {
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit code from your authenticator.");
    const result = await auth().mfa.challengeAndVerify({ factorId, code });
    setCode("");
    if (result.error) throw new Error("That code could not be verified. Try the next code from your authenticator.");
    setEnrollment(null);
    const updated = await readState();
    setState(updated);
    setMessage("Authenticator verified.");
  }

  async function savePassword() {
    const problem = amazonPasswordProblem(password);
    if (problem) throw new Error(problem);
    if (password !== confirm) throw new Error("The new passwords do not match.");
    try {
      const response = await fetch("/api/amazon/security", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, ...(currentPassword ? { currentPassword } : {}), ...(nonce ? { nonce } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Password update failed.");
      setState(await readState());
      setMessage("Password updated. Annual rotation is now enforced for Amazon access.");
    } finally { setPassword(""); setConfirm(""); setCurrentPassword(""); setNonce(""); }
  }

  return <div className="mx-auto max-w-xl space-y-6 p-4">
    <header><h1 className="text-2xl font-semibold">Secure your Amazon access</h1><p className="mt-2 text-sm text-sand-600">Amazon tools require an approved staff account, an authenticator code, and a strong password changed at least every 365 days.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    {!state && !error && <p>Checking your access…</p>}
    {state && <>
      <section className="space-y-3 rounded-xl border border-sand-200 p-4">
        <h2 className="font-semibold">1. Verify your authenticator</h2>
        {state.mfaVerified && <p className="text-sm text-green-800">This session has completed two-step verification.</p>}
        {!factorId && <button className={button} disabled={busy} onClick={() => void run(enroll)}>Set up an authenticator</button>}
        {enrollment && <div className="space-y-3">
          <a href={enrollment.appleUrl} className={`${button} inline-block`}>Add to Apple Passwords</a>
          <p className="text-sm">On a Mac, open Apple Passwords and choose your RF Tools account. Copy its six-digit verification code into the field below. A phone is not required.</p>
          <details className="text-sm"><summary className="cursor-pointer underline">Enter a setup key manually</summary>
            <p className="my-2">In Passwords, select your RF Tools login, click Edit, then Set Up Code. Paste this key and choose Use Setup Key. Other authenticator apps can use the same key.</p>
            <label className="block">Authenticator setup key<input className={`${field} mt-1 font-mono`} value={enrollment.setupKey} readOnly autoComplete="off" spellCheck={false} onFocus={(event) => event.currentTarget.select()} /></label>
            <p className="mt-2 text-xs text-sand-600">Keep this key private. It disappears from this page after verification or cancellation.</p>
          </details>
          <p className="text-sm">Or scan this code with an authenticator on your own device.</p>
          {/* This QR is generated by Supabase and rendered locally, never sent to an image service. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qr} alt="Scan to add RF Tools to your authenticator" width={220} height={220} />
          <button type="button" className="text-sm underline" disabled={busy} onClick={() => void run(async () => {
            const result = await auth().mfa.unenroll({ factorId: enrollment.id });
            if (result.error) throw new Error("Enrollment could not be cancelled.");
            setEnrollment(null); setFactorId(factors[0]?.id ?? "");
          })}>Cancel this enrollment</button>
        </div>}
        {factors.length > 1 && !enrollment && <label className="block text-sm">Authenticator<select className={field} value={factorId} disabled={busy} onChange={(event) => setFactorId(event.target.value)}>{factors.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendly_name || "Authenticator"}</option>)}</select></label>}
        {factorId && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run(verifyCode); }}>
          <label className="block text-sm">Six-digit code<input className={field} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label>
          <button className={button} disabled={busy || code.length !== 6}>Verify code</button>
        </form>}
        <p className="text-xs text-sand-500">A fresh code is required within five minutes of a password change. If you lose your authenticator, contact the administrator for identity verification and recovery.</p>
      </section>
      <section className="space-y-3 rounded-xl border border-sand-200 p-4">
        <h2 className="font-semibold">2. Set your annual password</h2>
        {state.passwordCurrent && <p className="text-sm text-green-800">Password meets the policy. Renew by {new Date(state.passwordExpiresAt!).toLocaleDateString()}.</p>}
        <p className="text-sm text-sand-600">Use at least 12 characters, including uppercase and lowercase letters, a number, and a special character. This changes your RF Tools sign-in password.</p>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run(savePassword); }}>
          <label className="block text-sm">Current password, if requested by your account<input className={field} type="password" autoComplete="current-password" value={currentPassword} disabled={busy || !state.mfaVerified} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label className="block text-sm">New password<input className={field} type="password" autoComplete="new-password" minLength={12} maxLength={72} value={password} disabled={busy || !state.mfaVerified} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label className="block text-sm">Confirm new password<input className={field} type="password" autoComplete="new-password" value={confirm} disabled={busy || !state.mfaVerified} onChange={(event) => setConfirm(event.target.value)} required /></label>
          <details className="text-sm"><summary>Account asks for email reauthentication</summary><button type="button" className="my-2 underline" disabled={busy || !state.mfaVerified} onClick={() => void run(async () => {
            const result = await auth().reauthenticate();
            if (result.error) throw new Error("Reauthentication email could not be sent.");
            setMessage("Check your account email for the verification code.");
          })}>Send email verification code</button><label className="block">Email verification code<input className={field} autoComplete="one-time-code" value={nonce} onChange={(event) => setNonce(event.target.value)} /></label></details>
          <button className={button} disabled={busy || !state.mfaVerified || !password || !confirm}>Update password</button>
        </form>
      </section>
      {state.ready && <a href="/amazon" className={`${button} inline-block`}>Open Amazon tools</a>}
    </>}
  </div>;
}
