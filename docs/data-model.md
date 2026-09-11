# Modelo de datos V2B

La base se organiza alrededor de `organizations → sites → functional_locations`. `assets` referencia obligatoriamente esa jerarquía y añade un árbol mantenible mediante `parent_asset_id`.

```text
Organization
└─ Site
   ├─ Functional location ──┐
   │  └─ Functional location│
   ├─ Asset <───────────────┘
   │  ├─ Child asset
   │  ├─ Incident ── Notes / Events ── Work order
   │  └─ Work order ── Downtime / Labor / Events / Materials
   └─ Warehouse ── Bin ── Stock level
                       └─ Inventory movement ledger
Part ── Site policy ── Vendor
  ├─ Asset compatibility
  ├─ Work-order material projection / usage snapshot
  ├─ Vendor offers / approved substitutes
  └─ Purchase requisition ── Purchase order ── Goods receipt
Warehouse ── Zone ── Bin ── Stock transfer
Asset / Functional location
  └─ Maintenance plan ── Tasks / Skills / Certifications / Planned materials
       ├─ Meter ── Meter readings
       └─ Generated work orders (unique occurrence window)
User ── Workforce profile ── Skills / Certifications / Availability
Failure mode ── Work orders ── Downtime / material consumption
Asset ── Root cause analysis ── Evidence / 5 Whys / Actions / Events
                              ├─ Linked work order
                              └─ Linked maintenance plan
Work order ── Typed checklist / Measurements / Safety acknowledgements
          ├─ Evidence metadata ── R2 object
          └─ Shift handover links
Membership ── Site scope ── Area scopes / Warehouse scopes
Role ── Permission grants
Production calendar ── Windows / Exceptions
User / Role / Shift ── Labor rate card ── Labor cost snapshot
Work order ── Explicit cost items
Session ── idle / absolute expiry / rotation / revocation
Audit entry ── append-only guardrail
```

Las incidencias conservan contexto de organización, planta, ubicación, activo, origen, severidad, impacto y decisiones de triage. La relación `work_orders.incident_id` es única y mantiene la trazabilidad sin duplicar el expediente.

El lifecycle de OT contempla `REQUESTED`, `TRIAGE`, `APPROVED`, `PLANNED`, `SCHEDULED`, `ASSIGNED`, `IN_PROGRESS`, `PAUSED`, esperas, `COMPLETED`, `CLOSED` y `CANCELLED`. Las sesiones de labor, downtime, materiales previstos y consumos son registros reales relacionados con la orden.

Índices cubren códigos únicos por planta, árboles, activos por estado/criticidad/salud, OT por estado/fecha/activo, piezas por SKU/categoría y movimientos por pieza/fecha. Las listas exponen límites y paginación para no asumir datasets pequeños.

La migración `0004_free_patch` añade planes preventivos, tareas, requisitos técnicos, materiales previstos, workforce, disponibilidad, contadores y lecturas. `work_orders` conserva `maintenance_plan_id`, clave de ventana y vencimiento preventivo; los requisitos y el checklist se copian como snapshot operativo al generar la orden.

La migración `0005_magenta_vindicator` formaliza modos de fallo y añade RCA con evidencias, cadena de 5 Whys, acciones y timeline append-only. `work_orders.failure_mode_id` conecta las observaciones correctivas con la taxonomía sin eliminar los campos legacy; las RCA y sus acciones mantienen relaciones opcionales a OT y planes preventivos.

La migración `0006_peaceful_reptil` amplía proveedores y ubicaciones de almacén, añade ofertas, sustitutos, requisiciones, pedidos, recepciones, transferencias y eventos Procurement. Las líneas de pedido y recepción conservan precio histórico; `inventory_movements` enlaza PO, recepción o transferencia y `stock_levels.on_order` proyecta únicamente cantidades enviadas todavía pendientes.

La migración aditiva `0007_luxuriant_ender_wiggin` añade identificadores de escaneo, tipos y respuestas de checklist, contexto de seguridad, acknowledgements, mediciones, evidencias y relevos. No reconstruye tablas padre durante el upgrade: preserva íntegramente los datos V1D y amplía las OT preventivas con un snapshot ejecutable en campo.

La migración aditiva `0008_enterprise_governance` introduce permisos y grants data-driven, scopes explícitos por centro/área/almacén, calendarios productivos, turnos, ausencias, tarifas, snapshots de coste laboral, costes explícitos, políticas de sesión, intentos de login, vistas guardadas, idempotencia, actividad de petición y hardening de evidencias. Existe como delta funcional V2B sobre la base V2A `0007`; no reescribe migraciones aplicadas.

La migración `0009_enterprise_audit_guardrails` es deliberadamente pequeña y posterior: añade los triggers que hacen `audit_entries` append-only y la unicidad parcial del calendario por defecto de cada planta. Se separa de `0008` porque esos guardrails se identificaron durante el cierre de integración después de que el delta principal ya fuese una migración estable. El orden obligatorio es `0007 → 0008 → 0009`; no es redundante ni contiene tablas parciales.

El seed contiene dos centros, 72 activos, 180 referencias MRO, más de 90 OT, incidencias, planes preventivos, contadores, workforce, sesiones, downtime, reservas, consumos, fallos recurrentes, RCA, casos Procurement y una intervención de campo completa. V2B añade memberships scoped, grants, calendarios, turnos, tarifas históricas, auditoría y vistas guardadas. Se genera con ancla temporal fija y marcadores idempotentes.

La migración `0010_atomic_mutation_assertions` añade una tabla de aserciones transaccionales, unicidad parcial de labor activa por usuario y downtime activo por OT, y guards de finalización/materiales/downtime. El preflight rechaza duplicados existentes sin reparar historial. 0000–0009 permanecen intactas. Detalles de adopción Sites, upgrades y fuente de verdad SQL: [auditoría independiente](independent-audit.md).
