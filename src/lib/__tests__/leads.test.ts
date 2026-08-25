import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendNewLeadNotificationMock } = vi.hoisted(() => ({
  sendNewLeadNotificationMock: vi.fn(),
}));

vi.mock("@/lib/lead-notifications", () => ({
  sendNewLeadNotification: sendNewLeadNotificationMock,
}));

// ─── Supabase mock ───────────────────────────────────────────────────────────
// findOrInsertLead uses two chains:
//   from("leads").select("id").eq(...).contains(...).limit(1).maybeSingle()
//   from("leads").select("id").eq(...).gte(...).or(...).limit(1).maybeSingle()
//   from("leads").insert(row).select("id").single()

interface RecordedQuery {
  filters: { method: string; args: unknown[] }[];
}

const state: {
  selects: RecordedQuery[];
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  dedupResult: {
    id: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    message?: string | null;
    installation_requested?: boolean | null;
    raw_payload?: Record<string, unknown>;
    outcome?: string;
  } | null;
  insertResult: { data: { id: string } | null; error: { message: string } | null };
} = {
  selects: [],
  inserts: [],
  updates: [],
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
    contains: push("contains"),
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
    update: (row: Record<string, unknown>) => {
      state.updates.push(row);
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
  extractInstallationRequested,
  extractSubmissionDetails,
  extractMetaLeadFields,
  findOrInsertLead,
  type UpsertLeadInput,
} from "@/lib/customer-service/leads";

beforeEach(() => {
  sendNewLeadNotificationMock.mockReset();
  sendNewLeadNotificationMock.mockResolvedValue(true);
  state.selects = [];
  state.inserts = [];
  state.updates = [];
  state.dedupResult = null;
  state.insertResult = { data: { id: "new-lead-id" }, error: null };
});

function leadInput(overrides: Partial<UpsertLeadInput> = {}): UpsertLeadInput {
  return {
    store_id: "rf_transparent",
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

  it("falls back field by field when mapped values are empty", () => {
    const result = extractContactFields({
      mapped: { name: "  ", email: "", phone: undefined, message: null },
      fields: { name: "Fallback Name", email: "fallback@example.com", phone: "555" },
    });
    expect(result).toEqual({
      name: "Fallback Name",
      email: "fallback@example.com",
      phone: "555",
      message: null,
    });
  });

  it("uses Powerful Form Builder labels to recover custom name fields", () => {
    const result = extractContactFields({
      fields: {
        "text-5": "Brenda",
        "text-6": "Luskey",
        email: "brenda@example.com",
        "phone-1": "",
        _keyLabel: JSON.stringify({
          "text-5": "First Name",
          "text-6": "Last Name",
          email: "Email",
          "phone-1": "Phone Number",
        }),
      },
      mapped: { email: "brenda@example.com" },
    });

    expect(result).toEqual({
      name: "Brenda Luskey",
      email: "brenda@example.com",
      phone: null,
      message: null,
    });
  });

  it("turns labeled project fields into readable submission details", () => {
    const payload = {
      fields: {
        "text-5": "Brenda",
        "select-2": "Matte Black",
        "select-3": "48 inches",
        _keyLabel: JSON.stringify({
          "text-5": "First Name",
          "select-2": "Hardware Color",
          "select-3": "Railing Height",
        }),
      },
    };

    expect(extractSubmissionDetails(payload)).toEqual([
      { key: "select-2", label: "Hardware Color", value: "Matte Black" },
      { key: "select-3", label: "Railing Height", value: "48 inches" },
    ]);
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

// ─── extractInstallationRequested ───────────────────────────────────────────

describe("extractInstallationRequested", () => {
  it("reads Powerful Form Builder's bracketed custom-button field", () => {
    const payload = {
      fields: {
        "button-1[]": "Yes",
        _keyLabel: JSON.stringify({
          "button-1": "Do you need installation?",
        }),
      },
    };

    expect(extractInstallationRequested(payload)).toBe(true);
    expect(extractSubmissionDetails(payload)).toContainEqual({
      key: "button-1",
      label: "Do you need installation?",
      value: "Yes",
    });
  });

  it("recognizes a negative installation answer", () => {
    expect(extractInstallationRequested({
      fields: { "button-1[]": "No" },
    })).toBe(false);
  });

  it("prefers an explicit mapped installation value", () => {
    expect(extractInstallationRequested({
      mapped: { installation_requested: true },
      fields: { "button-1[]": "No" },
    })).toBe(true);
  });

  it("returns null when no installation preference was recorded", () => {
    expect(extractInstallationRequested({ fields: { email: "jane@example.com" } })).toBeNull();
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
    expect(orFilter.args[0]).toBe('email.ilike."jane@example.com"');
    expect(state.inserts[0].email).toBe("jane@example.com");
  });

  it("dedups against a recent lead from the same source instead of inserting", async () => {
    state.dedupResult = { id: "existing-lead" };
    const result = await findOrInsertLead(leadInput());

    expect(result).toEqual({ ok: true, lead_id: "existing-lead", deduped: true });
    expect(state.inserts).toHaveLength(0);
    expect(sendNewLeadNotificationMock).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(1);

    // Dedup query scopes to the source and a recent submitted_at window
    const filters = state.selects[0].filters;
    expect(filters).toContainEqual({ method: "eq", args: ["source", "website"] });
    const gte = filters.find((f) => f.method === "gte")!;
    expect(gte.args[0]).toBe("submitted_at");
    const windowStart = new Date(gte.args[1] as string).getTime();
    expect(Date.now() - windowStart).toBeGreaterThan(23.9 * 60 * 60 * 1000);
    expect(Date.now() - windowStart).toBeLessThan(24.1 * 60 * 60 * 1000);
  });

  it("enriches a recent duplicate with corrected contact details", async () => {
    state.dedupResult = {
      id: "existing-lead",
      name: null,
      email: "bev'scarpentry@hotmail.com",
      phone: "902-527-8969",
      message: null,
      raw_payload: { old: true },
    };

    const result = await findOrInsertLead(leadInput({
      name: "Bev",
      email: "bevscarpentry@hotmail.com",
      phone: "902-527-8969",
      message: "Two angled sections",
      installation_requested: null,
      raw_payload: { corrected: true },
    }));

    expect(result).toEqual({ ok: true, lead_id: "existing-lead", deduped: true });
    expect(state.inserts).toHaveLength(0);
    expect(state.updates[0]).toEqual({
      name: "Bev",
      email: "bevscarpentry@hotmail.com",
      phone: "902-527-8969",
      message: "Two angled sections",
      installation_requested: null,
      raw_payload: { corrected: true },
    });
  });

  it("dedups a provider lead by its stable external id before the time window", async () => {
    state.dedupResult = { id: "existing-meta-lead" };
    const result = await findOrInsertLead(
      leadInput({
        source: "meta",
        external_id: "meta-123",
        raw_payload: { meta_lead_id: "meta-123" },
      }),
    );

    expect(result).toEqual({ ok: true, lead_id: "existing-meta-lead", deduped: true });
    expect(state.selects).toHaveLength(1);
    expect(state.selects[0].filters).toContainEqual({
      method: "contains",
      args: ["raw_payload", { meta_lead_id: "meta-123" }],
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("matches on email OR phone when both are present", async () => {
    await findOrInsertLead(leadInput({ email: "jane@example.com", phone: "5145551234" }));
    const orFilter = state.selects[0].filters.find((f) => f.method === "or")!;
    expect(orFilter.args[0]).toBe('email.ilike."jane@example.com",phone.eq."5145551234"');
  });

  it("quotes filter metacharacters in a submitted email so they cannot inject conditions", async () => {
    await findOrInsertLead(leadInput({ email: "x,outcome.eq.won", phone: null }));
    const orFilter = state.selects[0].filters.find((f) => f.method === "or")!;
    expect(orFilter.args[0]).toBe('email.ilike."x,outcome.eq.won"');
  });

  it("escapes wildcards in a submitted email so they only match literally", async () => {
    await findOrInsertLead(leadInput({ email: "%@example.com", phone: null }));
    const orFilter = state.selects[0].filters.find((f) => f.method === "or")!;
    expect(orFilter.args[0]).toBe('email.ilike."\\\\%@example.com"');
  });

  it("accepts phone-only submissions and dedups on phone alone", async () => {
    const result = await findOrInsertLead(leadInput({ email: null, phone: "5145551234" }));
    expect(result).toEqual({ ok: true, lead_id: "new-lead-id", deduped: false });

    const orFilter = state.selects[0].filters.find((f) => f.method === "or")!;
    expect(orFilter.args[0]).toBe('phone.eq."5145551234"');
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
    expect(sendNewLeadNotificationMock).toHaveBeenCalledWith({
      leadId: "new-lead-id",
      storeId: "rf_transparent",
      source: "website",
      sourceDetail: "contact-form",
      pageUrl: "https://example.com/contact",
      name: "Jane Doe",
      email: "jane@example.com",
      phone: null,
      message: "Need a quote",
      installationRequested: null,
    });
  });

  it("stores the extracted installation preference", async () => {
    const result = await findOrInsertLead(leadInput({ installation_requested: true }));

    expect(result).toEqual({ ok: true, lead_id: "new-lead-id", deduped: false });
    expect(state.inserts[0].installation_requested).toBe(true);
  });

  it("does not notify for a historical import", async () => {
    const result = await findOrInsertLead(leadInput({ send_notification: false }));

    expect(result).toEqual({ ok: true, lead_id: "new-lead-id", deduped: false });
    expect(sendNewLeadNotificationMock).not.toHaveBeenCalled();
  });

  it("closes obvious marketing spam without sending a notification", async () => {
    const result = await findOrInsertLead(leadInput({
      message: "We can improve your Google ranking with high authority backlinks",
    }));

    expect(result).toEqual({ ok: true, lead_id: "new-lead-id", deduped: false });
    expect(state.inserts[0]).toMatchObject({
      outcome: "not_applicable",
      not_applicable_reason: "Spam: marketing solicitation",
    });
    expect(sendNewLeadNotificationMock).not.toHaveBeenCalled();
  });

  it("does not overwrite a completed workflow when a duplicate looks like spam", async () => {
    state.dedupResult = {
      id: "existing-lead",
      outcome: "won",
    };

    await findOrInsertLead(leadInput({
      message: "We provide guest posts and backlinks",
    }));

    expect(state.updates[0]).not.toHaveProperty("outcome");
    expect(state.updates[0]).not.toHaveProperty("not_applicable_reason");
  });

  it("keeps a saved lead successful when notification delivery throws", async () => {
    sendNewLeadNotificationMock.mockRejectedValueOnce(new Error("Resend unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await findOrInsertLead(leadInput());

    expect(result).toEqual({ ok: true, lead_id: "new-lead-id", deduped: false });
    expect(state.inserts).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[leads] notification failed:",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("preserves provider submission time without inserting the helper external_id field", async () => {
    const result = await findOrInsertLead(
      leadInput({
        source: "meta",
        external_id: "meta-456",
        submitted_at: "2026-07-28T12:30:00.000Z",
        raw_payload: { meta_lead_id: "meta-456" },
      }),
    );

    expect(result).toEqual({ ok: true, lead_id: "new-lead-id", deduped: false });
    expect(state.inserts[0]).toMatchObject({
      source: "meta",
      submitted_at: "2026-07-28T12:30:00.000Z",
      raw_payload: { meta_lead_id: "meta-456" },
    });
    expect(state.inserts[0]).not.toHaveProperty("external_id");
  });

  it("surfaces insert errors", async () => {
    state.insertResult = { data: null, error: { message: "boom" } };
    const result = await findOrInsertLead(leadInput());
    expect(result).toEqual({ ok: false, error: "boom" });
    expect(sendNewLeadNotificationMock).not.toHaveBeenCalled();
  });
});

describe("extractContactFields fallback scan", () => {
  it("finds an email and phone under unrecognised French field keys", async () => {
    const { extractContactFields } = await import("@/lib/customer-service/leads");
    const result = extractContactFields({
      fields: {
        "text-7": "Sylvie",
        "text-8": "Mayer",
        "courriel-1": "sylvie@example.com",
        "tel-9": "+1 819 629 7443",
        "select-1": "Noir mat",
      },
    });
    expect(result.email).toBe("sylvie@example.com");
    expect(result.phone).toBe("+1 819 629 7443");
  });
});
