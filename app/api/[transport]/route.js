import { createMcpHandler } from "mcp-handler";

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "health_check",
      "Checks that the MCP server is alive.",
      {},
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
    basePath: "/api/mcp",
    verboseLogs: true,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
