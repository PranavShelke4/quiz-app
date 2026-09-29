"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f8f9fc", color: "#1f2330" }}>
        <main style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>Something went wrong.</h1>
          <p style={{ color: "#6b7080" }}>Please try again.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "10px 16px", borderRadius: 8, border: 0, background: "#4338ca", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
