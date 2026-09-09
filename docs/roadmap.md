# Roadmap

## V0 Foundation

- Sesión demo y RBAC inicial por organización/planta.
- Shell responsive, command palette, planta, notificaciones y temas.
- Centro de Control calculado desde datos operativos.
- Listado y detalle de activos.
- Workbench y detalle de órdenes.
- Inventario MRO con cantidades derivadas de movimientos.
- Seed industrial, tests, Docker, CI y documentación.

## V1A Maintenance Operations Core

- Incidencias rápidas, triage y conversión trazable a OT.
- Lifecycle operativo, asignación, programación, ejecución, pausa y esperas.
- Sesiones reales de mano de obra y tiempos derivados.
- Material previsto, reserva, liberación, consumo y devolución con ledger y coste histórico.
- Downtime real, cierre condicionado, timeline y expediente técnico del activo.
- Auditoría, notificaciones, Overview y scoping por planta integrados.

## V1B Preventive Maintenance & Planning

- Planes preventivos por calendario, contador o primera condición, con tareas, requisitos y materiales.
- Contadores y lecturas históricas validadas.
- Generación idempotente de OT preventivas con snapshots operativos.
- Planner semanal persistido con backlog, drag & drop, capacidad y conflictos.
- Workforce con turnos, disponibilidad, skills y certificaciones.
- PM Compliance real integrado en Centro de Control y agenda móvil específica.

## V1C Reliability Engineering

- Reliability Center con MTBF, MTTR, availability, downtime, ratios, costes MRO y tratamiento explícito de datos insuficientes.
- Modos de fallo, detección explicable de recurrencia, tendencias 7/30/90 y rankings de bad actors.
- Health score determinista con breakdown de cada ajuste.
- Pareto operacional por activo, área, modo, coste y consumo MRO.
- RCA con evidencia, 5 Whys, workflow versionado y acciones vinculadas a OT o planes.
- Eficacia preventiva presentada como correlación operativa, sin atribuir causalidad ni predictive ML.

## V1D Procurement & Supply

- Requisiciones MRO contextuales, aprobación y conversión única a pedido.
- Proveedores, ofertas aprobadas, sustitutos y snapshots de precio.
- Envío, recepción parcial/completa idempotente y proyección `on_order` coherente.
- Transferencias internas entre bins con ledger compensado.
- Reposición y riesgo de repuesto crítico integrados en Procurement, Inventario, OT y Overview.
- RBAC, auditoría, control optimista y scoping por planta aplicados a todas las mutaciones.

## V2A Field Execution

- Technician Home con trabajo actual, agenda, urgencias, esperas y relevo.
- Workspace móvil de OT con safety gate, sesión laboral, checklist tipado y cierre condicionado.
- Mediciones trazables y vinculación opcional con contadores del activo.
- Evidencias before/during/after con metadatos D1 y almacenamiento R2 abstraído.
- Identificación QR/manual con resolución scoped y expediente operativo del activo.
- Materiales, downtime, incidencia rápida y handover reutilizando invariantes V1A–V1D.
- Trazabilidad de campo visible en OT, activo y Planner de escritorio.

## V2B Enterprise Governance & Reporting

- Permisos data-driven y scopes explícitos por planta, área y almacén, aplicados en backend.
- Sesiones con expiración idle/absoluta, rotación, revocación, bloqueo temporal y auditoría de acceso.
- Calendarios productivos, turnos, ausencias y disponibilidad derivada de exposición real.
- Tarifas de labor y costes históricos congelados; coste OT consolidado con MRO y externos.
- Reporting scoped con filtros, vistas guardadas, impresión y exportación CSV gobernada.
- Audit Center append-only y Data Integrity Center diagnóstico sin reparación silenciosa.
- Cola offline durable e idempotente para operaciones de campo seguras; mutaciones críticas online-only.

## Próximos incrementos

1. Condition monitoring y adquisición de señales, sin predictive ML prematuro.
2. Multi-planta avanzada, SSO empresarial, jobs y búsqueda especializada.

No se añaden microservicios, IA de pago ni gráficos sin pregunta operativa antes de que el volumen o el flujo real los justifique.
