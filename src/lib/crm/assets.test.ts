import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { allowedAssetUrl, downloadCrmAsset, ensureCrmAssetBucket, MAX_CRM_ASSET_BYTES, migrateCrmAssets } from "./assets.mjs";

const asset = { id: "hubspot:1:file:2", kind: "file", portal_id: "1", remote_id: "2", source_url: null };
const cdn = "https://files.hubspotusercontent-na1.net/private/file.pdf?signature=private";
function fileFetcher(bytes = "PDF content", size = Buffer.byteLength(bytes)) {
  return vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.endsWith("/account-info/v3/details")) return Response.json({ portalId: 1 });
    if (url.endsWith("/files/v3/files/2")) return Response.json({ id: "2", name: "drawing", extension: "pdf", size });
    if (url.endsWith("/signed-url")) return Response.json({ url: cdn });
    return new Response(bytes, { headers: { "Content-Type": "application/pdf" } });
  });
}
describe("private CRM file migration", () => {
  it("allows only known HTTPS hosts and portal-specific authenticated recording paths", () => {
    expect(allowedAssetUrl(cdn, "1").authenticatedRecording).toBe(false);
    expect(allowedAssetUrl("https://api-na1.hubspot.com/recording/auth/provider/hublets/v1/external-url-retriever/getAuthRecording/portal/1/engagement/2", "1", true).authenticatedRecording).toBe(true);
    for (const value of ["http://files.hubspot.net/file", "https://files.hubspot.net.evil.example/file", "https://127.0.0.1/file", "https://files.hubspot.net:8080/file", "https://user:pass@files.hubspot.net/file", "https://api-na1.hubspot.com/anything"]) expect(() => allowedAssetUrl(value, "1", true)).toThrow("unsupported_source");
    expect(() => allowedAssetUrl("https://api-na1.hubspot.com/recording/auth/provider/hublets/v1/external-url-retriever/getAuthRecording/portal/2/engagement/2", "1", true)).toThrow();
  });
  it("checks metadata size and hashes the bytes without sending the HubSpot key to the CDN", async () => {
    const fetcher = fileFetcher();
    const file = await downloadCrmAsset(asset, "private-token", fetcher);
    expect(file.filename).toBe("drawing.pdf");
    expect(file.sha256).toBe(createHash("sha256").update("PDF content").digest("hex"));
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer private-token" }, redirect: "error" });
    expect(fetcher.mock.calls[3][1]).not.toHaveProperty("headers");
    await expect(downloadCrmAsset(asset, "private-token", fileFetcher("short", 100))).rejects.toThrow("size_mismatch");
  });
  it("blocks redirect escapes and never fetches internal or arbitrary destinations", async () => {
    const base = fileFetcher();
    const fetcher = vi.fn<typeof fetch>(async url => String(url) === cdn ? new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/secret" } }) : base(url));
    await expect(downloadCrmAsset(asset, "private-token", fetcher)).rejects.toThrow("unsupported_source");
    expect(fetcher.mock.calls.map(call => call[0])).not.toContain("https://127.0.0.1/secret");
  });
  it("reports missing scope without exposing the upstream response or losing the reference", async () => {
    const fetcher = vi.fn(async () => new Response("upstream sensitive detail", { status: 403 }));
    await expect(downloadCrmAsset(asset, "private-token", fetcher)).rejects.toMatchObject({ code: "hubspot_file_access", blocked: true });
    expect(asset.id).toBe("hubspot:1:file:2");
  });
  it("stops oversized copies before downloading them and rejects recording login pages", async () => {
    const fetcher = fileFetcher("", MAX_CRM_ASSET_BYTES + 1);
    await expect(downloadCrmAsset(asset, "token", fetcher)).rejects.toThrow("file_too_large");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(downloadCrmAsset({ ...asset, kind: "recording", source_url: cdn }, "token", vi.fn<typeof fetch>(async url => String(url).endsWith("/account-info/v3/details") ? Response.json({ portalId: 1 }) : new Response("Sign in", { headers: { "Content-Type": "text/html" } })))).rejects.toThrow("recording_access");
  });
  it("refuses a public storage bucket", async () => {
    const db = { storage: { getBucket: vi.fn(async () => ({ data: { public: true } })), createBucket: vi.fn() } };
    await expect(ensureCrmAssetBucket(db)).rejects.toThrow("storage_not_private");
    expect(db.storage.createBucket).not.toHaveBeenCalled();
  });
  it("marks a file complete only after the retained copy has the same bytes and checksum", async () => {
    const uploaded = { upload: vi.fn<(path: string, data: unknown, options: object) => Promise<{ error: null }>>(async () => ({ error: null })), download: vi.fn(async () => ({ data: new Blob(["PDF content"]), error: null })) };
    const db = { from: () => ({ select: async () => ({ data: [] }) }), storage: { getBucket: vi.fn(async () => ({ data: { public: false } })), from: vi.fn(() => uploaded) }, rpc: vi.fn().mockResolvedValueOnce({ data: [asset] }).mockResolvedValueOnce({ data: true }) };
    expect(await migrateCrmAssets(db, "token", { limit: 1, fetcher: fileFetcher() })).toEqual({ copied: 1, blocked: 0, failed: 0 });
    expect(db.rpc.mock.calls[1][1].p_result).toMatchObject({ status: "ready", byte_size: 11, filename: "drawing.pdf" });
    expect(uploaded.upload.mock.calls[0][2]).toMatchObject({ contentType: "application/octet-stream", upsert: true });
    uploaded.download.mockResolvedValueOnce({ data: new Blob(["corrupted"]), error: null });
    db.rpc.mockResolvedValueOnce({ data: [asset] }).mockResolvedValueOnce({ data: true });
    expect(await migrateCrmAssets(db, "token", { limit: 1, fetcher: fileFetcher() })).toEqual({ copied: 0, blocked: 0, failed: 1 });
    expect(db.rpc.mock.calls.filter(call => call[0] === "crm_finish_asset").at(-1)![1].p_result).toMatchObject({ status: "failed", error_code: "storage_verification" });
  });
});
it("reuses an account check only for the same key and verifies a rotated key again", async () => {
  const fetcher = fileFetcher();
  await downloadCrmAsset(asset, "key-one", fetcher); await downloadCrmAsset(asset, "key-one", fetcher);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/account-info/v3/details"))).toHaveLength(1);
  await downloadCrmAsset(asset, "key-two", fetcher);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/account-info/v3/details"))).toHaveLength(2);
});
