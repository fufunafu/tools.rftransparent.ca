import type { Metadata } from "next";
import LoginForm from "@/components/admin/LoginForm";

export const metadata: Metadata = {
  title: "Login | RF Tools",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm mx-auto px-6">
        <h1 className="text-xl font-semibold text-slate-900 mb-6 text-center">
          RF Transparent Tools
        </h1>
        <LoginForm />
      </div>
    </div>
  );
}
