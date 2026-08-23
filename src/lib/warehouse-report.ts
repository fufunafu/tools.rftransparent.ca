export interface WarehouseReportInput {
  reportDate: string;
  boxesBuilt: number;
  ordersPacked: number;
  walkinPickup: number;
  notes: string | null;
}

export type WarehouseReportValidation =
  | { ok: true; value: WarehouseReportInput }
  | { ok: false; error: string };

const MAX_DAILY_COUNT = 1_000_000;
const MAX_NOTES_LENGTH = 2_000;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function count(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DAILY_COUNT
    ? value
    : null;
}

export function validateWarehouseReport(value: unknown): WarehouseReportValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Invalid request body" };
  }
  const body = value as Record<string, unknown>;
  if ("employee_id" in body || "employeeId" in body) {
    return { ok: false, error: "Employee identity must not be supplied by the client" };
  }
  if (!validDate(body.report_date)) {
    return { ok: false, error: "report_date must be a valid date" };
  }

  const boxesBuilt = count(body.boxes_built);
  const ordersPacked = count(body.orders_packed);
  const walkinPickup = count(body.walkin_pickup);
  if (boxesBuilt === null || ordersPacked === null || walkinPickup === null) {
    return { ok: false, error: "Production counts must be whole numbers between 0 and 1,000,000" };
  }

  if (body.notes != null && typeof body.notes !== "string") {
    return { ok: false, error: "notes must be text" };
  }
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > MAX_NOTES_LENGTH) {
    return { ok: false, error: `notes must be ${MAX_NOTES_LENGTH} characters or fewer` };
  }

  return {
    ok: true,
    value: {
      reportDate: body.report_date,
      boxesBuilt,
      ordersPacked,
      walkinPickup,
      notes: notes || null,
    },
  };
}
