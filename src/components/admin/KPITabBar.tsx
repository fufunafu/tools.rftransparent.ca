"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/sales", label: "Sales" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/marketing", label: "Marketing" },
  { href: "/warehouse", label: "Warehouse" },
  { href: "/customer-service", label: "Customer Service" },
  { href: "/accounting", label: "Accounting" },
];

export default function KPITabBar() {
  const pathname = usePathname();

  return (
    <div className="flex border-b border-slate-200">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-5 py-3 text-sm font-medium transition-colors relative ${
              active
                ? "text-blue-600"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {t.label}
            {active && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
