import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { canPreviewProblemPhoto, matchesProblemPhotoSignature, problemPhotoType } from "./problem-attachments";

describe("problem picture formats", () => {
  it("recognizes iPhone files with a missing browser MIME type but rejects SVG", () => {
    expect(problemPhotoType({ name: "IMG_100.HEIC", type: "" })).toBe("image/heic");
    expect(problemPhotoType({ name: "photo.jpg", type: "application/octet-stream" })).toBe("image/jpeg");
    expect(problemPhotoType({ name: "photo.svg", type: "image/svg+xml" })).toBeNull();
    expect(canPreviewProblemPhoto("image/heic")).toBe(false);
    expect(canPreviewProblemPhoto("image/jpeg")).toBe(true);
  });

  it("checks WebP and HEIC container signatures", () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(matchesProblemPhotoSignature(bytes("RIFF0000WEBP0000"), "image/webp")).toBe(true);
    expect(matchesProblemPhotoSignature(bytes("0000ftypheic0000mif1"), "image/heic")).toBe(true);
    expect(matchesProblemPhotoSignature(bytes("0000ftypmp420000mp42"), "image/heic")).toBe(false);
    expect(matchesProblemPhotoSignature(bytes("<html>not a photo</html>"), "image/jpeg")).toBe(false);
  });
});

it("creates private picture storage with size/type constraints and cascades metadata on ticket deletion", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table public.problem_tickets (id uuid primary key default gen_random_uuid());
    `);
    const migration = readFileSync(new URL("../../supabase/migrations/20260925120000_problem_attachments.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const bucket = await db.query<{ public: boolean; file_size_limit: number }>("select public, file_size_limit from storage.buckets where id = 'problem-attachments'");
    expect(bucket.rows).toEqual([{ public: false, file_size_limit: 4194304 }]);
    const rls = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.problem_attachments'::regclass");
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const permissions = await db.query<{ anon_read: boolean; staff_read: boolean }>("select has_table_privilege('anon', 'public.problem_attachments', 'SELECT') as anon_read, has_table_privilege('authenticated', 'public.problem_attachments', 'SELECT') as staff_read");
    expect(permissions.rows[0]).toEqual({ anon_read: false, staff_read: false });
    const id = "00000000-0000-4000-8000-000000000001";
    await db.query("insert into problem_tickets(id) values ($1)", [id]);
    const insert = "insert into problem_attachments(ticket_id, path, filename, content_type, size_bytes, uploaded_by) values ($1, $2, 'photo', $3, $4, 'staff@example.com')";
    await expect(db.query(insert, [id, "oversized", "image/png", 4194305])).rejects.toThrow();
    await expect(db.query(insert, [id, "svg", "image/svg+xml", 20])).rejects.toThrow();
    await db.query(insert, [id, "ticket/photo", "image/png", 100]);
    await db.query("delete from problem_tickets where id = $1", [id]);
    expect((await db.query("select id from problem_attachments")).rows).toHaveLength(0);
  } finally { await db.close(); }
});
