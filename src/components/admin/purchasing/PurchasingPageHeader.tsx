import type { ReactNode } from "react";

export default function PurchasingPageHeader({ title, description, actions }: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold tracking-tight text-sand-900">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-sand-500">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
