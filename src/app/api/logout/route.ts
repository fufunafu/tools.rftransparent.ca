import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

export async function GET() {
  await signOut();
  return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_SITE_URL ?? "https://tools.rftransparent.ca"));
}

export async function POST() {
  await signOut();
  return NextResponse.json({ success: true });
}
