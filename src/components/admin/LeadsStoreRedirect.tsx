"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  isLeadStoreId,
  leadsPath,
  type LeadStoreId,
} from "@/lib/customer-service/lead-store";

// /customer-service/leads has no store in it. Send the visitor to the store
// they last used (shared `cs_store` preference with the phone page), falling
// back to the region-based default chosen on the server.
export default function LeadsStoreRedirect({
  defaultStore,
  section,
}: {
  defaultStore: LeadStoreId;
  section?: "analysis";
}) {
  const router = useRouter();
  useEffect(() => {
    let store: LeadStoreId = defaultStore;
    try {
      const saved = window.localStorage.getItem("cs_store");
      if (isLeadStoreId(saved)) store = saved;
    } catch {
      // Storage unavailable; use the server default.
    }
    router.replace(leadsPath(store, section));
  }, [defaultStore, router, section]);

  return <div className="h-40 animate-pulse rounded-md bg-sand-50" aria-busy="true" />;
}
