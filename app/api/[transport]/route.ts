import { createMcpHandler } from "mcp-handler";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "health_check",
      {
        title: "Health Check",
        description: "Checks that the MCP server is alive and well.",
        inputSchema: {},
      },
      async () => ({
        content: [
          {
            type: "text",
            text: "MCP server is alive 🚀",
          },
        ],
      })
    );
  },
  {},
  {
    basePath: "/api",
    verboseLogs: true,
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST };
