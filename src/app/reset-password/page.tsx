import type { Metadata } from "next";
import ResetPasswordForm from "@/components/admin/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password | RF Tools",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-blue-900 to-blue-950 p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-sm rounded-3xl bg-white p-7 shadow-2xl shadow-blue-950/50">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/30">
            <span className="text-xl font-bold tracking-tight text-white">RF</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Choose a new password</h1>
        </div>
        <ResetPasswordForm />
      </div>
    </div>
  );
}
