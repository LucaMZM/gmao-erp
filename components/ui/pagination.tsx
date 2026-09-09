import Link from "next/link";

function withPage(
  basePath: string,
  current: URLSearchParams,
  page: number,
): string {
  const params = new URLSearchParams(current);
  params.set("page", String(page));
  return `${basePath}?${params.toString()}`;
}

export function Pagination({
  basePath,
  page,
  totalPages,
  searchParams,
}: {
  basePath: string;
  page: number;
  totalPages: number;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (totalPages <= 1) return null;
  const current = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const item = Array.isArray(value) ? value[0] : value;
    if (item && key !== "page") current.set(key, item);
  }
  return (
    <nav className="pagination" aria-label="Paginación">
      <Link
        aria-disabled={page <= 1}
        className={page <= 1 ? "disabled" : ""}
        href={withPage(basePath, current, Math.max(1, page - 1))}
      >
        Anterior
      </Link>
      <span>
        Página <strong>{page}</strong> de {totalPages}
      </span>
      <Link
        aria-disabled={page >= totalPages}
        className={page >= totalPages ? "disabled" : ""}
        href={withPage(basePath, current, Math.min(totalPages, page + 1))}
      >
        Siguiente
      </Link>
    </nav>
  );
}
