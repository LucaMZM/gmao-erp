"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Mazmi route error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <section className="route-error" role="alert">
      <span>
        <AlertTriangle size={22} />
      </span>
      <p className="overline">No se han podido cargar los datos</p>
      <h1>El contexto operativo sigue a salvo.</h1>
      <p>
        Reintenta la consulta. Si el problema persiste, conserva el
        identificador <code>{error.digest ?? "sin-digest"}</code>.
      </p>
      <button className="primary-button" onClick={reset} type="button">
        <RotateCcw size={15} /> Reintentar
      </button>
    </section>
  );
}
