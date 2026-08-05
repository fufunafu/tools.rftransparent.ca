export const LEAD_ATTACHMENT_BUCKET = "lead-attachments";
export const MAX_LEAD_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_LEAD_ATTACHMENTS = 3;

export const LEAD_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
] as const;

export interface LeadAttachment {
  id: string;
  lead_id: string;
  field_name: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface PendingLeadAttachment {
  path: string;
  field_name: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
}

const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  heif: "image/heif",
};

export function attachmentContentType(filename: string, suppliedType: string): string | null {
  const normalizedType = suppliedType.trim().toLowerCase();
  if (LEAD_ATTACHMENT_TYPES.some((type) => type === normalizedType)) {
    return normalizedType;
  }

  if (normalizedType && normalizedType !== "application/octet-stream") return null;
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_TYPES[extension] ?? null;
}

export function validateAttachmentMetadata(input: {
  filename: unknown;
  content_type: unknown;
  size_bytes: unknown;
}): { ok: true; filename: string; contentType: string; sizeBytes: number } | { ok: false; error: string } {
  const filename = typeof input.filename === "string" ? input.filename.trim().slice(-180) : "";
  const suppliedType = typeof input.content_type === "string" ? input.content_type : "";
  const sizeBytes = typeof input.size_bytes === "number" ? input.size_bytes : Number(input.size_bytes);

  if (!filename) return { ok: false, error: "The drawing filename is missing." };
  const contentType = attachmentContentType(filename, suppliedType);
  if (!contentType) {
    return { ok: false, error: `${filename} must be a PDF, PNG, JPEG, HEIC, or HEIF file.` };
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: `${filename} is empty or has an invalid size.` };
  }
  if (sizeBytes > MAX_LEAD_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `${filename} is over ${MAX_LEAD_ATTACHMENT_BYTES / 1024 / 1024} MB.`,
    };
  }

  return { ok: true, filename, contentType, sizeBytes };
}

export function safeAttachmentName(filename: string): string {
  return (
    filename
      .normalize("NFKD")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(-120) || "project-drawing"
  );
}

export function parsePendingAttachments(value: unknown): PendingLeadAttachment[] {
  if (!Array.isArray(value)) return [];

  const attachments: PendingLeadAttachment[] = [];
  for (const item of value.slice(0, MAX_LEAD_ATTACHMENTS)) {
    if (!isRecord(item)) continue;
    const validated = validateAttachmentMetadata({
      filename: item.filename,
      content_type: item.content_type,
      size_bytes: item.size_bytes,
    });
    if (!validated.ok) continue;

    const path = typeof item.path === "string" ? item.path.trim() : "";
    if (!/^incoming\/[0-9a-f-]{36}-[^/]+$/i.test(path)) continue;

    attachments.push({
      path,
      field_name:
        typeof item.field_name === "string" && item.field_name.trim()
          ? item.field_name.trim().slice(0, 120)
          : null,
      filename: validated.filename,
      content_type: validated.contentType,
      size_bytes: validated.sizeBytes,
    });
  }
  return attachments;
}

export function attachmentContentDisposition(
  filename: string,
  disposition: "inline" | "attachment" = "inline",
): string {
  const ascii = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
