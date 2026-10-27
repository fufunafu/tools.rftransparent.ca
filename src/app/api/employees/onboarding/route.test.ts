import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminUser: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  sendOnboardingEmail: vi.fn(),
  recordSettingChange: vi.fn(),
  getSupabase: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  isAdminUser: mocks.isAdminUser,
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/onboarding-email", () => ({
  sendOnboardingEmail: mocks.sendOnboardingEmail,
}));
vi.mock("@/lib/settings-audit", () => ({
  recordSettingChange: mocks.recordSettingChange,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: mocks.getSupabase,
}));

import { POST } from "@/app/api/employees/onboarding/route";

const EMPLOYEE = {
  id: "emp-1",
  name: "Dilan Kaya",
  email: "dilan@glass-railing.com",
  department: "warehouse",
  hire_date: "2026-09-01",
};

// Everything handed to an insert during a test, the employees row and the
// employee_access rows alike, so the assertion below is about what the tables
// really receive. Each entry is a list of rows.
const inserted: Record<string, unknown>[][] = [];

function rowsOf(payload: unknown): Record<string, unknown>[] {
  return (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
}

function makeClient(opts: {
  accessError?: { message: string } | null;
  employeeError?: { message: string; code?: string } | null;
} = {}) {
  return {
    from(table: string) {
      if (table === "employees") {
        return {
          insert: (payload: unknown) => {
            inserted.push(rowsOf(payload));
            const result = opts.employeeError
              ? { data: null, error: opts.employeeError }
              : { data: EMPLOYEE, error: null };
            return {
              select: () => ({ single: async () => result }),
            };
          },
        };
      }
      return {
        insert: async (payload: unknown) => {
          inserted.push(rowsOf(payload));
          return { error: opts.accessError ?? null };
        },
      };
    },
    auth: {
      admin: {
        // Provisioning succeeds by default; the tests that care override it.
        createUser: vi.fn().mockResolvedValue({ error: null }),
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        updateUserById: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  };
}

function request(body: Record<string, unknown>) {
  return new NextRequest("https://tools.rftransparent.ca/api/employees/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  name: "Dilan Kaya",
  email: "Dilan@Glass-Railing.com",
  department: "warehouse",
  tools_sign_in: "google",
  access: [{ system: "RF Tools", login_method: "google_sso", owner_email: "info@glass-railing.com" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.isAdminUser.mockResolvedValue(true);
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "admin@example.com" });
  mocks.sendOnboardingEmail.mockResolvedValue(true);
  mocks.recordSettingChange.mockResolvedValue(undefined);
  mocks.getSupabase.mockReturnValue(makeClient());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/employees/onboarding", () => {
  it("refuses anyone who is not an admin", async () => {
    mocks.isAdminUser.mockResolvedValue(false);

    const response = await POST(request(VALID));

    expect(response.status).toBe(403);
    expect(mocks.getSupabase).not.toHaveBeenCalled();
    expect(mocks.sendOnboardingEmail).not.toHaveBeenCalled();
  });

  it("requires a work email, because the welcome message is the point", async () => {
    const withoutEmail: Record<string, unknown> = { ...VALID };
    delete withoutEmail.email;

    const response = await POST(request(withoutEmail));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: "email" });
  });

  it("refuses the password method without a long enough password", async () => {
    const response = await POST(request({ ...VALID, tools_sign_in: "password", password: "short" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: "password" });
  });

  it("creates the employee, the access rows and the email", async () => {
    const response = await POST(request(VALID));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.employee.id).toBe("emp-1");
    expect(body.emailed).toBe(true);
    expect(mocks.sendOnboardingEmail).toHaveBeenCalledTimes(1);
    // The address is normalised before anything downstream sees it.
    expect(mocks.sendOnboardingEmail.mock.calls[0][0].email).toBe("dilan@glass-railing.com");
    expect(mocks.sendOnboardingEmail.mock.calls[0][0].toolsSignIn).toBe("google");
  });

  it("sends the passwords in the message but writes none of them to the table", async () => {
    const response = await POST(
      request({
        ...VALID,
        tools_sign_in: "password",
        password: "tools-password-1",
        access: [
          { system: "Shopify", login_method: "password", account_id: "dilan", owner_email: "info@glass-railing.com", password: "shopify-secret-1" },
        ],
      }),
    );

    expect(response.status).toBe(201);

    // It reaches the person.
    const message = mocks.sendOnboardingEmail.mock.calls[0][0];
    expect(message.toolsPassword).toBe("tools-password-1");
    expect(message.rows[0].password).toBe("shopify-secret-1");

    // It reaches nothing else. This is the boundary the feature is built on:
    // the welcome message is the only copy. Both inserts are checked, the
    // employees row as well as the access rows, so spreading the request body
    // into either one would fail here.
    expect(inserted).toHaveLength(2);
    const serializedInserts = JSON.stringify(inserted);
    expect(serializedInserts).not.toContain("shopify-secret-1");
    expect(serializedInserts).not.toContain("tools-password-1");
    // No column carries one either — "password" is a legitimate login_method
    // value, so this checks the keys rather than the serialized text.
    for (const payload of inserted) {
      for (const row of payload) {
        expect(Object.keys(row)).not.toContain("password");
      }
    }

    const summary = mocks.recordSettingChange.mock.calls[0][0].summary;
    expect(summary).not.toContain("shopify-secret-1");
    expect(summary).not.toContain("tools-password-1");
  });

  it("records the change under access, since an employees row grants sign-in", async () => {
    await POST(request(VALID));

    expect(mocks.recordSettingChange).toHaveBeenCalledWith(
      expect.objectContaining({ area: "access", actor: "admin@example.com" }),
    );
  });

  it("still succeeds when the welcome email is refused", async () => {
    mocks.sendOnboardingEmail.mockResolvedValue(false);

    const response = await POST(request(VALID));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ emailed: false });
  });

  it("points at the existing profile when the employee was already created", async () => {
    mocks.getSupabase.mockReturnValue(makeClient({
      employeeError: { message: "duplicate key value violates unique constraint", code: "23505" },
    }));

    const response = await POST(request(VALID));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ field: "email" });
    expect(body.error).toContain("dilan@glass-railing.com already exists");
    expect(body.error).not.toContain("duplicate key");
    expect(mocks.sendOnboardingEmail).not.toHaveBeenCalled();
  });

  it("reports when the access rows could not be saved", async () => {
    mocks.getSupabase.mockReturnValue(makeClient({ accessError: { message: "boom" } }));

    const response = await POST(request(VALID));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("access list was not saved"),
    });
    expect(mocks.sendOnboardingEmail).not.toHaveBeenCalled();
  });
});
