import { NextResponse } from "next/server";

export async function GET() {
  console.log("MCP GET HIT");

  return NextResponse.json({
    ok: true,
    route: "/api/mcp",
  });
}

export async function POST() {
  console.log("MCP POST HIT");

  return NextResponse.json({
    ok: true,
    route: "/api/mcp",
  });
}
