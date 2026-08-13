import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ─── Supabase mock ───────────────────────────────────────────────────────────
// authz builds chains like:
//   from("employees").select("id").or(...).eq("active", true).maybeSingle()
//   from("employees").select("id").eq("email", e).eq("active", true).maybeSingle()
//   from("admin_users").select("email").eq("email", e).maybeSingle()
// The mock records each query (table + filters) and serves per-table result
// queues so tests can script "first query errors, second succeeds" etc.

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface RecordedQuery {
  table: string;
  filters: { method: string; args: unknown[] }[];
}

const state: {
  queries: RecordedQuery[];
  results: Record<string, QueryResult[]>;
  throwTables: Set<string>;
} = { queries: [], results: {}, throwTables: new Set() };

function nextResult(table: string): QueryResult {
  const queue = state.results[table];
  if (queue && queue.length > 0) return queue.shift()!;
  return { data: null, error: null };
}

function makeChain(table: string) {
  const rec: RecordedQuery = { table, filters: [] };
  state.queries.push(rec);
  const chain = {
    select: () => chain,
    or: (...args: unknown[]) => {
      rec.filters.push({ method: "or", args });
      return chain;
    },
    eq: (...args: unknown[]) => {
      rec.filters.push({ method: "eq", args });
      return chain;
    },
    maybeSingle: () => {
      if (state.throwTables.has(table)) {
        return Promise.reject(new Error(`relation "${table}" does not exist`));
      }
      return Promise.resolve(nextResult(table));
    },
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ from: (table: string) => makeChain(table) }),
}));

import { isAuthorizedEmail, isAdminEmail, isManagementEmail } from "@/lib/authz";

const OWNER = "fuannegao25@gmail.com";
const ORIGINAL_DOMAINS = process.env.ADMIN_ALLOWED_DOMAINS;

beforeEach(() => {
  state.queries = [];
  state.results = {};
  state.throwTables = new Set();
  delete process.env.ADMIN_ALLOWED_DOMAINS;
});

afterAll(() => {
  if (ORIGINAL_DOMAINS !== undefined) {
    process.env.ADMIN_ALLOWED_DOMAINS = ORIGINAL_DOMAINS;
  } else {
    delete process.env.ADMIN_ALLOWED_DOMAINS;
  }
});

function queriedTables(): string[] {
  return state.queries.map((q) => q.table);
}

// ─── isAuthorizedEmail ──────────────────────────────────────────────────────

describe("isAuthorizedEmail", () => {
  it("always authorizes the owner without touching the database", async () => {
    expect(await isAuthorizedEmail(OWNER)).toBe(true);
    expect(state.queries).toHaveLength(0);
  });

  it("normalizes case and whitespace before matching the owner", async () => {
    expect(await isAuthorizedEmail("  FUANNEGAO25@GMAIL.COM  ")).toBe(true);
    expect(state.queries).toHaveLength(0);
  });

  it("rejects null, undefined, and empty emails without querying", async () => {
    expect(await isAuthorizedEmail(null)).toBe(false);
    expect(await isAuthorizedEmail(undefined)).toBe(false);
    expect(await isAuthorizedEmail("")).toBe(false);
    expect(await isAuthorizedEmail("   ")).toBe(false);
    expect(state.queries).toHaveLength(0);
  });

  it("authorizes emails on an allowed domain (ADMIN_ALLOWED_DOMAINS)", async () => {
    process.env.ADMIN_ALLOWED_DOMAINS = "rftransparent.ca, Example.COM";
    expect(await isAuthorizedEmail("sales@rftransparent.ca")).toBe(true);
    expect(await isAuthorizedEmail("USER@EXAMPLE.COM")).toBe(true);
    expect(state.queries).toHaveLength(0); // domain match short-circuits DB
  });

  it("falls through domain check to employees then admin_users, and denies", async () => {
    process.env.ADMIN_ALLOWED_DOMAINS = "rftransparent.ca";
    expect(await isAuthorizedEmail("stranger@elsewhere.com")).toBe(false);
    expect(queriedTables()).toEqual(["employees", "admin_users"]);
  });

  it("authorizes an active employee via the primary/alt email OR filter", async () => {
    state.results["employees"] = [{ data: { id: "emp-1" }, error: null }];
    expect(await isAuthorizedEmail("Worker@Shop.com")).toBe(true);

    const empQuery = state.queries.find((q) => q.table === "employees")!;
    const orFilter = empQuery.filters.find((f) => f.method === "or")!;
    expect(orFilter.args[0]).toBe('email.eq."worker@shop.com",email_alt.eq."worker@shop.com"');
    const eqFilter = empQuery.filters.find((f) => f.method === "eq")!;
    expect(eqFilter.args).toEqual(["active", true]);
    // Matched on employees — admin_users never consulted
    expect(queriedTables()).toEqual(["employees"]);
  });

  it("falls back to a primary-email-only lookup when email_alt is not migrated", async () => {
    state.results["employees"] = [
      { data: null, error: { message: "column employees.email_alt does not exist" } },
      { data: { id: "emp-1" }, error: null },
    ];
    expect(await isAuthorizedEmail("worker@shop.com")).toBe(true);

    const empQueries = state.queries.filter((q) => q.table === "employees");
    expect(empQueries).toHaveLength(2);
    // Fallback query filters on primary email + active only
    expect(empQueries[1].filters).toEqual([
      { method: "eq", args: ["email", "worker@shop.com"] },
      { method: "eq", args: ["active", true] },
    ]);
  });

  it("authorizes a manual admin_users override when not an employee", async () => {
    state.results["admin_users"] = [{ data: { email: "override@x.com" }, error: null }];
    expect(await isAuthorizedEmail("override@x.com")).toBe(true);
    expect(queriedTables()).toEqual(["employees", "admin_users"]);
  });

  it("denies (without crashing) when the admin_users table does not exist", async () => {
    state.throwTables.add("admin_users");
    expect(await isAuthorizedEmail("nobody@x.com")).toBe(false);
  });
});

// ─── isAdminEmail ───────────────────────────────────────────────────────────

describe("isAdminEmail", () => {
  it("treats the owner as admin", async () => {
    expect(await isAdminEmail(OWNER)).toBe(true);
    expect(state.queries).toHaveLength(0);
  });

  it("treats allowed-domain emails as admin", async () => {
    process.env.ADMIN_ALLOWED_DOMAINS = "rftransparent.ca";
    expect(await isAdminEmail("sales@rftransparent.ca")).toBe(true);
    expect(state.queries).toHaveLength(0);
  });

  it("does NOT grant admin via the employees table", async () => {
    // Even if the employees table would match, isAdminEmail must not consult it
    state.results["employees"] = [{ data: { id: "emp-1" }, error: null }];
    expect(await isAdminEmail("worker@shop.com")).toBe(false);
    expect(queriedTables()).toEqual(["admin_users"]);
  });

  it("grants admin via an admin_users override", async () => {
    state.results["admin_users"] = [{ data: { email: "override@x.com" }, error: null }];
    expect(await isAdminEmail("override@x.com")).toBe(true);
  });

  it("rejects empty input", async () => {
    expect(await isAdminEmail(null)).toBe(false);
    expect(await isAdminEmail("")).toBe(false);
    expect(state.queries).toHaveLength(0);
  });
});

// ─── isManagementEmail ──────────────────────────────────────────────────────

describe("isManagementEmail", () => {
  it("treats the owner as management", async () => {
    expect(await isManagementEmail(OWNER)).toBe(true);
    expect(state.queries).toHaveLength(0);
  });

  it("accepts an active management-department employee", async () => {
    state.results["employees"] = [{ data: { id: "emp-9" }, error: null }];
    expect(await isManagementEmail("boss@shop.com")).toBe(true);

    const empQuery = state.queries.find((q) => q.table === "employees")!;
    const eqFilters = empQuery.filters.filter((f) => f.method === "eq");
    expect(eqFilters).toContainEqual({ method: "eq", args: ["active", true] });
    expect(eqFilters).toContainEqual({ method: "eq", args: ["department", "management"] });
  });

  it("rejects a non-management employee", async () => {
    // Query with the department filter finds nothing
    state.results["employees"] = [{ data: null, error: null }];
    expect(await isManagementEmail("worker@shop.com")).toBe(false);
  });

  it("does not grant management via allowed domains or admin_users", async () => {
    process.env.ADMIN_ALLOWED_DOMAINS = "rftransparent.ca";
    state.results["admin_users"] = [{ data: { email: "sales@rftransparent.ca" }, error: null }];
    expect(await isManagementEmail("sales@rftransparent.ca")).toBe(false);
    // Only the employees table is consulted
    expect(queriedTables()).toEqual(["employees"]);
  });

  it("uses the primary-email fallback when email_alt is not migrated", async () => {
    state.results["employees"] = [
      { data: null, error: { message: "column employees.email_alt does not exist" } },
      { data: { id: "emp-9" }, error: null },
    ];
    expect(await isManagementEmail("boss@shop.com")).toBe(true);
    const empQueries = state.queries.filter((q) => q.table === "employees");
    expect(empQueries).toHaveLength(2);
    expect(empQueries[1].filters).toContainEqual({ method: "eq", args: ["department", "management"] });
  });
});
