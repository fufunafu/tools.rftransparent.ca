import { z } from "zod";
import {
  distanceMeters,
  dayKeyInTimeZone,
  isValidLatitude,
  isValidLongitude,
  validateClockPosition,
} from "@/lib/time-clock";

export const FIELD_SALES_CARD_BUCKET = "field-sales-cards";
export const FIELD_SALES_MAX_CARD_BYTES = 10 * 1024 * 1024;
export const FIELD_SALES_CARD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const visitOutcomeValues = [
  "follow_up",
  "quote_requested",
  "sample_left",
  "order_expected",
  "not_interested",
  "other",
] as const;

export type VisitOutcome = (typeof visitOutcomeValues)[number];
export type LocationVerification = "verified" | "pin_created" | "outside_radius" | "unverified";

export const fieldSalesNextActionValues = [
  "follow_up",
  "prepare_quote",
  "send_samples",
  "call_contact",
  "schedule_visit",
  "no_further_action",
] as const;

export type FieldSalesNextAction = (typeof fieldSalesNextActionValues)[number];

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const appointmentInputSchema = z.object({
  accountId: z.string().uuid().optional().nullable(),
  accountName: trimmed(160).optional(),
  address: trimmed(500).optional(),
  title: trimmed(200),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().optional().nullable(),
  notes: optionalText(4000),
}).superRefine((value, context) => {
  if (!value.accountId && (!value.accountName || !value.address)) {
    context.addIssue({
      code: "custom",
      path: ["accountName"],
      message: "Choose a customer site or enter a company and address.",
    });
  }
  if (value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "End time must be after start time." });
  }
});

export const visitStartInputSchema = z.object({
  appointmentId: z.string().uuid().optional().nullable(),
  accountId: z.string().uuid(),
  position: z.unknown(),
  establishSitePin: z.boolean().optional().default(false),
  odometerStartKm: z.number().finite().min(0).max(9_999_999).optional().nullable(),
});

export const visitFinishInputSchema = z.object({
  visitId: z.string().uuid(),
  odometerEndKm: z.number().finite().min(0).max(9_999_999).optional().nullable(),
  outcome: z.enum(visitOutcomeValues),
  notes: optionalText(4000),
  nextActionType: z.enum(fieldSalesNextActionValues),
  nextActionDueAt: z.iso.date().optional().nullable(),
  nextActionNotes: optionalText(2000),
}).superRefine((value, context) => {
  if (value.nextActionType !== "no_further_action" && !value.nextActionDueAt) {
    context.addIssue({
      code: "custom",
      path: ["nextActionDueAt"],
      message: "Choose a due date for the next action.",
    });
  }
});

export const fieldSalesAccountInputSchema = z.object({
  accountId: z.string().uuid(),
  assignedEmployeeId: z.string().uuid().optional().nullable(),
  territory: optionalText(120),
  accountType: z.enum(["prospect", "customer", "channel_partner"]),
  distributorGroup: optionalText(160),
  lifecycleStatus: z.enum(["active", "watch", "dormant", "inactive"]),
});

export const fieldSalesAttributionInputSchema = z.object({
  visitId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export const fieldSalesFollowupUpdateSchema = z.object({
  followupId: z.string().uuid(),
  status: z.enum(["completed", "cancelled"]),
});

export const contactInputSchema = z.object({
  accountId: z.string().uuid(),
  visitId: z.string().uuid().optional().nullable(),
  name: trimmed(160),
  jobTitle: optionalText(160),
  email: z.union([z.literal(""), z.email().max(320)]).optional().nullable(),
  phone: optionalText(40),
  notes: optionalText(2000),
});

export interface SitePin {
  latitude: number | null;
  longitude: number | null;
  verificationRadiusM: number | null;
}

export function classifyVisitLocation(
  position: { latitude: number; longitude: number },
  site: SitePin,
  establishSitePin: boolean,
): { verification: LocationVerification; distanceM: number | null } {
  if (site.latitude == null || site.longitude == null) {
    return {
      verification: establishSitePin ? "pin_created" : "unverified",
      distanceM: null,
    };
  }
  if (!isValidLatitude(site.latitude) || !isValidLongitude(site.longitude)) {
    return { verification: "unverified", distanceM: null };
  }
  const distanceM = Math.round(distanceMeters(
    position.latitude,
    position.longitude,
    site.latitude,
    site.longitude,
  ));
  return {
    verification: distanceM <= (site.verificationRadiusM ?? 250) ? "verified" : "outside_radius",
    distanceM,
  };
}

export function parseFreshVisitPosition(value: unknown, now = new Date()) {
  return validateClockPosition(value, now);
}

export function safeStorageName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").replace(/_{2,}/g, "_").slice(-80) || "business-card";
}

export function googleCalendarUrl(appointment: {
  title: string;
  startsAt: string;
  endsAt: string | null;
  address: string;
  notes?: string | null;
}): string {
  const compact = (value: string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const end = appointment.endsAt ?? new Date(Date.parse(appointment.startsAt) + 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: appointment.title,
    dates: `${compact(appointment.startsAt)}/${compact(end)}`,
    location: appointment.address,
    details: appointment.notes ?? "Scheduled in RF Tools",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function summarizeFieldSales(
  appointments: Array<{ starts_at: string; status: string }>,
  visits: Array<{ checked_in_at: string; status: string; mileage_km: number | string | null }>,
  contactCount: number,
  now = new Date(),
) {
  const day = dayKeyInTimeZone(now);
  return {
    appointmentsToday: appointments.filter((item) => dayKeyInTimeZone(new Date(item.starts_at)) === day && item.status !== "cancelled").length,
    completedVisits: visits.filter((item) => item.status === "completed").length,
    mileageKm: visits.reduce((sum, item) => sum + (Number(item.mileage_km) || 0), 0),
    contacts: contactCount,
  };
}

export function summarizeFieldSalesImpact(
  followups: Array<{ status: string; due_at: string | null }>,
  revenueLinks: Array<{ lead_status: string; quote_amount: number | string | null }>,
  now = new Date(),
) {
  const today = dayKeyInTimeZone(now);
  const open = followups.filter((item) => item.status === "open");
  const won = revenueLinks.filter((item) => item.lead_status === "won");
  return {
    openFollowups: open.length,
    overdueFollowups: open.filter((item) => item.due_at != null && item.due_at < today).length,
    attributedQuotes: revenueLinks.length,
    attributedOrders: won.length,
    attributedRevenue: won.reduce((sum, item) => sum + (Number(item.quote_amount) || 0), 0),
  };
}
