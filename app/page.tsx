export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "48px auto", padding: 24 }}>
      <h1>Operations Agent MCP</h1>
      <p>Servern är live.</p>
      <p>MCP-endpoint:</p>
      <pre style={{ background: "#f4f4f4", padding: 16, borderRadius: 8 }}>/api/mcp</pre>
      <p>Använd full URL i ChatGPT Agent/Connector:</p>
      <pre style={{ background: "#f4f4f4", padding: 16, borderRadius: 8 }}>
        https://ditt-projekt.vercel.app/api/mcp
      </pre>
    </main>
  );
}
