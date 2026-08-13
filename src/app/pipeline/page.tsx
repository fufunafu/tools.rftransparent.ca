import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import { getStores } from "@/lib/shopify";
import { getSupabase } from "@/lib/supabase";
import { parsePipelineView } from "@/lib/pipeline-dashboard-view";
import PipelineDashboard, { type PipelineData } from "@/components/admin/PipelineDashboard";

export const metadata: Metadata = {
  title: "Pipeline | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  const query = await searchParams;
  const initialView = parsePipelineView(
    Array.isArray(query.view) ? query.view[0] : query.view,
  );

  const stores = getStores();
  const storeIds = stores.map((store) => store.id).sort();
  const cacheKey = `pipeline:${storeIds.join(",")}:90::`;
  let initialData: PipelineData | undefined;

  if (storeIds.length > 0) {
    try {
      const { data: cached } = await getSupabase()
        .from("pipeline_cache")
        .select("result, computed_at")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (cached) {
        initialData = {
          ...cached.result,
          cachedAt: cached.computed_at,
          stores: stores.map((store) => ({ id: store.id, label: store.label })),
        } as PipelineData;
      }
    } catch (err) {
      console.warn("[Pipeline page] Could not preload cached data", err);
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <PipelineDashboard initialData={initialData} initialView={initialView} />
    </div>
  );
}
