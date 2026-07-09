import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const handler = createMcpHandler((server) => {
  server.tool(
    "health_check",
    "Kontrollerar att Operations Agent MCP-servern fungerar.",
    {},
    async () => {
      return {
        content: [
          {
            type: "text",
            text: "Operations Agent MCP-servern fungerar.",
          },
        ],
      };
    }
  );

  server.tool(
    "echo",
    "Returnerar samma text som skickas in. Används för test.",
    {
      message: z.string(),
    },
    async ({ message }) => {
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    }
  );
});

export { handler as GET, handler as POST, handler as DELETE };
