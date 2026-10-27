"use client";

import type { ReactNode } from "react";
import type { Category } from "@/lib/purchasing/types";

export default function ProductFilters({ category, onCategory, search, onSearch, children }: {
  category: Category | "all";
  onCategory: (value: Category | "all") => void;
  search: string;
  onSearch: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex shrink-0 rounded-lg border border-sand-200 bg-sand-50 p-1" role="group" aria-label="Product category">
        {(["all", "glass", "hardware"] as const).map(value => (
          <button key={value} type="button" aria-pressed={category === value} onClick={() => onCategory(value)}
            className={"rounded-md px-3 py-1.5 text-sm font-medium transition-colors " + (category === value ? "bg-white text-sand-900 shadow-sm" : "text-sand-500 hover:text-sand-900")}>
            {value === "all" ? "All products" : value === "glass" ? "Glass" : "Hardware"}
          </button>
        ))}
      </div>
      <input type="search" aria-label="Search products" placeholder="Search SKU or product name" value={search} onChange={event => onSearch(event.target.value)}
        className="min-w-0 basis-52 flex-1 rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
      {children}
    </div>
  );
}
