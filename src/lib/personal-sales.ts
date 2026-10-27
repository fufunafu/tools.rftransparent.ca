import { quotePostgrestValue } from "@/lib/postgrest";
import { BUSINESS_TIMEZONE, startOfDayInTimeZone } from "@/lib/dates";

export interface PersonalSalesLead {
  id: string;
  customer_name: string | null;
  draft_name: string;
  quote_amount: number | string | null;
  lead_status: string;
  next_followup_at: string | null;
  closed_at: string | null;
  shopify_created_at: string | null;
}

export function salesStaffAliases(name: string, configuredTags: string[]): string[] {
  const aliases = configuredTags.length > 0 ? configuredTags : [name];
  return [...new Set(aliases.map((value) => value.trim()).filter(Boolean))];
}

export function salesStaffPostgrestFilter(aliases: string[]): string {
  return aliases
    .flatMap((alias) => {
      const value = quotePostgrestValue(alias);
      return [
        `last_invoice_sender.eq.${value}`,
        `and(last_invoice_sender.is.null,created_by_staff.eq.${value})`,
      ];
    })
    .join(",");
}

export function personalSalesSummary(leads: PersonalSalesLead[], now: Date) {
  const todayIso = startOfDayInTimeZone(now, BUSINESS_TIMEZONE).toISOString();
  const tomorrowIso = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, 1).toISOString();
  const active = leads.filter((lead) => !lead.closed_at);
  return {
    active: active.length,
    dueToday: active.filter(
      (lead) => lead.next_followup_at && lead.next_followup_at >= todayIso && lead.next_followup_at < tomorrowIso,
    ).length,
    overdue: active.filter((lead) => lead.next_followup_at && lead.next_followup_at < todayIso).length,
    won: leads.filter((lead) => lead.lead_status === "won").length,
  };
}
