import { NextResponse } from "next/server";
import { now } from "@/lib/time/clock";

export const dynamic = "force-dynamic";

export async function GET() {
  const current = now();
  return NextResponse.json({
    success: true,
    data: {
      serverTime: current.toISOString(),
      timestamp: current.getTime(),
      timezone: "Asia/Kolkata",
    },
  });
}
