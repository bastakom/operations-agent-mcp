import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "operations-agent-mcp",
    timestamp: new Date().toISOString(),
    blikkConfigured: Boolean(process.env.BLIKK_APP_ID && process.env.BLIKK_APP_SECRET)
  });
}
