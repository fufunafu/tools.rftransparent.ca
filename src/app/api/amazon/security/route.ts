import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabase } from "@/lib/supabase";
import { AmazonError } from "@/lib/amazon/domain";
import { amazonSecurityState } from "@/lib/amazon/security";
import { amazonPasswordProblem } from "@/lib/amazon/security-policy";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const failure = (error: unknown) => error instanceof AmazonError
  ? json({ error: error.message }, error.status) : json({ error: "Security verification is unavailable. Please try again." }, 503);

export async function GET() {
  try {
    const state = await amazonSecurityState();
    return json({ mfaVerified: state.mfaVerified, recentMfa: state.recentMfa, passwordCurrent: state.passwordCurrent, passwordExpiresAt: state.passwordExpiresAt, ready: state.ready });
  } catch (error) { return failure(error); }
}

const schema = z.object({ password: z.string().max(100), currentPassword: z.string().max(200).optional(), nonce: z.string().max(32).optional() }).strict();
async function readPassword(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) throw new AmazonError("JSON required", 415);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw new AmazonError("Request too large", 413); }
      chunks.push(value);
    }
    const result = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!result.success) throw new AmazonError("Invalid password request", 400);
    return result.data;
  } catch (error) {
    if (error instanceof AmazonError) throw error;
    throw new AmazonError("Invalid password request", 400);
  } finally { reader.releaseLock(); }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origin not allowed" }, 403);
  try {
    const state = await amazonSecurityState();
    if (!state.mfaVerified || !state.recentMfa) throw new AmazonError("Verify a fresh authenticator code before changing your password.", 403);
    const input = await readPassword(request);
    const problem = amazonPasswordProblem(input.password);
    if (problem) throw new AmazonError(problem, 400);
    if (input.currentPassword && input.currentPassword === input.password) throw new AmazonError("Choose a different password from your current one.", 400);
    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.updateUser({
      password: input.password,
      ...(input.currentPassword ? { current_password: input.currentPassword } : {}),
      ...(input.nonce ? { nonce: input.nonce } : {}),
    });
    if (error) {
      const message = error.code === "reauthentication_needed" ? "Verify your email using the reauthentication option, then try again."
        : "Password update failed. Check your current password, choose a new strong password, and try again.";
      throw new AmazonError(message, 400);
    }
    if (!data.user?.updated_at || data.user.id !== state.userId) throw new AmazonError("Password changed, but security confirmation failed. Please try again.", 503);
    const result = await getSupabase().rpc("confirm_amazon_password", { p_user_id: state.userId, p_auth_updated_at: data.user.updated_at });
    if (result.error || result.data !== true) throw new AmazonError("Password changed, but security confirmation failed. Please verify a new authenticator code and change the password again.", 503);
    return json({ updated: true });
  } catch (error) { return failure(error); }
}
