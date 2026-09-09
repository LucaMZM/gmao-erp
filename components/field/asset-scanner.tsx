"use client";

import { AlertTriangle, Camera, Keyboard, QrCode, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type BarcodeDetectorLike = new (options: { formats: string[] }) => {
  detect(source: ImageBitmap): Promise<Array<{ rawValue: string }>>;
};

function codeFromValue(value: string): string {
  try {
    const url = new URL(value);
    return decodeURIComponent(
      url.pathname.split("/").filter(Boolean).at(-1) ?? value,
    );
  } catch {
    return value;
  }
}

export function AssetScanner() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const open = (value: string) => {
    const code = codeFromValue(value).trim();
    if (code.length < 4) {
      setError("Introduce un código de activo válido.");
      return;
    }
    router.push(`/scan/${encodeURIComponent(code)}`);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    open(String(new FormData(event.currentTarget).get("code") ?? ""));
  };

  const decodeImage = async (file: File | undefined) => {
    if (!file) return;
    const Detector = (
      window as typeof window & { BarcodeDetector?: BarcodeDetectorLike }
    ).BarcodeDetector;
    if (!Detector) {
      setError(
        "Este navegador no puede leer QR desde una imagen. Introduce el código impreso.",
      );
      return;
    }
    setReading(true);
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const matches = await new Detector({ formats: ["qr_code"] }).detect(
        bitmap,
      );
      if (!matches[0]?.rawValue) {
        setError("No se ha encontrado un QR legible en la imagen.");
        return;
      }
      open(matches[0].rawValue);
    } catch {
      setError("No se ha podido leer la imagen. Prueba con el código manual.");
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="asset-scanner">
      <section className="asset-scan-target">
        <span className="scan-corner top-left" />
        <span className="scan-corner top-right" />
        <QrCode size={62} strokeWidth={1.25} />
        <strong>Identifica el activo</strong>
        <p>Captura la etiqueta QR de planta o introduce su identificador.</p>
        <label className="primary-button asset-camera-button">
          <Camera size={16} /> {reading ? "Leyendo…" : "Usar cámara / imagen"}
          <input
            accept="image/*"
            capture="environment"
            disabled={reading}
            onChange={(event) => void decodeImage(event.target.files?.[0])}
            type="file"
          />
        </label>
      </section>
      <form className="asset-code-form" onSubmit={submit}>
        <label>
          <Keyboard size={16} />
          <span className="sr-only">Código de activo</span>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            name="code"
            placeholder="Ej. MZ-LEV-LM-02-APP"
            required
          />
        </label>
        <button className="secondary-button" type="submit">
          <Search size={15} /> Abrir activo
        </button>
      </form>
      <p className="asset-scan-example">
        Código demo:{" "}
        <button onClick={() => open("MZ-LEV-LM-02-APP")} type="button">
          MZ-LEV-LM-02-APP
        </button>
      </p>
      {error ? (
        <p className="operation-feedback error" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
    </div>
  );
}
