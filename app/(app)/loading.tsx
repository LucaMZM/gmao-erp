export default function Loading() {
  return (
    <div
      aria-live="polite"
      aria-busy="true"
      className="page-stack loading-page"
    >
      <div className="skeleton skeleton-overline" />
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-description" />
      <div className="skeleton-grid">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="skeleton skeleton-metric" key={index} />
        ))}
      </div>
      <div className="skeleton-layout">
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-panel short" />
      </div>
      <span className="sr-only">Cargando datos operativos</span>
    </div>
  );
}
