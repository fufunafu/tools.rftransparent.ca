import "server-only";

import type { FieldSalesActor } from "@/lib/field-sales-access";
import { googleCalendarUrl, summarizeFieldSales, summarizeFieldSalesImpact } from "@/lib/field-sales";
import type {
  FieldSalesAccount,
  FieldSalesAppointment,
  FieldSalesContact,
  FieldSalesEmployee,
  FieldSalesFollowup,
  FieldSalesPayload,
  FieldSalesRevenueLink,
  FieldSalesVisit,
} from "@/lib/field-sales-types";
import { getSupabase } from "@/lib/supabase";

type Relation<T> = T | T[] | null;

interface AccountRow {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  verification_radius_m: number | null;
  assigned_employee_id: string | null;
  territory: string | null;
  account_type: FieldSalesAccount["accountType"];
  distributor_group: string | null;
  lifecycle_status: FieldSalesAccount["lifecycleStatus"];
  assigned_employee: Relation<Pick<EmployeeRow, "id" | "name">>;
}

interface EmployeeRow {
  id: string;
  name: string;
  department: string;
}

interface AppointmentRow {
  id: string;
  employee_id: string;
  account_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: FieldSalesAppointment["status"];
  notes: string | null;
  field_sales_accounts: Relation<AccountRow>;
  employees: Relation<EmployeeRow>;
}

interface VisitRow {
  id: string;
  employee_id: string;
  account_id: string;
  appointment_id: string | null;
  status: FieldSalesVisit["status"];
  checked_in_at: string;
  checked_out_at: string | null;
  location_verification: FieldSalesVisit["locationVerification"];
  distance_from_site_m: number | null;
  odometer_start_km: number | string | null;
  odometer_end_km: number | string | null;
  mileage_km: number | string | null;
  outcome: FieldSalesVisit["outcome"];
  notes: string | null;
  field_sales_accounts: Relation<AccountRow>;
  employees: Relation<EmployeeRow>;
}

interface ContactRow {
  id: string;
  employee_id: string;
  account_id: string;
  visit_id: string | null;
  name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  card_path: string | null;
  created_at: string;
  field_sales_accounts: Relation<Pick<AccountRow, "id" | "name">>;
  employees: Relation<EmployeeRow>;
}

interface FollowupRow {
  id: string;
  visit_id: string;
  account_id: string;
  employee_id: string;
  action_type: FieldSalesFollowup["actionType"];
  due_at: string | null;
  notes: string | null;
  status: FieldSalesFollowup["status"];
  completed_at: string | null;
  field_sales_accounts: Relation<Pick<AccountRow, "id" | "name">>;
  employees: Relation<EmployeeRow>;
}

interface LeadRow {
  id: string;
  draft_name: string;
  customer_name: string | null;
  customer_email: string | null;
  quote_amount: number | string | null;
  shopify_created_at: string | null;
  lead_status: string;
  closed_at: string | null;
}

interface RevenueLinkRow {
  id: string;
  visit_id: string;
  account_id: string;
  employee_id: string;
  lead_id: string;
  link_source: FieldSalesRevenueLink["linkSource"];
  field_sales_accounts: Relation<Pick<AccountRow, "id" | "name">>;
  employees: Relation<EmployeeRow>;
  followup_leads: Relation<LeadRow>;
}

export class FieldSalesDataError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function numberOrNull(value: number | string | null): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function accountFromRow(row: AccountRow): FieldSalesAccount {
  const assignedEmployee = one(row.assigned_employee);
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    hasSitePin: row.latitude != null && row.longitude != null,
    verificationRadiusM: row.verification_radius_m ?? 250,
    assignedEmployeeId: row.assigned_employee_id,
    assignedEmployeeName: assignedEmployee?.name ?? null,
    territory: row.territory,
    accountType: row.account_type,
    distributorGroup: row.distributor_group,
    lifecycleStatus: row.lifecycle_status,
  };
}

function followupFromRow(row: FollowupRow): FieldSalesFollowup | null {
  const account = one(row.field_sales_accounts);
  const employee = one(row.employees);
  if (!account || !employee) return null;
  return {
    id: row.id,
    visitId: row.visit_id,
    accountId: row.account_id,
    accountName: account.name,
    employeeId: row.employee_id,
    employeeName: employee.name,
    actionType: row.action_type,
    dueAt: row.due_at,
    notes: row.notes,
    status: row.status,
    completedAt: row.completed_at,
  };
}

function revenueLinkFromRow(row: RevenueLinkRow): FieldSalesRevenueLink | null {
  const account = one(row.field_sales_accounts);
  const employee = one(row.employees);
  const lead = one(row.followup_leads);
  if (!account || !employee || !lead) return null;
  return {
    id: row.id,
    visitId: row.visit_id,
    accountId: row.account_id,
    accountName: account.name,
    employeeId: row.employee_id,
    employeeName: employee.name,
    leadId: row.lead_id,
    quoteName: lead.draft_name,
    customerName: lead.customer_name,
    customerEmail: lead.customer_email,
    quoteAmount: Number(lead.quote_amount) || 0,
    quotedAt: lead.shopify_created_at,
    leadStatus: lead.lead_status,
    orderAt: lead.closed_at,
    linkSource: row.link_source,
  };
}

function appointmentFromRow(row: AppointmentRow): FieldSalesAppointment | null {
  const account = one(row.field_sales_accounts);
  const employee = one(row.employees);
  if (!account || !employee) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: employee.name,
    accountId: row.account_id,
    accountName: account.name,
    address: account.address,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    notes: row.notes,
    calendarUrl: googleCalendarUrl({
      title: row.title,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      address: account.address,
      notes: row.notes,
    }),
    hasSitePin: account.latitude != null && account.longitude != null,
  };
}

function visitFromRow(row: VisitRow): FieldSalesVisit | null {
  const account = one(row.field_sales_accounts);
  const employee = one(row.employees);
  if (!account || !employee) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: employee.name,
    accountId: row.account_id,
    accountName: account.name,
    address: account.address,
    appointmentId: row.appointment_id,
    status: row.status,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    locationVerification: row.location_verification,
    distanceFromSiteM: row.distance_from_site_m,
    odometerStartKm: numberOrNull(row.odometer_start_km),
    odometerEndKm: numberOrNull(row.odometer_end_km),
    mileageKm: numberOrNull(row.mileage_km),
    outcome: row.outcome,
    notes: row.notes,
  };
}

function contactFromRow(row: ContactRow): FieldSalesContact | null {
  const account = one(row.field_sales_accounts);
  const employee = one(row.employees);
  if (!account || !employee) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: employee.name,
    accountId: row.account_id,
    accountName: account.name,
    visitId: row.visit_id,
    name: row.name,
    jobTitle: row.job_title,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    hasCard: Boolean(row.card_path),
    cardUrl: row.card_path ? `/api/field-sales/cards/${row.id}` : null,
    createdAt: row.created_at,
  };
}

export async function loadFieldSalesPayload(
  actor: FieldSalesActor,
  requestedScope: "mine" | "team",
  requestedEmployeeId: string | null,
): Promise<FieldSalesPayload> {
  const scope = requestedScope === "team" && actor.canManage ? "team" : "mine";
  if (scope === "mine" && (!actor.employee || !actor.canUsePersonalWorkspace)) {
    throw new FieldSalesDataError(
      "Your login is not linked to an active sales profile.",
      403,
    );
  }

  const supabase = getSupabase();
  let employeeId = scope === "mine" ? actor.employee!.id : requestedEmployeeId;

  let employeeQuery = supabase
    .from("employees")
    .select("id, name, department")
    .eq("active", true)
    .in("department", ["sales", "management"])
    .order("name", { ascending: true });

  if (!actor.canManage) employeeQuery = employeeQuery.eq("id", actor.employee?.id ?? "");
  const employeeResult = await employeeQuery;
  if (employeeResult.error) throw new Error(employeeResult.error.message);
  const employees = (employeeResult.data ?? []) as EmployeeRow[];

  if (scope === "team" && employeeId && !employees.some((employee) => employee.id === employeeId)) {
    employeeId = null;
  }

  let appointmentsQuery = supabase
    .from("field_sales_appointments")
    .select("id, employee_id, account_id, title, starts_at, ends_at, status, notes, field_sales_accounts(id, name, address, latitude, longitude, verification_radius_m), employees(id, name, department)")
    .gte("starts_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(400);
  const visitWindowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  let visitsQuery = supabase
    .from("field_sales_visits")
    .select("id, employee_id, account_id, appointment_id, status, checked_in_at, checked_out_at, location_verification, distance_from_site_m, odometer_start_km, odometer_end_km, mileage_km, outcome, notes, field_sales_accounts(id, name, address, latitude, longitude, verification_radius_m), employees(id, name, department)")
    .or(`checked_in_at.gte.${visitWindowStart},status.eq.open`)
    .order("checked_in_at", { ascending: false })
    .limit(400);
  let contactsQuery = supabase
    .from("field_sales_contacts")
    .select("id, employee_id, account_id, visit_id, name, job_title, email, phone, notes, card_path, created_at, field_sales_accounts(id, name), employees(id, name, department)")
    .order("created_at", { ascending: false })
    .limit(400);
  let followupsQuery = supabase
    .from("field_sales_followups")
    .select("id, visit_id, account_id, employee_id, action_type, due_at, notes, status, completed_at, field_sales_accounts(id, name), employees(id, name, department)")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(400);
  let revenueLinksQuery = supabase
    .from("field_sales_revenue_links")
    .select("id, visit_id, account_id, employee_id, lead_id, link_source, field_sales_accounts(id, name), employees(id, name, department), followup_leads(id, draft_name, customer_name, customer_email, quote_amount, shopify_created_at, lead_status, closed_at)")
    .order("created_at", { ascending: false })
    .limit(400);

  if (employeeId) {
    appointmentsQuery = appointmentsQuery.eq("employee_id", employeeId);
    visitsQuery = visitsQuery.eq("employee_id", employeeId);
    contactsQuery = contactsQuery.eq("employee_id", employeeId);
    followupsQuery = followupsQuery.eq("employee_id", employeeId);
    revenueLinksQuery = revenueLinksQuery.eq("employee_id", employeeId);
  }

  const [accountsResult, appointmentsResult, visitsResult, contactsResult, followupsResult, revenueLinksResult] = await Promise.all([
    supabase
      .from("field_sales_accounts")
      .select("id, name, address, latitude, longitude, verification_radius_m, assigned_employee_id, territory, account_type, distributor_group, lifecycle_status, assigned_employee:employees!field_sales_accounts_assigned_employee_id_fkey(id, name)")
      .order("name", { ascending: true })
      .limit(1000),
    appointmentsQuery,
    visitsQuery,
    contactsQuery,
    followupsQuery,
    revenueLinksQuery,
  ]);

  for (const result of [accountsResult, appointmentsResult, visitsResult, contactsResult, followupsResult, revenueLinksResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const accounts = ((accountsResult.data ?? []) as AccountRow[]).map(accountFromRow);
  const appointments = ((appointmentsResult.data ?? []) as unknown as AppointmentRow[])
    .map(appointmentFromRow)
    .filter((item): item is FieldSalesAppointment => item !== null);
  const visits = ((visitsResult.data ?? []) as unknown as VisitRow[])
    .map(visitFromRow)
    .filter((item): item is FieldSalesVisit => item !== null);
  const contacts = ((contactsResult.data ?? []) as unknown as ContactRow[])
    .map(contactFromRow)
    .filter((item): item is FieldSalesContact => item !== null);
  const followups = ((followupsResult.data ?? []) as unknown as FollowupRow[])
    .map(followupFromRow)
    .filter((item): item is FieldSalesFollowup => item !== null);
  const revenueLinks = ((revenueLinksResult.data ?? []) as unknown as RevenueLinkRow[])
    .map(revenueLinkFromRow)
    .filter((item): item is FieldSalesRevenueLink => item !== null);
  const activityStats = summarizeFieldSales(
    appointments.map((appointment) => ({
      starts_at: appointment.startsAt,
      status: appointment.status,
    })),
    visits.map((visit) => ({
      checked_in_at: visit.checkedInAt,
      status: visit.status,
      mileage_km: visit.mileageKm,
    })),
    contacts.length,
  );
  const impactStats = summarizeFieldSalesImpact(
    followups.map((followup) => ({ status: followup.status, due_at: followup.dueAt })),
    revenueLinks.map((link) => ({ lead_status: link.leadStatus, quote_amount: link.quoteAmount })),
  );

  return {
    scope,
    viewer: {
      employeeId: actor.employee?.id ?? null,
      employeeName: actor.employee?.name ?? null,
      canManage: actor.canManage,
      canCreatePersonalActivity: actor.canUsePersonalWorkspace,
    },
    selectedEmployeeId: employeeId ?? null,
    employees: employees.map((employee): FieldSalesEmployee => ({
      id: employee.id,
      name: employee.name,
      department: employee.department,
    })),
    accounts,
    appointments,
    visits,
    contacts,
    followups,
    revenueLinks,
    activeVisit: visits.find((visit) => visit.status === "open") ?? null,
    stats: { ...activityStats, ...impactStats },
  };
}
