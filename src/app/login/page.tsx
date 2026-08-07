import type { Metadata } from "next";
import LoginForm from "@/components/admin/LoginForm";
import { safeNextPath } from "@/lib/client-auth";

export const metadata: Metadata = {
  title: "Login | RF Tools",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const authError =
    error === "session_expired"
      ? "Your session expired. Sign in to continue."
      : error === "auth_error"
      ? "Sign-in failed. Please try again."
      : error === "not_authorized"
      ? "This Google account isn't authorized. Ask your manager to add it to your employee profile."
      : undefined;

  return (
    <div className="min-h-screen flex">
      {/* Left — brand panel, desktop only */}
      <div className="hidden md:flex md:w-2/5 bg-gradient-to-br from-blue-900 to-blue-950 flex-col items-center justify-center p-12 relative overflow-hidden">
        {/* faint dot pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/15 flex items-center justify-center mb-6 ring-1 ring-white/20">
            <span className="text-2xl font-bold text-white tracking-tight">RF</span>
          </div>
          <h1 className="text-3xl font-semibold text-white mb-2">RF Transparent</h1>
          <p className="text-blue-200 text-base">Internal Operations</p>
        </div>
      </div>

      {/* Right — sign-in panel */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <span className="text-xs font-bold text-white">RF</span>
          </div>
          <span className="text-sm font-semibold text-slate-900">RF Transparent</span>
        </div>

        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-1">Sign in</h2>
            <p className="text-sm text-slate-500 mb-8">
              Use your RF Transparent Google account to continue.
            </p>
            <LoginForm authError={authError} nextPath={safeNextPath(next)} />
            <p className="text-xs text-slate-400 text-center mt-6">
              Authorized personnel only
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
