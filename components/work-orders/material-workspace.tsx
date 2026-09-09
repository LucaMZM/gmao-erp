"use client";

import { AlertTriangle, PackageCheck, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatCurrency } from "@/lib/presentation";
import type { WorkOrderDetailData } from "@/lib/server/repositories/work-orders";
import { WorkOrderRequisitionButton } from "@/components/procurement/procurement-actions";

export function MaterialWorkspace({
  number,
  plans,
  options,
  canPlan,
  canReserve,
  canConsume,
  canRequest,
}: {
  number: string;
  plans: WorkOrderDetailData["materialPlans"];
  options: WorkOrderDetailData["materialOptions"];
  canPlan: boolean;
  canReserve: boolean;
  canConsume: boolean;
  canRequest: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutate = async (body: Record<string, unknown>) => {
    setLoading(String(body.action));
    setError(null);
    try {
      const response = await fetch(
        `/api/work-orders/${encodeURIComponent(number)}/materials`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ?? "No se ha podido registrar el movimiento.",
        );
        return;
      }
      router.refresh();
    } catch {
      setError("El servicio no está disponible. Reinténtalo.");
    } finally {
      setLoading(null);
    }
  };

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate({
      action: "ADD_PLANNED",
      partId: data.get("partId"),
      quantity: Number(data.get("quantity")),
    });
  };
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement;
    const data = new FormData(event.currentTarget);
    void mutate({
      action: submitter.value,
      materialId: data.get("materialId"),
      quantity: Number(data.get("quantity")),
    });
  };

  return (
    <>
      {canPlan ? (
        <form className="material-add-bar" onSubmit={add}>
          <label>
            <span className="sr-only">Buscar recambio</span>
            <select name="partId" required>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.relation ? "Compatible · " : ""}
                  {item.sku} · {item.name} · {item.available} disp.
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Cantidad prevista</span>
            <input
              defaultValue="1"
              min="0.001"
              name="quantity"
              required
              step="0.001"
              type="number"
            />
          </label>
          <button
            className="secondary-button"
            disabled={Boolean(loading)}
            type="submit"
          >
            <Plus size={14} /> Añadir previsto
          </button>
        </form>
      ) : null}
      {plans.length ? (
        <div className="material-plan-list">
          {plans.map((material) => {
            const stockout = Number(material.available) <= 0;
            return (
              <form
                className={
                  stockout ? "material-plan-row stockout" : "material-plan-row"
                }
                key={material.id}
                onSubmit={apply}
              >
                <input name="materialId" type="hidden" value={material.id} />
                <span className="material-plan-identity">
                  <small>
                    {material.sku} · {material.binCode}
                  </small>
                  <strong>{material.partName}</strong>
                  <em>
                    {formatCurrency(material.unitCost)} / {material.unit}
                  </em>
                </span>
                <span>
                  <small>Previsto</small>
                  <strong>
                    {material.planned} {material.unit}
                  </strong>
                </span>
                <span>
                  <small>Reservado</small>
                  <strong>
                    {material.reserved} {material.unit}
                  </strong>
                </span>
                <span>
                  <small>Consumido neto</small>
                  <strong>
                    {Number(material.consumed) - Number(material.returned)}{" "}
                    {material.unit}
                  </strong>
                </span>
                <span
                  className={
                    stockout ? "material-stock critical" : "material-stock"
                  }
                >
                  <small>Disponible / pedido</small>
                  <strong>
                    {material.available} / {material.onOrder}
                  </strong>
                </span>
                <label className="material-quantity">
                  <span className="sr-only">Cantidad</span>
                  <input
                    defaultValue="1"
                    min="0.001"
                    name="quantity"
                    step="0.001"
                    type="number"
                  />
                </label>
                <span className="material-row-actions">
                  {canReserve ? (
                    <>
                      <button
                        disabled={Boolean(loading) || stockout}
                        title="Reservar"
                        type="submit"
                        value="RESERVE"
                      >
                        R
                      </button>
                      <button
                        disabled={
                          Boolean(loading) || Number(material.reserved) <= 0
                        }
                        title="Liberar"
                        type="submit"
                        value="RELEASE"
                      >
                        L
                      </button>
                    </>
                  ) : null}
                  {canConsume ? (
                    <>
                      <button
                        className="consume"
                        disabled={
                          Boolean(loading) ||
                          (stockout && Number(material.reserved) <= 0)
                        }
                        title="Consumir"
                        type="submit"
                        value="CONSUME"
                      >
                        <PackageCheck size={13} />
                      </button>
                      <button
                        disabled={
                          Boolean(loading) ||
                          Number(material.consumed) -
                            Number(material.returned) <=
                            0
                        }
                        title="Devolver"
                        type="submit"
                        value="RETURN"
                      >
                        ↩
                      </button>
                    </>
                  ) : null}
                </span>
                {stockout && canRequest ? (
                  <WorkOrderRequisitionButton
                    disabled={Boolean(loading)}
                    number={number}
                    partId={material.partId}
                    quantity={Math.max(
                      1,
                      Number(material.planned) - Number(material.reserved),
                    )}
                  />
                ) : null}
              </form>
            );
          })}
        </div>
      ) : (
        <div className="compact-empty-material">
          No hay materiales previstos. Añade solo lo necesario para esta
          intervención.
        </div>
      )}
      {error ? (
        <p className="operation-feedback error" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
    </>
  );
}
