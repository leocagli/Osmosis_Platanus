"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [key, setKey] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);

    // Verify the key works by calling the proposals API
    const res = await fetch("/api/v1/proposals?status=pending", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await res.json();

    if (data.success) {
      // Store in sessionStorage (not localStorage — dies when tab closes)
      sessionStorage.setItem("admin_key", key);
      router.push("/admin/proposals");
    } else {
      setError(true);
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0a0a0a", padding: 24,
    }}>
      <form onSubmit={handleLogin} style={{
        maxWidth: 380, width: "100%", display: "flex", flexDirection: "column", gap: 20,
      }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <h1 style={{
            fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 6,
          }}>Admin Access</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Restricted area. Authorized personnel only.</p>
        </div>

        <input
          type="password"
          value={key}
          onChange={(e) => { setKey(e.target.value); setError(false); }}
          placeholder="Admin API Key"
          autoFocus
          required
          style={{
            width: "100%", padding: "14px 16px", background: "var(--s-low)",
            border: `1px solid ${error ? "var(--red)" : "var(--outline)"}`,
            borderRadius: 8, color: "var(--text)", fontSize: 14,
            fontFamily: "'JetBrains Mono', monospace", outline: "none",
          }}
        />

        {error && (
          <div style={{ fontSize: 12, color: "var(--red)", textAlign: "center" }}>
            Invalid key. Access denied.
          </div>
        )}

        <button type="submit" disabled={loading} style={{
          padding: "14px", background: loading ? "var(--s-high)" : "var(--primary)",
          color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Space Grotesk', sans-serif",
        }}>
          {loading ? "Verifying..." : "Enter"}
        </button>
      </form>
    </div>
  );
}
