"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/warehouse/purchasing/inventory", label: "Inventory" },
  { href: "/warehouse/purchasing/reorder", label: "Reorder" },
  { href: "/warehouse/purchasing/orders", label: "Orders" },
  { href: "/warehouse/purchasing/overstock", label: "Overstock" },
  { href: "/warehouse/purchasing/settings", label: "Settings" },
];

export default function PurchasingTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-sand-200/60">
      {TABS.map((t) => {
        const active = pathname?.startsWith(t.href) ?? false;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors " +
              (active
                ? "border-accent text-accent"
                : "border-transparent text-sand-500 hover:text-sand-700")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
