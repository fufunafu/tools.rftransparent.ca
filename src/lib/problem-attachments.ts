export const PROBLEM_ATTACHMENT_BUCKET = "problem-attachments";
// Leave room for multipart headers under Vercel's 4.5 MB request limit.
export const MAX_PROBLEM_PHOTO_BYTES = 4 * 1024 * 1024;
export const PROBLEM_PHOTO_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
] as const;

export interface ProblemAttachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
}

export const PROBLEM_ATTACHMENT_COLUMNS =
  "id, filename, content_type, size_bytes, uploaded_by, created_at";

export function isProblemPhotoId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function problemPhotoType(file: { name: string; type: string }): string | null {
  const type = file.type.toLowerCase();
  if (PROBLEM_PHOTO_TYPES.some((allowed) => allowed === type)) return type;
  if (type && type !== "application/octet-stream") return null;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", heic: "image/heic", heif: "image/heif",
  };
  return types[extension ?? ""] ?? null;
}

export function problemPhotoError(file: { name: string; type: string; size: number }): string | null {
  if (!problemPhotoType(file)) return `${file.name}: choose a JPEG, PNG, WebP, GIF, HEIC or HEIF picture.`;
  if (file.size <= 0) return `${file.name} is empty.`;
  if (file.size > MAX_PROBLEM_PHOTO_BYTES) return `${file.name} is too large. Each picture must be 4 MB or smaller.`;
  return null;
}

export function canPreviewProblemPhoto(contentType: string): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType);
}

// Check the file itself rather than trusting an extension or browser MIME type.
export function matchesProblemPhotoSignature(bytes: Uint8Array, contentType: string): boolean {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (contentType === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (contentType === "image/png") return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (contentType === "image/gif") return ["GIF87a", "GIF89a"].includes(ascii(0, 6));
  if (contentType === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (["image/heic", "image/heif"].includes(contentType) && ascii(4, 8) === "ftyp") {
    const brands = [ascii(8, 12)];
    for (let offset = 16; offset + 4 <= bytes.length; offset += 4) brands.push(ascii(offset, offset + 4));
    return brands.some((brand) => ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand));
  }
  return false;
}
