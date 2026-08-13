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
    <div className="min-h-screen flex bg-gradient-to-br from-blue-900 to-blue-950 md:bg-none md:bg-white">
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

      {/* Right — sign-in panel. On phones the whole screen is the brand
          gradient (with the same dot pattern) and the form floats on a card;
          on desktop the card dissolves into the plain white pane. */}
      <div className="flex-1 relative flex flex-col md:bg-white">
        <div
          className="absolute inset-0 opacity-[0.07] md:hidden"
          style={{
            backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
          aria-hidden="true"
        />
        <div className="relative flex-1 flex items-center justify-center p-6 md:p-8">
          <div className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-2xl shadow-blue-950/50 md:rounded-none md:p-0 md:shadow-none">
            {/* Brand moment — phones only; desktop has the panel on the left */}
            <div className="md:hidden flex flex-col items-center mb-7">
              <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mb-3 shadow-lg shadow-blue-600/30">
                <span className="text-xl font-bold text-white tracking-tight">RF</span>
              </div>
              <span className="text-lg font-semibold text-slate-900">RF Transparent</span>
              <span className="text-xs text-slate-400">Internal Operations</span>
            </div>

            <h2 className="text-2xl font-semibold text-slate-900 mb-1 max-md:text-center">Welcome back</h2>
            <p className="text-sm text-slate-500 mb-7 max-md:text-center">
              Sign in to your workspace.
            </p>
            <LoginForm
              authError={authError}
              nextPath={safeNextPath(next)}
              devLogin={process.env.NODE_ENV === "development"}
            />
            <p className="text-xs text-slate-400 text-center mt-6">
              Authorized personnel only
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
