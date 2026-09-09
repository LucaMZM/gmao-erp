"use client";

import { AlertTriangle, ArrowRight, PackagePlus, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type {
  ProcurementCenterData,
  PurchaseOrderDetailData,
  RequisitionDetailData,
} from "@/lib/server/repositories/procurement";

type ApiPayload = { data?: { number?: string }; error?: { message?: string } };

async function postJson(url: string, body: unknown): Promise<ApiPayload> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiPayload;
  if (!response.ok)
    throw new Error(
      payload.error?.message ?? "La operación no se ha podido completar.",
    );
  return payload;
}

export function RequisitionCreateDialog({
  parts,
  warehouses,
  canCreate,
}: {
  parts: ProcurementCenterData["parts"];
  warehouses: ProcurementCenterData["warehouses"];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canCreate) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const payload = await postJson("/api/procurement/requisitions", {
        partId: form.get("partId"),
        quantity: Number(form.get("quantity")),
        warehouseId: form.get("warehouseId"),
        origin: form.get("origin"),
        urgency: form.get("urgency"),
        needBy: form.get("needBy")
          ? new Date(String(form.get("needBy"))).toISOString()
          : null,
        justification: form.get("justification"),
        submit: form.get("submit") === "true",
      });
      setOpen(false);
      router.push(
        `/procurement/requisitions/${encodeURIComponent(payload.data?.number ?? "")}`,
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se ha podido crear la requisición.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="primary-button"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus size={15} /> Nueva requisición
      </button>
      {open ? (
        <div className="dialog-backdrop" onMouseDown={() => setOpen(false)}>
          <form
            className="operation-dialog procurement-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={submit}
          >
            <header>
              <div>
                <p className="overline">Aprovisionamiento MRO</p>
                <h2>Registrar necesidad</h2>
                <p>
                  El centro, solicitante y contexto se completan
                  automáticamente.
                </p>
              </div>
              <button
                aria-label="Cerrar"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <div className="operation-form-grid">
              <label className="wide">
                <span>Referencia</span>
                <select name="partId" required>
                  {parts.map((part) => (
                    <option key={part.id} value={part.id}>
                      {part.sku} · {part.name} · {part.available} disp. /{" "}
                      {part.onOrder} pedido
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Cantidad</span>
                <input
                  defaultValue={parts[0]?.suggestedQuantity || 1}
                  min="0.001"
                  name="quantity"
                  required
                  step="0.001"
                  type="number"
                />
              </label>
              <label>
                <span>Almacén destino</span>
                <select name="warehouseId" required>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.code} · {warehouse.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Origen</span>
                <select defaultValue="MANUAL" name="origin">
                  <option value="MANUAL">Reposición manual</option>
                  <option value="LOW_STOCK">Stock bajo</option>
                  <option value="STOCKOUT">Stockout</option>
                  <option value="PLANNING">Planificación</option>
                </select>
              </label>
              <label>
                <span>Urgencia</span>
                <select defaultValue="ROUTINE" name="urgency">
                  <option value="ROUTINE">Normal</option>
                  <option value="HIGH">Alta</option>
                  <option value="CRITICAL">Crítica</option>
                </select>
              </label>
              <label>
                <span>Necesario antes de</span>
                <input name="needBy" type="datetime-local" />
              </label>
              <label className="wide">
                <span>Justificación</span>
                <textarea
                  name="justification"
                  placeholder="Motivo operativo y riesgo si no se repone"
                  required
                  rows={3}
                />
              </label>
            </div>
            {error ? (
              <p className="operation-feedback error" role="alert">
                <AlertTriangle size={14} /> {error}
              </p>
            ) : null}
            <footer>
              <button
                className="secondary-button"
                disabled={busy}
                name="submit"
                type="submit"
                value="false"
              >
                Guardar borrador
              </button>
              <button
                className="primary-button"
                disabled={busy}
                name="submit"
                type="submit"
                value="true"
              >
                Enviar a aprobación <ArrowRight size={14} />
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  );
}

export function RequisitionActions({
  requisition,
  bins,
  canApprove,
  canManageOrder,
}: {
  requisition: RequisitionDetailData;
  bins: ProcurementCenterData["bins"];
  canApprove: boolean;
  canManageOrder: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const action = async (
    actionName: "SUBMIT" | "APPROVE" | "REJECT" | "CANCEL",
    reason?: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/procurement/requisitions/${encodeURIComponent(requisition.number)}/actions`,
        { action: actionName, reason, version: requisition.version },
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Operación no disponible.",
      );
    } finally {
      setBusy(false);
    }
  };

  const convert = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const offer = requisition.offers.find(
      (item) => item.id === form.get("offerId"),
    );
    setBusy(true);
    setError(null);
    try {
      const payload = await postJson(
        `/api/procurement/requisitions/${encodeURIComponent(requisition.number)}/convert`,
        {
          vendorId: offer?.vendorId,
          offerId: offer?.id,
          destinationBinId: form.get("destinationBinId"),
          expectedAt: form.get("expectedAt")
            ? new Date(String(form.get("expectedAt"))).toISOString()
            : null,
          taxRate: 21,
          version: requisition.version,
        },
      );
      router.push(
        `/procurement/purchase-orders/${encodeURIComponent(payload.data?.number ?? "")}`,
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se ha podido crear el pedido.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="procurement-action-band">
      <div className="contextual-actions">
        {requisition.status === "DRAFT" ? (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void action("SUBMIT")}
            type="button"
          >
            Enviar a aprobación
          </button>
        ) : null}
        {requisition.status === "SUBMITTED" && canApprove ? (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void action("APPROVE")}
            type="button"
          >
            Aprobar requisición
          </button>
        ) : null}
        {requisition.status === "SUBMITTED" && canApprove ? (
          <button
            className="secondary-button danger"
            disabled={busy}
            onClick={() =>
              void action(
                "REJECT",
                "Necesidad rechazada tras revisión del responsable.",
              )
            }
            type="button"
          >
            Rechazar
          </button>
        ) : null}
        {["DRAFT", "SUBMITTED", "APPROVED"].includes(requisition.status) ? (
          <button
            className="text-action"
            disabled={busy}
            onClick={() => void action("CANCEL")}
            type="button"
          >
            Cancelar
          </button>
        ) : null}
      </div>
      {requisition.status === "APPROVED" && canManageOrder ? (
        <form className="procurement-convert-form" onSubmit={convert}>
          <label>
            <span>Oferta aprobada</span>
            <select name="offerId" required>
              {requisition.offers.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {offer.preferred ? "Preferido · " : ""}
                  {offer.vendorName} · {offer.unitPrice.toFixed(2)}{" "}
                  {offer.currency} · {offer.leadTimeDays} d
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Recepción en</span>
            <select name="destinationBinId" required>
              {bins.map((bin) => (
                <option key={bin.id} value={bin.id}>
                  {bin.code} · {bin.warehouseName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Entrega prevista</span>
            <input name="expectedAt" required type="datetime-local" />
          </label>
          <button
            className="primary-button"
            disabled={busy || !requisition.offers.length}
            type="submit"
          >
            Crear pedido <ArrowRight size={14} />
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="operation-feedback error" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
    </section>
  );
}

export function PurchaseOrderActions({
  order,
  canManage,
  canReceive,
}: {
  order: PurchaseOrderDetailData;
  canManage: boolean;
  canReceive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const action = async (actionName: "APPROVE" | "SEND" | "CANCEL") => {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/procurement/purchase-orders/${encodeURIComponent(order.number)}/actions`,
        { action: actionName, version: order.version },
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se ha podido actualizar el pedido.",
      );
    } finally {
      setBusy(false);
    }
  };
  const receive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = order.lines.flatMap((line) => {
      const quantity = Number(form.get(`quantity:${line.id}`));
      return quantity > 0 ? [{ lineId: line.id, quantity }] : [];
    });
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/procurement/purchase-orders/${encodeURIComponent(order.number)}/receipts`,
        {
          idempotencyKey: crypto.randomUUID(),
          externalReference: form.get("externalReference"),
          version: order.version,
          lines,
        },
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se ha podido registrar la recepción.",
      );
    } finally {
      setBusy(false);
    }
  };
  const receivable = ["SENT", "PARTIALLY_RECEIVED"].includes(order.status);
  const hasStatusAction =
    canManage && ["DRAFT", "APPROVED", "SENT"].includes(order.status);
  if (!hasStatusAction && !(receivable && canReceive) && !error) return null;
  return (
    <section className="procurement-action-band">
      <div className="contextual-actions">
        {order.status === "DRAFT" && canManage ? (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void action("APPROVE")}
            type="button"
          >
            Aprobar pedido
          </button>
        ) : null}
        {order.status === "APPROVED" && canManage ? (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void action("SEND")}
            type="button"
          >
            Enviar a proveedor
          </button>
        ) : null}
        {["DRAFT", "APPROVED", "SENT"].includes(order.status) && canManage ? (
          <button
            className="text-action"
            disabled={busy}
            onClick={() => void action("CANCEL")}
            type="button"
          >
            Cancelar pedido
          </button>
        ) : null}
      </div>
      {receivable && canReceive ? (
        <form className="goods-receipt-form" onSubmit={receive}>
          <div>
            <p className="overline">Entrada de material</p>
            <h3>Registrar recepción</h3>
            <small>
              Admite entregas parciales; nunca permite superar lo pendiente.
            </small>
          </div>
          {order.lines
            .filter((line) => line.outstandingQuantity > 0)
            .map((line) => (
              <label key={line.id}>
                <span>
                  {line.sku} · pendiente {line.outstandingQuantity} {line.unit}
                </span>
                <input
                  defaultValue={line.outstandingQuantity}
                  max={line.outstandingQuantity}
                  min="0"
                  name={`quantity:${line.id}`}
                  step="0.001"
                  type="number"
                />
              </label>
            ))}
          <label>
            <span>Albarán / referencia</span>
            <input name="externalReference" placeholder="ALB-2026-…" />
          </label>
          <button className="primary-button" disabled={busy} type="submit">
            <PackagePlus size={15} /> Contabilizar entrada
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="operation-feedback error" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
    </section>
  );
}

export function TransferWorkspace({
  data,
  canTransfer,
}: {
  data: ProcurementCenterData;
  canTransfer: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/procurement/transfers", {
        partId: form.get("partId"),
        fromBinId: form.get("fromBinId"),
        toBinId: form.get("toBinId"),
        quantity: Number(form.get("quantity")),
        note: form.get("note"),
      });
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se ha podido crear la transferencia.",
      );
    } finally {
      setBusy(false);
    }
  };
  const action = async (
    number: string,
    version: number,
    actionName: "DISPATCH" | "RECEIVE" | "CANCEL",
  ) => {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/procurement/transfers/${encodeURIComponent(number)}/actions`,
        { action: actionName, version },
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se ha podido mover el material.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="data-panel procurement-transfer-panel">
      <div className="panel-title-row">
        <div>
          <p className="overline">Logística interna</p>
          <h2>Transferencias de stock</h2>
          <p>Entre ubicaciones y almacenes del centro activo.</p>
        </div>
        <PackagePlus size={17} />
      </div>
      {canTransfer ? (
        <form className="transfer-create-bar" onSubmit={create}>
          <select aria-label="Referencia" name="partId" required>
            {data.parts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.sku} · {part.name}
              </option>
            ))}
          </select>
          <select aria-label="Ubicación origen" name="fromBinId" required>
            {data.bins.map((bin) => (
              <option key={bin.id} value={bin.id}>
                {bin.code} · {bin.warehouseName}
              </option>
            ))}
          </select>
          <select aria-label="Ubicación destino" name="toBinId" required>
            {data.bins.map((bin) => (
              <option key={bin.id} value={bin.id}>
                {bin.code} · {bin.warehouseName}
              </option>
            ))}
          </select>
          <input
            aria-label="Cantidad"
            defaultValue="1"
            min="0.001"
            name="quantity"
            step="0.001"
            type="number"
          />
          <input aria-label="Motivo" name="note" placeholder="Motivo" />
          <button className="secondary-button" disabled={busy} type="submit">
            Crear
          </button>
        </form>
      ) : null}
      <div className="procurement-transfer-list">
        {data.transfers.map((transfer) => (
          <div key={transfer.id}>
            <span>
              <small>
                {transfer.number} · {transfer.status.replaceAll("_", " ")}
              </small>
              <strong>{transfer.itemSummary}</strong>
              <em>
                {transfer.fromWarehouse} → {transfer.toWarehouse}
              </em>
            </span>
            {canTransfer ? (
              <span className="row-actions">
                {transfer.status === "CREATED" ? (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          transfer.number,
                          transfer.version,
                          "DISPATCH",
                        )
                      }
                      type="button"
                    >
                      Expedir
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(transfer.number, transfer.version, "CANCEL")
                      }
                      type="button"
                    >
                      Cancelar
                    </button>
                  </>
                ) : null}
                {transfer.status === "IN_TRANSIT" ? (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() =>
                      void action(transfer.number, transfer.version, "RECEIVE")
                    }
                    type="button"
                  >
                    Confirmar recepción
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {error ? (
        <p className="operation-feedback error" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
    </section>
  );
}

export function WorkOrderRequisitionButton({
  number,
  partId,
  quantity,
  disabled,
}: {
  number: string;
  partId: string;
  quantity: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await postJson("/api/procurement/requisitions", {
        partId,
        quantity: Math.max(quantity, 1),
        workOrderNumber: number,
        origin: "WORK_ORDER",
        urgency: "CRITICAL",
        justification: `Stock insuficiente para continuar ${number}.`,
        submit: true,
      });
      router.push(
        `/procurement/requisitions/${encodeURIComponent(payload.data?.number ?? "")}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se ha podido solicitar el recambio.",
      );
      setBusy(false);
    }
  };
  return (
    <span className="wo-procurement-action">
      <button
        className="secondary-button compact"
        disabled={disabled || busy}
        onClick={() => void create()}
        type="button"
      >
        <PackagePlus size={13} /> Solicitar compra
      </button>
      {error ? <small className="text-critical">{error}</small> : null}
    </span>
  );
}
