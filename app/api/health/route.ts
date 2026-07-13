export async function GET() {
  return Response.json({
    status: "ok",
    version: "test-123",
    service: "operations-agent-mcp",
    timestamp: new Date().toISOString(),
  });
}
