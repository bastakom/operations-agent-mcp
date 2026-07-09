export async function GET() {
  return Response.json({
    status: "ok",
    service: "operations-agent-mcp",
    timestamp: new Date().toISOString(),
  });
}
