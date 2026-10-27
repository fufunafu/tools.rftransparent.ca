import "server-only";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { OWNER_EMAIL } from "@/lib/authz";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabase } from "@/lib/supabase";
import { AmazonError } from "./domain";
import { amazonPasswordCurrent, recentAmazonMfa, AMAZON_PASSWORD_MAX_AGE_MS } from "./security-policy";

export async function amazonSecurityPrincipal() {
  const user = await getAuthenticatedUser();
  if (!user || !(await isAdminUser())) throw new AmazonError("Admin access required", 403);
  const approved = new Set((process.env.AMAZON_APPROVED_USER_EMAILS ?? OWNER_EMAIL).split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
  if (!user.email || !approved.has(user.email.toLowerCase())) throw new AmazonError("Your account has not been approved for Amazon information access.", 403);
  return user;
}

export async function amazonSecurityState() {
  const user = await amazonSecurityPrincipal();
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data || data.claims.sub !== user.id) throw new AmazonError("Sign in again to verify your session.", 401);
  // Verify both the signed session and the current factors. An old aal2 token
  // must not grant access after the user's final verified factor was removed.
  const mfaVerified = data.claims.aal === "aal2" && Boolean(user.factors?.some((factor) => factor.factor_type === "totp" && factor.status === "verified"));
  const { data: password, error: passwordError } = await getSupabase().from("amazon_password_compliance").select("verified_at").eq("user_id", user.id).maybeSingle();
  if (passwordError) throw new AmazonError("Amazon security setup is not available. Contact the administrator.", 503);
  const verifiedAt = password?.verified_at;
  const passwordCurrent = amazonPasswordCurrent(verifiedAt);
  return {
    userId: user.id,
    mfaVerified,
    recentMfa: mfaVerified && recentAmazonMfa(data.claims.amr),
    passwordCurrent,
    passwordExpiresAt: passwordCurrent ? new Date(Date.parse(verifiedAt) + AMAZON_PASSWORD_MAX_AGE_MS).toISOString() : null,
    ready: mfaVerified && passwordCurrent,
  };
}

export async function requireAmazonSecurity() {
  const state = await amazonSecurityState();
  if (!state.ready) throw new AmazonError("Complete your Amazon security setup at /amazon/security before accessing listings.", 403);
  return state;
}
