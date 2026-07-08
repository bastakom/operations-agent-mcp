import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Operations Agent MCP",
  description: "MCP-server for ChatGPT Agent connected to Blikk."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
