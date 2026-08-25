import { NextResponse } from "next/server";

export async function GET() {
  const maintenance = process.env.IOS_MAINTENANCE_MODE === "1";
  return NextResponse.json(
    {
      state: maintenance ? "maintenance" : "operational",
      message: maintenance
        ? process.env.IOS_MAINTENANCE_MESSAGE ?? "RF Tools is temporarily unavailable while maintenance is completed."
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
