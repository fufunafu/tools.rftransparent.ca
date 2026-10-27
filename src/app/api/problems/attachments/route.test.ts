import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_PROBLEM_PHOTO_BYTES, PROBLEM_ATTACHMENT_BUCKET } from "@/lib/problem-attachments";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), admin: vi.fn(), supabase: vi.fn(),
  upload: vi.fn(), remove: vi.fn(), download: vi.fn(),
  insert: vi.fn(), delete: vi.fn(), storageFrom: vi.fn(),
  results: [] as Array<{ data?: unknown; error: unknown }>,
}));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mocks.user, isAdminUser: mocks.admin }));
vi.mock("@/lib/supabase", () => ({ getSupabase: mocks.supabase }));
import { POST, DELETE } from "./route";
import { GET } from "./[id]/route";
import { DELETE as deleteTicket } from "../route";

const ticketId = "00000000-0000-4000-8000-000000000001";
const photoId = "00000000-0000-4000-8000-000000000002";
const photo = {
  id: photoId, ticket_id: ticketId, path: `${ticketId}/${photoId}`,
  filename: "Broken glass – 3.00\u202fPM.png", content_type: "image/png", size_bytes: 9,
  uploaded_by: "staff@example.com", created_at: "2026-09-25T12:00:00Z",
};
const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function uploadRequest(file = new File([pngBytes], photo.filename, { type: "image/png" }), id = ticketId) {
  const form = new FormData();
  form.set("ticket_id", id);
  form.set("id", photoId);
  form.set("file", file);
  return new NextRequest("https://tools.test/api/problems/attachments", { method: "POST", body: form });
}
function deleteRequest() {
  return new NextRequest(`https://tools.test/api/problems/attachments?id=${photoId}`, { method: "DELETE" });
}
function readRequest() {
  return new NextRequest(`https://tools.test/api/problems/attachments/${photoId}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.results = [];
  mocks.user.mockResolvedValue({ email: "staff@example.com" });
  mocks.admin.mockResolvedValue(false);
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.download.mockResolvedValue({ data: new Blob([pngBytes]), error: null });
  mocks.storageFrom.mockReturnValue({ upload: mocks.upload, remove: mocks.remove, download: mocks.download });
  mocks.supabase.mockReturnValue({
    storage: { from: mocks.storageFrom },
    from: () => {
      const result = mocks.results.shift();
      if (!result) throw new Error("Unexpected database call");
      const chain = {
        select: vi.fn(() => chain), eq: vi.fn(() => chain),
        insert: vi.fn((row) => { mocks.insert(row); return chain; }),
        delete: vi.fn(() => { mocks.delete(); return chain; }),
        maybeSingle: vi.fn(async () => result), single: vi.fn(async () => result),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  });
});

describe("problem picture uploads", () => {
  it("requires a staff session before parsing or accessing storage", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(uploadRequest())).status).toBe(401);
    expect(mocks.supabase).not.toHaveBeenCalled();
  });

  it("rejects oversized requests before reading the multipart body", async () => {
    const req = uploadRequest();
    req.headers.set("content-length", String(MAX_PROBLEM_PHOTO_BYTES + 100_000));
    const parse = vi.spyOn(req, "formData");
    expect((await POST(req)).status).toBe(413);
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([
    new File(["<svg/>"], "drawing.svg", { type: "image/svg+xml" }),
    new File(["<script>alert(1)</script>"], "fake.png", { type: "image/png" }),
    new File([], "empty.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array(MAX_PROBLEM_PHOTO_BYTES + 1)], "large.jpg", { type: "image/jpeg" }),
  ])("rejects an unsupported, disguised, empty or oversized picture: $name", async (file) => {
    expect((await POST(uploadRequest(file))).status).toBe(400);
    expect(mocks.supabase).not.toHaveBeenCalled();
  });

  it("rejects path-like ticket IDs", async () => {
    expect((await POST(uploadRequest(undefined, "../../another-ticket"))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("does not upload to a missing ticket", async () => {
    mocks.results.push({ data: null, error: null });
    expect((await POST(uploadRequest())).status).toBe(404);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("stores a picture privately under its ticket with the authenticated uploader", async () => {
    mocks.results.push({ data: { id: ticketId }, error: null }, { data: null, error: null }, { data: photo, error: null });
    const response = await POST(uploadRequest());
    expect(response.status).toBe(201);
    expect(mocks.storageFrom).toHaveBeenCalledWith(PROBLEM_ATTACHMENT_BUCKET);
    expect(mocks.upload).toHaveBeenCalledWith(photo.path, expect.any(File), { contentType: "image/png", upsert: false });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: photoId, ticket_id: ticketId, path: photo.path, uploaded_by: "staff@example.com",
    }));
    expect((await response.json()).attachment.id).toBe(photoId);
  });

  it("returns the saved picture when retrying a lost response without duplicating bytes", async () => {
    mocks.results.push({ data: { id: ticketId }, error: null }, { data: photo, error: null });
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not reuse another user's upload ID", async () => {
    mocks.results.push({ data: { id: ticketId }, error: null }, { data: { ...photo, uploaded_by: "other@example.com" }, error: null });
    expect((await POST(uploadRequest())).status).toBe(409);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("cleans up uploaded bytes if saving the metadata fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.results.push({ data: { id: ticketId }, error: null }, { data: null, error: null }, { data: null, error: { message: "FK violation" } });
      expect((await POST(uploadRequest())).status).toBe(500);
      expect(mocks.remove).toHaveBeenCalledWith([photo.path]);
    } finally { log.mockRestore(); }
  });
});

describe("private picture viewing and removal", () => {
  it("requires authentication to view or remove a picture", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(readRequest(), { params: Promise.resolve({ id: photoId }) })).status).toBe(401);
    expect((await DELETE(deleteRequest())).status).toBe(401);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("serves Unicode filenames safely without public caching", async () => {
    mocks.results.push({ data: photo, error: null });
    const response = await GET(readRequest(), { params: Promise.resolve({ id: photoId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toContain(encodeURIComponent(photo.filename));
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes);
  });

  it("downloads HEIC originals instead of displaying a broken inline preview", async () => {
    mocks.results.push({ data: { ...photo, content_type: "image/heic", filename: "photo.heic" }, error: null });
    const response = await GET(readRequest(), { params: Promise.resolve({ id: photoId }) });
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });

  it("blocks removal by someone other than the uploader or an admin", async () => {
    mocks.results.push({ data: { ...photo, uploaded_by: "other@example.com" }, error: null });
    expect((await DELETE(deleteRequest())).status).toBe(403);
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([false, true])("removes metadata and bytes for an authorized uploader/admin (admin: %s)", async (admin) => {
    mocks.admin.mockResolvedValue(admin);
    mocks.results.push({ data: { ...photo, uploaded_by: admin ? "other@example.com" : "staff@example.com" }, error: null }, { error: null });
    expect((await DELETE(deleteRequest())).status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith([photo.path]);
  });
});

describe("deleting a ticket with pictures", () => {
  const request = () => new NextRequest(`https://tools.test/api/problems?id=${ticketId}`, { method: "DELETE" });
  it("keeps ticket deletion restricted to admins", async () => {
    expect((await deleteTicket(request())).status).toBe(403);
    expect(mocks.supabase).not.toHaveBeenCalled();
  });
  it("removes stored pictures after the ticket and metadata are deleted", async () => {
    mocks.admin.mockResolvedValue(true);
    mocks.results.push({ data: [{ path: photo.path }], error: null }, { error: null });
    expect((await deleteTicket(request())).status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith([photo.path]);
  });
  it("preserves picture bytes if deleting the ticket fails", async () => {
    mocks.admin.mockResolvedValue(true);
    mocks.results.push({ data: [{ path: photo.path }], error: null }, { error: { message: "Delete failed" } });
    expect((await deleteTicket(request())).status).toBe(500);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
