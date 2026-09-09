import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <span>
        <SearchX size={22} />
      </span>
      <p className="overline">404 · Fuera de contexto</p>
      <h1>No encontramos este registro.</h1>
      <p>
        Puede haberse retirado, pertenecer a otro centro o no estar dentro de tu
        scope actual.
      </p>
      <Link className="primary-button" href="/overview">
        <ArrowLeft size={15} /> Volver al centro de control
      </Link>
    </main>
  );
}
