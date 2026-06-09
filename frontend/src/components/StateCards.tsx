// Shared polished states: ErrorCard, LoadingBlock

const SHIMMER: React.CSSProperties = {
  background:
    "linear-gradient(90deg, var(--elevated) 20%, var(--elevated-2) 50%, var(--elevated) 80%)",
  backgroundSize: "800px 100%",
  animation: "shimmer 1.8s linear infinite",
  borderRadius: 5,
};

// ---------------------------------------------------------------------------
// LoadingBlock — skeleton rows with shimmer
// ---------------------------------------------------------------------------

export function LoadingBlock({
  rows = 6,
  message,
  padded = true,
}: {
  rows?: number;
  message?: string;
  padded?: boolean;
}) {
  const widths = [88, 72, 80, 65, 90, 76, 84, 60, 92, 68];
  return (
    <div style={{ padding: padded ? "28px 20px" : "12px 0" }}>
      {message && (
        <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--muted-2)" }}>
          {message}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            style={{
              ...SHIMMER,
              height: 13,
              width: `${widths[i % widths.length]}%`,
              animationDelay: `${i * 0.07}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorCard — polished dark error card
// ---------------------------------------------------------------------------

export function ErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div style={{ padding: "36px 20px" }}>
      <div
        style={{
          maxWidth: 420,
          margin: "0 auto",
          background: "var(--surface)",
          border: "1px solid rgba(239,68,68,0.22)",
          borderRadius: "var(--radius-lg)",
          padding: "20px 22px",
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          {/* Icon */}
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "var(--neg-soft)",
              border: "1px solid rgba(239,68,68,0.28)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#EF4444"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <circle cx="12" cy="16" r="0.5" fill="#EF4444" strokeWidth="1.5" />
            </svg>
          </div>

          {/* Text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: "0 0 5px",
                fontSize: 13.5,
                fontWeight: 650,
                color: "var(--text)",
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--muted)",
                lineHeight: 1.55,
              }}
            >
              {message}
            </p>
            {onRetry && (
              <button
                onClick={onRetry}
                style={{
                  marginTop: 12,
                  background: "var(--elevated)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-sm)",
                  padding: "5px 13px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                  transition: "background 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--elevated-2)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    "var(--border-strong)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--elevated)";
                }}
              >
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
