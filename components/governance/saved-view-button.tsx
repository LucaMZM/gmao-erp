"use client";

import { BookmarkPlus } from "lucide-react";
import { useState } from "react";

export function SavedViewButton({
  resource,
  filters,
}: {
  resource: string;
  filters: Record<string, unknown>;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const save = async () => {
    const name = window.prompt("Nombre de la vista", "Mi vista");
    if (!name?.trim()) return;
    setState("saving");
    const response = await fetch("/api/saved-views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resource, name: name.trim(), filters }),
    });
    setState(response.ok ? "saved" : "error");
  };
  return (
    <button
      className="secondary-button"
      disabled={state === "saving"}
      onClick={() => void save()}
      type="button"
    >
      <BookmarkPlus size={15} />{" "}
      {state === "saved"
        ? "Vista guardada"
        : state === "error"
          ? "Error al guardar"
          : "Guardar vista"}
    </button>
  );
}
