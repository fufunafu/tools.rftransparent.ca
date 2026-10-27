import { createHash } from "node:crypto";

export const CRM_ASSET_BUCKET = "crm-attachments";
export const MAX_CRM_ASSET_BYTES = 50 * 1024 * 1024;
export class CrmAssetError extends Error {
  constructor(code, blocked = false) { super(code); this.code = code; this.blocked = blocked; }
}

export function allowedAssetUrl(raw, portalId, recording = false) {
  if (!/^\d+$/.test(portalId ?? "")) throw new CrmAssetError("unsupported_source", true);
  let url;
  try { url = new URL(raw); } catch { throw new CrmAssetError("unsupported_source", true); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new CrmAssetError("unsupported_source", true);
  const cdn = /^(?:[a-z0-9-]+\.)*(?:hubspotusercontent(?:-[a-z0-9]+)?\.(?:net|com)|hubspotusercontent\d+\.net|hubspot\.net|hubspotvideo\.com)$/.test(url.hostname);
  const authenticatedRecording = recording && /^api-(?:na|eu)\d+\.hubspot\.com$/.test(url.hostname)
    && new RegExp(`^/recording/auth/provider/hublets/v\\d+/external-url-retriever/getAuthRecording/portal/${portalId}/engagement/\\d+$`).test(url.pathname);
  if (!cdn && !authenticatedRecording) throw new CrmAssetError("unsupported_source", true);
  return { url, authenticatedRecording };
}

const requestSlots = new Map();
async function apiJson(path, token, fetcher) {
  // Leave room below the account's observed 100 requests per 10 seconds for
  // the record importer. File workers share this limiter in each process.
  if (fetcher === fetch) {
    const now = Date.now(); const start = Math.max(now, requestSlots.get(token) ?? now);
    requestSlots.set(token, start + 167);
    if (start > now) await new Promise(resolve => setTimeout(resolve, start - now));
  }
  const response = await fetcher(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000),
  });
  if (response.status === 401 || response.status === 403) throw new CrmAssetError("hubspot_file_access", true);
  if (response.status === 404) throw new CrmAssetError("source_missing", true);
  if (!response.ok) throw new CrmAssetError("source_unavailable");
  return response.json();
}

// Reuse the verified account briefly within this server process. Each key and
// fetch transport has its own entry, so rotation cannot reuse another account.
const accountChecks = new WeakMap();
async function verifiedAccount(token, fetcher) {
  let entries = accountChecks.get(fetcher);
  if (!entries) { entries = new Map(); accountChecks.set(fetcher, entries); }
  const cached = entries.get(token);
  if (cached && cached.until > Date.now()) return cached.promise;
  const promise = apiJson("/account-info/v3/details", token, fetcher);
  entries.set(token, { until: Date.now() + 300000, promise });
  try { return await promise; } catch (error) { entries.delete(token); throw error; }
}

export async function downloadCrmAsset(asset, token, fetcher = fetch) {
  if (!token) throw new CrmAssetError("hubspot_not_configured", true);
  if (!/^\d+$/.test(asset.portal_id)) throw new CrmAssetError("unsupported_source", true);
  const account = await verifiedAccount(token, fetcher);
  if (String(account.portalId) !== asset.portal_id) throw new CrmAssetError("source_mismatch", true);
  let url = asset.source_url;
  let filename = "call-recording";
  let expectedSize = null;
  if (asset.kind === "file") {
    if (!/^\d+$/.test(asset.remote_id ?? "")) throw new CrmAssetError("unsupported_source", true);
    const meta = await apiJson(`/files/v3/files/${asset.remote_id}`, token, fetcher);
    if (String(meta.id) !== asset.remote_id) throw new CrmAssetError("source_mismatch", true);
    filename = String(meta.name || `HubSpot file ${asset.remote_id}`);
    if (meta.extension && !filename.toLowerCase().endsWith(`.${String(meta.extension).toLowerCase()}`)) filename += `.${meta.extension}`;
    if (Number.isSafeInteger(meta.size) && meta.size >= 0) expectedSize = meta.size;
    if (expectedSize > MAX_CRM_ASSET_BYTES) throw new CrmAssetError("file_too_large", true);
    const signed = await apiJson(`/files/v3/files/${asset.remote_id}/signed-url`, token, fetcher);
    url = signed.url;
  }
  let response;
  for (let redirect = 0; redirect <= 4; redirect++) {
    const target = allowedAssetUrl(url, asset.portal_id, asset.kind === "recording");
    response = await fetcher(target.url.toString(), {
      ...(target.authenticatedRecording ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new CrmAssetError("source_unavailable");
      url = new URL(location, target.url).toString();
      continue;
    }
    break;
  }
  if (!response || !response.ok) {
    if (response?.status === 401 || response?.status === 403) throw new CrmAssetError("hubspot_file_access", true);
    if (response?.status === 404) throw new CrmAssetError("source_missing", true);
    throw new CrmAssetError("source_unavailable");
  }
  const type = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0].toLowerCase();
  // An auth/login page is never a successful recording download.
  if (asset.kind === "recording" && !/^(audio\/|video\/|application\/octet-stream$)/.test(type)) {
    await response.body?.cancel(); throw new CrmAssetError("recording_access", true);
  }
  const headerSize = Number(response.headers.get("content-length"));
  if (headerSize > MAX_CRM_ASSET_BYTES) { await response.body?.cancel(); throw new CrmAssetError("file_too_large", true); }
  if (!response.body) throw new CrmAssetError("empty_download");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_CRM_ASSET_BYTES) { await reader.cancel(); throw new CrmAssetError("file_too_large", true); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (expectedSize !== null && bytes !== expectedSize) throw new CrmAssetError("size_mismatch");
  if (asset.kind === "recording" && bytes === 0) throw new CrmAssetError("empty_download");
  const data = Buffer.concat(chunks);
  if (asset.kind === "recording") filename += type === "audio/mpeg" ? ".mp3" : type === "audio/wav" ? ".wav" : type === "video/mp4" ? ".mp4" : ".bin";
  return { data, filename: filename.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 240), content_type: type, byte_size: bytes, sha256: createHash("sha256").update(data).digest("hex") };
}

export async function ensureCrmAssetBucket(db) {
  const current = await db.storage.getBucket(CRM_ASSET_BUCKET);
  if (!current.error && current.data) {
    if (current.data.public) throw new CrmAssetError("storage_not_private", true);
    return;
  }
  const created = await db.storage.createBucket(CRM_ASSET_BUCKET, { public: false, fileSizeLimit: MAX_CRM_ASSET_BYTES });
  if (created.error) {
    const check = await db.storage.getBucket(CRM_ASSET_BUCKET);
    if (check.error || !check.data || check.data.public) throw new CrmAssetError("storage_unavailable");
  }
}

export async function migrateCrmAssets(db, token, { budgetMs = 35000, limit = 3, fetcher = fetch } = {}) {
  if (!token) return { copied: 0, blocked: 0, skipped: "HubSpot file access is not configured." };
  await ensureCrmAssetBucket(db);
  const deadline = Date.now() + budgetMs;
  let copied = 0; let blocked = 0; let failed = 0; let paused = false;
  while (Date.now() < deadline && copied + blocked + failed < limit) {
    const lease = crypto.randomUUID();
    const claim = await db.rpc("crm_claim_assets", { p_token: lease, p_limit: 1 });
    if (claim.error) throw new CrmAssetError("asset_queue_unavailable");
    const asset = claim.data?.[0];
    if (!asset) break;
    let result;
    try {
      const file = await downloadCrmAsset(asset, token, fetcher);
      const storagePath = `${asset.portal_id}/${createHash("sha256").update(asset.id).digest("hex")}/${file.sha256}`;
      const upload = await db.storage.from(CRM_ASSET_BUCKET).upload(storagePath, file.data, { contentType: "application/octet-stream", upsert: true });
      if (upload.error) throw new CrmAssetError("storage_unavailable");
      // Verify the bytes actually retained in private storage before marking a file complete.
      const stored = await db.storage.from(CRM_ASSET_BUCKET).download(storagePath);
      if (stored.error || !stored.data) throw new CrmAssetError("storage_verification");
      const digest = createHash("sha256").update(Buffer.from(await stored.data.arrayBuffer())).digest("hex");
      if (digest !== file.sha256 || stored.data.size !== file.byte_size) throw new CrmAssetError("storage_verification");
      result = { status: "ready", filename: file.filename, content_type: file.content_type, byte_size: file.byte_size, sha256: file.sha256, storage_path: storagePath };
      copied++;
    } catch (error) {
      const isBlocked = error instanceof CrmAssetError && error.blocked;
      result = { status: isBlocked ? "blocked" : "failed", error_code: error instanceof CrmAssetError ? error.code : "copy_unavailable" };
      if (isBlocked) blocked++; else failed++;
    }
    const save = await db.rpc("crm_finish_asset", { p_id: asset.id, p_token: lease, p_result: result });
    if (save.error || !save.data) throw new CrmAssetError("asset_receipt_unavailable");
    if (result.error_code === "hubspot_file_access") { paused = true; break; }
  }
  return { copied, blocked, failed, ...(paused ? { paused: true } : {}) };
}
