"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      className="secondary-button print-action"
      onClick={() => window.print()}
      type="button"
    >
      <Printer size={15} /> Imprimir / PDF
    </button>
  );
}
