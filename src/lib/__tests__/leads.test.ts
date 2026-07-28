import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Supabase mock ───────────────────────────────────────────────────────────
// findOrInsertLead uses two chains:
//   from("leads").select("id").eq(...).gte(...).or(...).limit(1).maybeSingle()
//   from("leads").insert(row).select("id").single()

interface RecordedQuery {
  filters: { method: string; args: unknown[] }[];
}

const state: {
  selects: RecordedQuery[];
  inserts: Record<string, unknown>[];
  dedupResult: { id: string } | null;
  insertResult: { data: { id: string } | null; error: { message: string } | null };
} = {
  selects: [],
  inserts: [],
  dedupResult: null,
  insertResult: { data: { id: "new-lead-id" }, error: null },
};

function makeChain() {
  const rec: RecordedQuery = { filters: [] };
  const push = (method: string) => (...args: unknown[]) => {
    rec.filters.push({ method, args });
    return chain;
  };
  const chain = {
    select: () => chain,
    eq: push("eq"),
    gte: push("gte"),
    or: push("or"),
    limit: push("limit"),
    maybeSingle: () => {
      state.selects.push(rec);
      return Promise.resolve({ data: state.dedupResult, error: null });
    },
    insert: (row: Record<string, unknown>) => {
      state.inserts.push(row);
      return chain;
    },
    single: () => Promise.resolve(state.insertResult),
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ from: () => makeChain() }),
}));

import {
  extractContactFields,
  extractMetaLeadFields,
  findOrInsertLead,
  type UpsertLeadInput,
} from "@/lib/customer-service/leads";

beforeEach(() => {
  state.selects = [];
  state.inserts = [];
  state.dedupResult = null;
  state.insertResult = { data: { id: "new-lead-id" }, error: null };
});

function leadInput(overrides: Partial<UpsertLeadInput> = {}): UpsertLeadInput {
  return {
    source: "website",
    source_detail: "contact-form",
    form_id: "f1",
    page_url: "https://example.com/contact",
    name: "Jane Doe",
    email: "jane@example.com",
    phone: null,
    message: "Need a quote",
    raw_payload: {},
    ...overrides,
  };
}

// ─── extractContactFields ───────────────────────────────────────────────────

describe("extractContactFields", () => {
  it("prefers the explicit payload.mapped block over everything else", () => {
    const result = extractContactFields({
      mapped: { name: "Jane", email: "j@x.com", phone: "555", message: "hi" },
      fields: { name: "SHOULD-NOT-WIN", email: "no@no.com" },
    });
    expect(result).toEqual({ name: "Jane", email: "j@x.com", phone: "555", message: "hi" });
  });

  it("returns nulls for empty/whitespace mapped values", () => {
    const result = extractContactFields({
      mapped: { name: "  ", email: "", phone: undefined, message: null },
    });
    expect(result).toEqual({ name: null, email: null, phone: null, message: null });
  });

  it("falls back to common field names inside payload.fields", () => {
    const result = extractContactFields({
      fields: {
        name: "Jane Doe",
        email: "jane@x.com",
        phone: "514-555-1234",
        message: "Glass railing quote",
      },
    });
    expect(result).toEqual({
      name: "Jane Doe",
      email: "jane@x.com",
      phone: "514-555-1234",
      message: "Glass railing quote",
    });
  });

  it("reads from the top-level payload when there is no fields wrapper", () => {
    const result = extractContactFields({ your_email: "top@x.com", tel: "555" });
    expect(result.email).toBe("top@x.com");
    expect(result.phone).toBe("555");
  });

  it("joins first and last name when no full-name field exists", () => {
    const result = extractContactFields({ fields: { first_name: "Jane", last_name: "Doe" } });
    expect(result.name).toBe("Jane Doe");
  });

  it("supports Powerful Form Builder default field names", () => {
    const result = extractContactFields({
      fields: { text: "Jane", "phone-1": "5145551234", "textarea-1": "Some details" },
    });
    expect(result).toEqual({
      name: "Jane",
      email: null,
      phone: "5145551234",
      message: "Some details",
    });
  });

  it("matches keys case-insensitively as a last resort", () => {
    const result = extractContactFields({ fields: { Email: "Case@X.com", PHONE: "555" } });
    expect(result.email).toBe("Case@X.com");
    expect(result.phone).toBe("555");
  });

  it("returns all nulls for an empty payload", () => {
    expect(extractContactFields({})).toEqual({
      name: null,
      email: null,
      phone: null,
      message: null,
    });
  });
});

// ─── extractMetaLeadFields ──────────────────────────────────────────────────

describe("extractMetaLeadFields", () => {
  it("maps the standard Meta field names", () => {
    const result = extractMetaLeadFields([
      { name: "full_name", values: ["Jane Doe"] },
      { name: "email", values: ["jane@x.com"] },
      { name: "phone_number", values: ["+15145551234"] },
    ]);
    expect(result).toEqual({
      name: "Jane Doe",
      email: "jane@x.com",
      phone: "+15145551234",
      message: null,
    });
  });

  it("joins first_name and last_name when there is no full_name", () => {
    const result = extractMetaLeadFields([
      { name: "first_name", values: ["Jane"] },
      { name: "last_name", values: ["Doe"] },
    ]);
    expect(result.name).toBe("Jane Doe");
  });

  it("accepts 'phone' as a fallback for phone_number", () => {
    const result = extractMetaLeadFields([{ name: "phone", values: ["555"] }]);
    expect(result.phone).toBe("555");
  });

  it("folds custom questions into message with prettified labels", () => {
    const result = extractMetaLeadFields([
      { name: "email", values: ["jane@x.com"] },
      { name: "railing_type", values: ["Frameless"] },
      { name: "project-timeline", values: ["ASAP"] },
    ]);
    expect(result.message).toBe("Railing Type: Frameless\nProject Timeline: ASAP");
  });

  it("skips entries with empty values or non-string names", () => {
    const result = extractMetaLeadFields([
      { name: "email", values: [] },
      { name: 42, values: ["ignored"] },
      { name: "phone_number", values: ["   "] },
    ]);
    expect(result).toEqual({ name: null, email: null, phone: null, message: null });
  });
});

// ─── findOrInsertLead ───────────────────────────────────────────────────────

describe("findOrInsertLead", () => {
  it("skips submissions with no email and no phone, without touching the DB", async () => {
    const result = await findOrInsertLead(leadInput({ email: null, phone: null }));
    expect(result).toEqual({ ok: true, skipped: "no_contact" });
    expect(state.selects).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("treats a whitespace-only email (with no phone) as no contact", async () => {
    const result = await findOrInsertLead(leadInput({ email: "   ", phone: null }));
    expect(result).toEqual({ ok: true, skipped: "no_contact" });
    expect(state.inserts).toHaveLength(0);
  });

  it("strips all whitespace from the email before dedup and insert", async () => {
    const result = await findOrInsertLead(leadInput({ email: " ja ne@example.com " }));
    expect(result).toEqual({ ok: true, lead_id: "new-lead-id", deduped: false });

    const orFilter = state.selects[0].filters.find((f) => f.method === "or")!;
    expect(orFilter.args[0]).toBe("email.ilike.jane@example.com");
    expect(state.inserts[0].email).toBe("jane@example.com");
  });

  it("dedups against a recent lead from the same source instead of inserting", async () => {
    state.dedupResult = { id: "existing-lead" };
    const result = await findOrInsertLead(leadInput());

    expect(result).toEqual({ ok: true, lead_id: "existing-lead", deduped: true });
    expect(state.inserts).toHaveLength(0);

    // Dedup query scopes to the source and a recent submitted_at window
    const filters = state.selects[0].filters;
    expect(filters).toContainEqual({ method: "eq", args: ["source", "website"] });
    const gte = filters.find((f) => f.method === "gte")!;
    expect(gte.args[0]).toBe("submitted_at");
    const windowStart = new Date(gte.args[1] as string).getTime();
    expect(Date.now() - windowStart).toBeGreaterThan(9.9 * 60 * 1000);
    expect(Date.now() - windowStart).toBeLessThan(10.1 * 60 * 1000);
  });

  it("matches on email OR phone when both are present", async () => {
    await findOrInsertLead(leadInput({ email: "jane@example.com", phone: "5145551234" }));
    const orFilter = state.selects[0].filters.find((f) => f.method === "or")!;
    expect(orFilter.args[0]).toBe("email.ilike.jane@example.com,phone.eq.5145551234");
  });

  it("accepts phone-only submissions and dedups on phone alone", async () => {
    const result = await findOrInsertLead(leadInput({ email: null, phone: "5145551234" }));
    expect(result).toEqual({ ok: true, lead_id: "new-lead-id", deduped: false });

    const orFilter = state.selects[0].filters.find((f) => f.method === "or")!;
    expect(orFilter.args[0]).toBe("phone.eq.5145551234");
    expect(state.inserts[0].phone).toBe("5145551234");
    expect(state.inserts[0].email).toBeNull();
  });

  it("inserts a new lead when no recent duplicate exists", async () => {
    const input = leadInput();
    const result = await findOrInsertLead(input);

    expect(result).toEqual({ ok: true, lead_id: "new-lead-id", deduped: false });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      source: "website",
      name: "Jane Doe",
      email: "jane@example.com",
      message: "Need a quote",
    });
  });

  it("surfaces insert errors", async () => {
    state.insertResult = { data: null, error: { message: "boom" } };
    const result = await findOrInsertLead(leadInput());
    expect(result).toEqual({ ok: false, error: "boom" });
  });
});
