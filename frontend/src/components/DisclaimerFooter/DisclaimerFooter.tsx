export function DisclaimerFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border-faint)",
        padding: "14px 24px",
        color: "var(--muted-2)",
        fontSize: 11,
        fontStyle: "italic",
        textAlign: "center",
        lineHeight: 1.5,
      }}
    >
      BuildTech is an educational and analytical decision-support tool.
      Outputs are candidate portfolios based on historical data — not
      investment advice, recommendations, or signals. Past data does not
      indicate future results.
    </footer>
  );
}
