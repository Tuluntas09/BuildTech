export function DataFreshness() {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span
        title="Prices freshness — updated by backend refresh"
        className="flex items-center gap-1 rounded px-2 py-1 bg-gray-100 text-gray-500 border border-gray-200"
      >
        <span>&#128202;</span>
        <span className="font-medium">Prices:</span>
        <span className="italic">—</span>
      </span>
      <span
        title="Fundamentals freshness — updated by weekly snapshot script"
        className="flex items-center gap-1 rounded px-2 py-1 bg-gray-100 text-gray-500 border border-gray-200"
      >
        <span>&#128200;</span>
        <span className="font-medium">Fundamentals:</span>
        <span className="italic">—</span>
      </span>
    </div>
  );
}
