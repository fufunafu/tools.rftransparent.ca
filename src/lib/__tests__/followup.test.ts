import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Supabase mock ───────────────────────────────────────────────────────────
// An in-memory table double that supports every chain shape followup.ts uses:
//   from("followup_config").select(...).eq(...)                       → await
//   from("followup_leads").select(...).eq(...).range(a, b)            → await
//   from("followup_leads").select(...).eq(...).in(...)                → await
//   from("followup_leads").upsert(rows, opts)                         → await
//   from("followup_leads").update(values).eq("id", id).then(cb)
//   from("followup_logs").insert(row)                                 → await

type Row = Record<string, unknown>;

const db: {
  configRows: Row[];
  leadRows: Row[];
  upserts: { table: string; rows: Row[] }[];
  updates: { table: string; values: Row; id: unknown }[];
  logInserts: Row[];
} = { configRows: [], leadRows: [], upserts: [], updates: [], logInserts: [] };

interface Filter {
  method: "eq" | "in";
  col: string;
  val: unknown;
}

function makeChain(table: string) {
  let op: "select" | "update" | "upsert" | "insert" = "select";
  let values: Row | Row[] | null = null;
  const filters: Filter[] = [];
  let range: [number, number] | null = null;

  const exec = async (): Promise<{ data: Row[] | null; error: null }> => {
    if (op === "select") {
      let rows: Row[] =
        table === "followup_config" ? db.configRows : table === "followup_leads" ? db.leadRows : [];
      for (const f of filters) {
        if (f.method === "eq") rows = rows.filter((r) => r[f.col] === f.val);
        if (f.method === "in") rows = rows.filter((r) => (f.val as unknown[]).includes(r[f.col]));
      }
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return { data: rows, error: null };
    }
    if (op === "upsert") {
      db.upserts.push({ table, rows: values as Row[] });
      return { data: null, error: null };
    }
    if (op === "update") {
      const idFilter = filters.find((f) => f.method === "eq" && f.col === "id");
      db.updates.push({ table, values: values as Row, id: idFilter?.val });
      return { data: null, error: null };
    }
    // insert
    if (table === "followup_logs") db.logInserts.push(values as Row);
    return { data: null, error: null };
  };

  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters.push({ method: "eq", col, val });
      return chain;
    },
    in: (col: string, val: unknown[]) => {
      filters.push({ method: "in", col, val });
      return chain;
    },
    range: (a: number, b: number) => {
      range = [a, b];
      return chain;
    },
    update: (v: Row) => {
      op = "update";
      values = v;
      return chain;
    },
    upsert: (v: Row[]) => {
      op = "upsert";
      values = v;
      return chain;
    },
    insert: (v: Row) => {
      op = "insert";
      values = v;
      return chain;
    },
    then: (
      onFulfilled?: (value: { data: Row[] | null; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => exec().then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ from: (table: string) => makeChain(table) }),
}));

vi.mock("@/lib/shopify", () => ({
  getStores: vi.fn(() => []),
  shopifyGraphQL: vi.fn(),
  REVENUE_FIELDS: "subtotalPriceSet { shopMoney { amount } }",
}));

import {
  syncDraftOrdersForStore,
  computeNextFollowup,
  getFollowupDaysForStore,
  FOLLOWUP_CATEGORIES,
  DEFAULT_FOLLOWUP_DAYS,
} from "@/lib/followup";
import { shopifyGraphQL } from "@/lib/shopify";

const mockShopifyGraphQL = vi.mocked(shopifyGraphQL);

// ─── Shopify draft builder ───────────────────────────────────────────────────

let draftSeq = 0;

interface DraftOrder {
  id: string;
  createdAt: string;
  staffMember?: { firstName: string | null; lastName: string | null } | null;
}

function makeDraft(over: {
  id?: string;
  status?: string;
  amount?: string;
  order?: DraftOrder | null;
  email?: string | null;
  events?: string[];
} = {}) {
  draftSeq++;
  return {
    id: over.id ?? `gid://shopify/DraftOrder/${draftSeq}`,
    name: `#D${draftSeq}`,
    createdAt: "2026-07-01T12:00:00Z",
    status: over.status ?? "INVOICE_SENT",
    subtotalPriceSet: { shopMoney: { amount: over.amount ?? "100.00" } },
    tags: [] as string[],
    order: over.order ?? null,
    customer: {
      displayName: "Jane Customer",
      email: over.email === undefined ? "jane@example.com" : over.email,
      phone: null,
      numberOfOrders: "1",
    },
    events: {
      edges: (over.events ?? []).map((message) => ({
        node: { message, createdAt: "2026-07-01T12:00:00Z" },
      })),
    },
  };
}

type Draft = ReturnType<typeof makeDraft>;

function setShopifyDrafts(invoiceSent: Draft[], completed: Draft[]) {
  mockShopifyGraphQL.mockImplementation(async (_storeId, query) => {
    const list = String(query).includes("status:completed") ? completed : invoiceSent;
    return {
      draftOrders: {
        edges: list.map((node, i) => ({ node, cursor: `c${i}` })),
        pageInfo: { hasNextPage: false },
      },
    };
  });
}

function existingLead(over: Partial<Row> & { shopify_draft_id: string }): Row {
  return {
    id: `lead-${over.shopify_draft_id}`,
    store_id: "store1",
    lead_status: "new",
    shopify_status: "INVOICE_SENT",
    ...over,
  };
}

function upsertedRows(): Row[] {
  return db.upserts.flatMap((u) => u.rows);
}

beforeEach(() => {
  db.configRows = [];
  db.leadRows = [];
  db.upserts = [];
  db.updates = [];
  db.logInserts = [];
  mockShopifyGraphQL.mockReset();
});

// ─── Category configuration sanity ──────────────────────────────────────────

describe("FOLLOWUP_CATEGORIES", () => {
  it("agrees with DEFAULT_FOLLOWUP_DAYS for every category", () => {
    expect(Object.keys(FOLLOWUP_CATEGORIES).sort()).toEqual(
      Object.keys(DEFAULT_FOLLOWUP_DAYS).sort(),
    );
    for (const [key, cat] of Object.entries(FOLLOWUP_CATEGORIES)) {
      expect(cat.followupDays).toBe(DEFAULT_FOLLOWUP_DAYS[key]);
    }
  });

  it("gives every terminal category a null follow-up interval", () => {
    for (const cat of Object.values(FOLLOWUP_CATEGORIES)) {
      if (cat.terminal) expect(cat.followupDays).toBeNull();
    }
  });
});

// ─── computeNextFollowup ─────────────────────────────────────────────────────

describe("computeNextFollowup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Friday, July 24 2026, 11:00 in Toronto
    vi.setSystemTime(new Date("2026-07-24T15:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for terminal statuses", () => {
    expect(computeNextFollowup("won", DEFAULT_FOLLOWUP_DAYS)).toBeNull();
    expect(computeNextFollowup("lost", DEFAULT_FOLLOWUP_DAYS)).toBeNull();
    expect(computeNextFollowup("duplicate", DEFAULT_FOLLOWUP_DAYS)).toBeNull();
  });

  it("respects the explicit custom date for future_project", () => {
    const result = computeNextFollowup("future_project", DEFAULT_FOLLOWUP_DAYS, "2026-09-15");
    expect(result).toBe(new Date("2026-09-15").toISOString());
  });

  it("returns null for future_project without a custom date", () => {
    expect(computeNextFollowup("future_project", DEFAULT_FOLLOWUP_DAYS)).toBeNull();
  });

  it("skips weekends: 2 days from Friday lands on Tuesday", () => {
    const result = computeNextFollowup("no_answer", DEFAULT_FOLLOWUP_DAYS)!;
    expect(result.slice(0, 10)).toBe("2026-07-28"); // Tue (Sat+Sun skipped)
  });

  it("schedules 3 business days from Friday for a new lead (Wednesday)", () => {
    const result = computeNextFollowup("new", DEFAULT_FOLLOWUP_DAYS)!;
    expect(result.slice(0, 10)).toBe("2026-07-29");
  });

  it("hot leads get next business day: 1 day from Friday is Monday", () => {
    const result = computeNextFollowup("hot_lead", DEFAULT_FOLLOWUP_DAYS)!;
    expect(result.slice(0, 10)).toBe("2026-07-27");
  });

  it("uses per-store day overrides when provided", () => {
    const result = computeNextFollowup("new", { ...DEFAULT_FOLLOWUP_DAYS, new: 1 })!;
    expect(result.slice(0, 10)).toBe("2026-07-27"); // Monday, not Wednesday
  });

  it("a zero-day override means today", () => {
    const result = computeNextFollowup("new", { ...DEFAULT_FOLLOWUP_DAYS, new: 0 })!;
    expect(result).toBe(new Date().toISOString());
  });

  it("a store null override falls back to the category default (current behavior)", () => {
    // NOTE: `storeDays[status] ?? cat.followupDays` treats an explicit null the
    // same as "not configured", so a store cannot disable follow-ups for a
    // category that has a default interval. This test documents that behavior.
    const result = computeNextFollowup("no_answer", { ...DEFAULT_FOLLOWUP_DAYS, no_answer: null });
    expect(result).not.toBeNull();
    expect(result!.slice(0, 10)).toBe("2026-07-28");
  });
});

// ─── getFollowupDaysForStore ─────────────────────────────────────────────────

describe("getFollowupDaysForStore", () => {
  it("returns the defaults when the store has no overrides", async () => {
    const days = await getFollowupDaysForStore("store1");
    expect(days).toEqual(DEFAULT_FOLLOWUP_DAYS);
    expect(days).not.toBe(DEFAULT_FOLLOWUP_DAYS); // fresh copy, not the shared object
  });

  it("applies store-specific overrides, including null", async () => {
    db.configRows = [
      { store_id: "store1", category: "new", followup_days: 5 },
      { store_id: "store1", category: "no_answer", followup_days: null },
    ];
    const days = await getFollowupDaysForStore("store1");
    expect(days["new"]).toBe(5);
    expect(days["no_answer"]).toBeNull();
    expect(days["hot_lead"]).toBe(1); // untouched default
  });

  it("ignores rows for unknown categories", async () => {
    db.configRows = [{ store_id: "store1", category: "bogus", followup_days: 9 }];
    const days = await getFollowupDaysForStore("store1");
    expect("bogus" in days).toBe(false);
  });

  it("only reads rows for the requested store", async () => {
    db.configRows = [{ store_id: "store2", category: "new", followup_days: 9 }];
    const days = await getFollowupDaysForStore("store1");
    expect(days["new"]).toBe(3);
  });
});

// ─── syncDraftOrdersForStore ─────────────────────────────────────────────────

describe("syncDraftOrdersForStore (full sync)", () => {
  it("inserts a new active lead for an invoiced draft without an order", async () => {
    const draft = makeDraft({ amount: "1234.56", events: ["Alice Smith created this draft order."] });
    setShopifyDrafts([draft], []);

    const result = await syncDraftOrdersForStore("store1");

    expect(result.new_leads).toBe(1);
    expect(result.auto_won).toBe(0);
    expect(result.errors).toBe(0);

    const rows = upsertedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      store_id: "store1",
      shopify_draft_id: draft.id,
      lead_status: "new",
      shopify_status: "INVOICE_SENT",
      quote_amount: 1234.56,
      customer_email: "jane@example.com",
      created_by_staff: "Alice Smith",
      customer_orders_count: 1,
      followup_count: 0,
    });
    // First follow-up ~3 calendar days out (default "new" interval)
    const dueIn = new Date(rows[0].next_followup_at as string).getTime() - Date.now();
    expect(dueIn).toBeGreaterThan(2.9 * 86_400_000);
    expect(dueIn).toBeLessThan(3.1 * 86_400_000);
  });

  it("honors the store's follow-up day override for new leads", async () => {
    db.configRows = [{ store_id: "store1", category: "new", followup_days: 1 }];
    setShopifyDrafts([makeDraft()], []);

    await syncDraftOrdersForStore("store1");

    const dueIn = new Date(upsertedRows()[0].next_followup_at as string).getTime() - Date.now();
    expect(dueIn).toBeGreaterThan(0.9 * 86_400_000);
    expect(dueIn).toBeLessThan(1.1 * 86_400_000);
  });

  it("inserts an unknown invoiced draft with a linked order directly as won", async () => {
    const draft = makeDraft({
      order: { id: "gid://shopify/Order/9", createdAt: "2026-07-10T09:00:00Z" },
    });
    setShopifyDrafts([draft], []);

    const result = await syncDraftOrdersForStore("store1");

    expect(result.new_leads).toBe(0);
    expect(result.auto_won).toBe(1);
    const rows = upsertedRows();
    expect(rows[0]).toMatchObject({
      lead_status: "won",
      next_followup_at: null,
      closed_at: "2026-07-10T09:00:00Z",
    });
  });

  it("auto-wins an existing active lead whose draft gained an order, and logs it", async () => {
    const draft = makeDraft({
      order: { id: "gid://shopify/Order/9", createdAt: "2026-07-10T09:00:00Z" },
    });
    db.leadRows = [existingLead({ shopify_draft_id: draft.id, id: "L1", lead_status: "considering" })];
    setShopifyDrafts([draft], []);

    const result = await syncDraftOrdersForStore("store1");

    expect(result.auto_won).toBe(1);
    expect(result.stale_detected).toBe(0);

    const winUpdate = db.updates.find((u) => u.id === "L1")!;
    expect(winUpdate.values).toMatchObject({
      lead_status: "won",
      closed_at: "2026-07-10T09:00:00Z",
      next_followup_at: null,
    });
    expect(db.logInserts).toHaveLength(1);
    expect(db.logInserts[0]).toMatchObject({
      lead_id: "L1",
      outcome: "won",
      logged_by: "system",
      notes: "Auto-detected: draft order has a linked order",
    });
  });

  it("never flips a lost lead back to won — plain field refresh instead", async () => {
    const draft = makeDraft({
      order: { id: "gid://shopify/Order/9", createdAt: "2026-07-10T09:00:00Z" },
    });
    db.leadRows = [existingLead({ shopify_draft_id: draft.id, id: "L1", lead_status: "lost" })];
    setShopifyDrafts([draft], []);

    const result = await syncDraftOrdersForStore("store1");

    expect(result.auto_won).toBe(0);
    expect(result.updated_leads).toBe(1);
    const update = db.updates.find((u) => u.id === "L1")!;
    expect("lead_status" in update.values).toBe(false);
    expect(db.logInserts).toHaveLength(0);
  });

  it("marks an existing active lead won when its draft is COMPLETED", async () => {
    const draft = makeDraft({ status: "COMPLETED" });
    db.leadRows = [existingLead({ shopify_draft_id: draft.id, id: "L1" })];
    setShopifyDrafts([], [draft]);

    const result = await syncDraftOrdersForStore("store1");

    expect(result.auto_won).toBe(1);
    expect(result.stale_detected).toBe(0); // completed this run — must NOT be marked stale

    const winUpdate = db.updates.find((u) => u.id === "L1")!;
    expect(winUpdate.values).toMatchObject({
      lead_status: "won",
      shopify_status: "COMPLETED",
      next_followup_at: null,
    });
    expect(db.logInserts[0]).toMatchObject({
      lead_id: "L1",
      outcome: "won",
      notes: "Auto-detected from Shopify COMPLETED status",
    });
  });

  it("inserts an unknown COMPLETED draft directly as a won lead", async () => {
    const draft = makeDraft({ status: "COMPLETED" });
    setShopifyDrafts([], [draft]);

    const result = await syncDraftOrdersForStore("store1");

    expect(result.auto_won).toBe(1);
    const rows = upsertedRows();
    expect(rows[0]).toMatchObject({
      shopify_draft_id: draft.id,
      lead_status: "won",
      shopify_status: "COMPLETED",
      next_followup_at: null,
    });
  });

  it("marks leads missing from Shopify as stale (DELETED), leaving closed leads alone", async () => {
    db.leadRows = [
      existingLead({ shopify_draft_id: "gid://gone/1", id: "L-active" }),
      existingLead({ shopify_draft_id: "gid://gone/2", id: "L-won", lead_status: "won" }),
      existingLead({ shopify_draft_id: "gid://gone/3", id: "L-dup", lead_status: "duplicate" }),
    ];
    setShopifyDrafts([], []);

    const result = await syncDraftOrdersForStore("store1");

    expect(result.stale_detected).toBe(1);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].id).toBe("L-active");
    expect(db.updates[0].values).toMatchObject({ shopify_status: "DELETED" });
  });

  it("filters system emails out of the sync so their leads go stale", async () => {
    const draft = makeDraft({ email: "application@gmail.com" });
    db.leadRows = [existingLead({ shopify_draft_id: draft.id, id: "L-system" })];
    setShopifyDrafts([draft], []);

    const result = await syncDraftOrdersForStore("store1");

    expect(result.new_leads).toBe(0);
    expect(upsertedRows()).toHaveLength(0);
    expect(result.stale_detected).toBe(1);
    expect(db.updates[0].values).toMatchObject({ shopify_status: "DELETED" });
  });

  it("prefers the linked order's staff member for attribution", async () => {
    const draft = makeDraft({
      order: {
        id: "gid://shopify/Order/9",
        createdAt: "2026-07-10T09:00:00Z",
        staffMember: { firstName: "Jane", lastName: "Doe" },
      },
      events: [
        "Quotation created this draft order.",
        "Bob Roberts sent an invoice to jane@example.com.",
      ],
    });
    setShopifyDrafts([draft], []);

    await syncDraftOrdersForStore("store1");

    const row = upsertedRows()[0];
    expect(row.created_by_staff).toBe("Jane Doe");
    expect(row.last_invoice_sender).toBe("Bob Roberts");
    // Contributors: creator + invoice sender + closing staff, deduped in order
    expect(row.contributors).toEqual(["Quotation", "Bob Roberts", "Jane Doe"]);
  });

  it("falls back to the invoice sender, then the creation event, for attribution", async () => {
    const invoiced = makeDraft({
      events: [
        "Quotation created this draft order.",
        "Alice Smith sent an invoice to jane@example.com.",
      ],
    });
    const createdOnly = makeDraft({
      events: ["Carol Jones created this draft order."],
    });
    setShopifyDrafts([invoiced, createdOnly], []);

    await syncDraftOrdersForStore("store1");

    const rows = upsertedRows();
    const invoicedRow = rows.find((r) => r.shopify_draft_id === invoiced.id)!;
    expect(invoicedRow.created_by_staff).toBe("Alice Smith");
    expect(invoicedRow.last_invoice_sender).toBe("Alice Smith");

    const createdRow = rows.find((r) => r.shopify_draft_id === createdOnly.id)!;
    expect(createdRow.created_by_staff).toBe("Carol Jones");
    expect(createdRow.last_invoice_sender).toBeNull();
    expect(createdRow.contributors).toEqual(["Carol Jones"]);
  });

  it("refreshes fields on an existing active lead that stayed invoiced", async () => {
    const draft = makeDraft({ amount: "999.00" });
    db.leadRows = [existingLead({ shopify_draft_id: draft.id, id: "L1" })];
    setShopifyDrafts([draft], []);

    const result = await syncDraftOrdersForStore("store1");

    expect(result.updated_leads).toBe(1);
    expect(result.new_leads).toBe(0);
    const update = db.updates.find((u) => u.id === "L1")!;
    expect(update.values).toMatchObject({ quote_amount: 999 });
    expect("lead_status" in update.values).toBe(false);
  });
});

describe("syncDraftOrdersForStore (incremental)", () => {
  it("queries by updated_at and skips stale detection", async () => {
    // A DB lead that a full sync would mark stale (missing from Shopify)
    db.leadRows = [existingLead({ shopify_draft_id: "gid://gone/1", id: "L1" })];
    setShopifyDrafts([], []);

    const result = await syncDraftOrdersForStore("store1", { incremental: true });

    expect(result.stale_detected).toBe(0);
    expect(db.updates).toHaveLength(0);

    // Both the invoice_sent and completed fetches use the updated_at window
    expect(mockShopifyGraphQL).toHaveBeenCalledTimes(2);
    for (const call of mockShopifyGraphQL.mock.calls) {
      expect(String(call[1])).toContain("updated_at:>=");
    }
  });
});
