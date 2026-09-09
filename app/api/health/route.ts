import { NextResponse } from "next/server";
import { databaseHealth } from "@/lib/server/database";

export async function GET() {
  try {
    const health = await databaseHealth();
    return NextResponse.json(health, { status: 200 });
  } catch (error) {
    console.error("Mazmi database health check failed", { error });
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
