import { NextResponse } from "next/server";
import { isEmployeeAuthenticated, getSelectedEmployeeId } from "@/lib/employee-auth";
import { getSupabase } from "@/lib/supabase";
import { getStores } from "@/lib/shopify";
import { getEmployeeSalesMetrics, getEmployeeDraftMetrics } from "@/lib/kpi-sales";

export async function GET() {
  if (!(await isEmployeeAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const employeeId = await getSelectedEmployeeId();
  if (!employeeId) {
    return NextResponse.json({ error: "No employee selected" }, { status: 400 });
  }

  // Fetch employee for tags/store info
  const { data: employee } = await getSupabase()
    .from("employees")
    .select("*, locations(id, name, shopify_store_ids)")
    .eq("id", employeeId)
    .single();

  if (!employee) {
    return NextResponse.json({ targets: [] });
  }

  // Fetch active targets (current period)
  const now = new Date();
  const { data: targets } = await getSupabase()
    .from("sales_targets")
    .select("*")
    .eq("employee_id", employeeId)
    .lte("period_start", now.toISOString().split("T")[0])
    .order("period_start", { ascending: false });

  if (!targets || targets.length === 0) {
    return NextResponse.json({ targets: [] });
  }

  // Filter to active targets (period hasn't ended yet)
  const activeTargets = targets.filter((t) => {
    const start = new Date(t.period_start + "T00:00:00");
    let end: Date;
    if (t.period_type === "monthly") {
      end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    } else if (t.period_type === "quarterly") {
      end = new Date(start.getFullYear(), start.getMonth() + 3, 1);
    } else {
      end = new Date(start.getFullYear() + 1, 0, 1);
    }
    return now < end;
  });

  if (activeTargets.length === 0) {
    return NextResponse.json({ targets: [] });
  }

  // Get current values for each target
  const stores = getStores();
  const storeIds = employee.locations?.shopify_store_ids ?? stores.map((s) => s.id);
  const tags = employee.shopify_tags ?? [];

  const enriched = await Promise.all(
    activeTargets.map(async (target) => {
      const start = new Date(target.period_start + "T00:00:00");
      let end: Date;
      if (target.period_type === "monthly") {
        end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      } else if (target.period_type === "quarterly") {
        end = new Date(start.getFullYear(), start.getMonth() + 3, 1);
      } else {
        end = new Date(start.getFullYear() + 1, 0, 1);
      }

      let currentValue = 0;

      if (target.metric === "revenue" || target.metric === "orders") {
        const sales = await getEmployeeSalesMetrics(tags, storeIds, start, end);
        currentValue = target.metric === "revenue" ? sales.revenue : sales.orders;
      } else if (target.metric === "conversion_rate" || target.metric === "quotes") {
        const drafts = await getEmployeeDraftMetrics(tags, storeIds, start, end);
        currentValue = target.metric === "conversion_rate"
          ? drafts.conversionRate
          : drafts.totalDrafts;
      }

      return { ...target, current_value: currentValue };
    })
  );

  return NextResponse.json({ targets: enriched });
}
