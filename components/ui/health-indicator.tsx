export function HealthIndicator({
  score,
  compact = false,
}: {
  score: number;
  compact?: boolean;
}) {
  const tone = score < 65 ? "critical" : score < 80 ? "warning" : "good";
  return (
    <div
      className={`health-indicator ${tone}${compact ? " compact" : ""}`}
      aria-label={`Health score ${score} de 100`}
    >
      <strong>{score}</strong>
      <span>
        <i className={tone} style={{ width: `${Math.max(4, score)}%` }} />
      </span>
    </div>
  );
}
