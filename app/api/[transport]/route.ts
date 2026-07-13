import { createMcpHandler } from "mcp-handler";
import { getUsers } from "../../../lib/blikk/endpoints";

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

    server.registerTool(
      "get_users",
      {
        title: "Get Users",
        description: "Fetches all users from Blikk.",
        inputSchema: {},
      },
      async () => {
        try {
          const users = await getUsers();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(users, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );
  },
  {},
  {
    basePath: "/api",
    verboseLogs: true,
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
