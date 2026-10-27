"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/warehouse/purchasing/inventory", label: "Inventory" },
  { href: "/warehouse/purchasing/reorder", label: "Plan orders" },
  { href: "/warehouse/purchasing/orders", label: "Purchase orders" },
  { href: "/warehouse/purchasing/sales", label: "Sales history" },
  { href: "/warehouse/purchasing/overstock", label: "Excess stock" },
  { href: "/warehouse/purchasing/settings", label: "Settings" },
];

export default function PurchasingTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Purchasing" className="flex gap-1 overflow-x-auto border-b border-sand-200">
      {TABS.map((t) => {
        const active = pathname?.startsWith(t.href) ?? false;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={
              "whitespace-nowrap px-3 py-3 text-sm font-medium border-b-2 transition-colors " +
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
