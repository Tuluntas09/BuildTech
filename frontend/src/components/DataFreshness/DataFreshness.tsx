export function DataFreshness() {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        title="Prices freshness — updated by backend refresh"
        className="flex items-center gap-1.5"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "5px 9px",
          color: "var(--muted)",
        }}
      >
        <span
          style={{
            width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
            background: "var(--warn)",
            boxShadow: "0 0 6px var(--warn)",
          }}
        />
        <span style={{ fontWeight: 600, color: "var(--text-2)" }}>Prices</span>
        <span style={{ color: "var(--muted-2)", fontFamily: "var(--font-mono)", fontSize: 10 }}>—</span>
      </span>
      <span
        title="Fundamentals freshness — updated by weekly snapshot script"
        className="flex items-center gap-1.5"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "5px 9px",
          color: "var(--muted)",
        }}
      >
        <span
          style={{
            width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
            background: "var(--pos)",
            boxShadow: "0 0 6px var(--pos)",
          }}
        />
        <span style={{ fontWeight: 600, color: "var(--text-2)" }}>Fundamentals</span>
        <span style={{ color: "var(--muted-2)", fontFamily: "var(--font-mono)", fontSize: 10 }}>—</span>
      </span>
    </div>
  );
}
