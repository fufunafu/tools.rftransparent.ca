import type { FieldSalesNextAction, LocationVerification, VisitOutcome } from "@/lib/field-sales";

export interface FieldSalesAccount {
  id: string;
  name: string;
  address: string;
  hasSitePin: boolean;
  verificationRadiusM: number;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  territory: string | null;
  accountType: "prospect" | "customer" | "channel_partner";
  distributorGroup: string | null;
  lifecycleStatus: "active" | "watch" | "dormant" | "inactive";
}

export interface FieldSalesEmployee {
  id: string;
  name: string;
  department: string;
}

export interface FieldSalesAppointment {
  id: string;
  employeeId: string;
  employeeName: string;
  accountId: string;
  accountName: string;
  address: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "missed";
  notes: string | null;
  calendarUrl: string;
  hasSitePin: boolean;
}

export interface FieldSalesVisit {
  id: string;
  employeeId: string;
  employeeName: string;
  accountId: string;
  accountName: string;
  address: string;
  appointmentId: string | null;
  status: "open" | "completed";
  checkedInAt: string;
  checkedOutAt: string | null;
  locationVerification: LocationVerification;
  distanceFromSiteM: number | null;
  odometerStartKm: number | null;
  odometerEndKm: number | null;
  mileageKm: number | null;
  outcome: VisitOutcome | null;
  notes: string | null;
}

export interface FieldSalesContact {
  id: string;
  employeeId: string;
  employeeName: string;
  accountId: string;
  accountName: string;
  visitId: string | null;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  hasCard: boolean;
  cardUrl: string | null;
  createdAt: string;
}

export interface FieldSalesStats {
  appointmentsToday: number;
  completedVisits: number;
  mileageKm: number;
  contacts: number;
  openFollowups: number;
  overdueFollowups: number;
  attributedQuotes: number;
  attributedOrders: number;
  attributedRevenue: number;
}

export interface FieldSalesFollowup {
  id: string;
  visitId: string;
  accountId: string;
  accountName: string;
  employeeId: string;
  employeeName: string;
  actionType: FieldSalesNextAction;
  dueAt: string | null;
  notes: string | null;
  status: "open" | "completed" | "cancelled";
  completedAt: string | null;
}

export interface FieldSalesRevenueLink {
  id: string;
  visitId: string;
  accountId: string;
  accountName: string;
  employeeId: string;
  employeeName: string;
  leadId: string;
  quoteName: string;
  customerName: string | null;
  customerEmail: string | null;
  quoteAmount: number;
  quotedAt: string | null;
  leadStatus: string;
  orderAt: string | null;
  linkSource: "manual" | "exact_contact";
}

export interface FieldSalesQuoteCandidate {
  id: string;
  draftName: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  quoteAmount: number;
  quotedAt: string | null;
  leadStatus: string;
  linkedVisitId: string | null;
}

export interface FieldSalesPayload {
  scope: "mine" | "team";
  viewer: {
    employeeId: string | null;
    employeeName: string | null;
    canManage: boolean;
    canCreatePersonalActivity: boolean;
  };
  selectedEmployeeId: string | null;
  employees: FieldSalesEmployee[];
  accounts: FieldSalesAccount[];
  appointments: FieldSalesAppointment[];
  visits: FieldSalesVisit[];
  contacts: FieldSalesContact[];
  followups: FieldSalesFollowup[];
  revenueLinks: FieldSalesRevenueLink[];
  activeVisit: FieldSalesVisit | null;
  stats: FieldSalesStats;
}
