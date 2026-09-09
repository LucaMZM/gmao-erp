# Arquitectura V2B

Mazmi Factory GMAO es un monolito modular TypeScript desplegable como una sola unidad. Vinext/React entrega las rutas y componentes server-side; los handlers HTTP conforman el backend; D1/SQLite aporta persistencia relacional. No hay API de IA obligatoria ni servicios distribuidos prematuros.

## Límites

- `identity`: usuarios, sesiones opacas, permisos data-driven y scopes explícitos de organización, planta, área y almacén.
- `assets`: ubicaciones funcionales, jerarquía de activos, estado, criticidad y salud.
- `incidents`: reporte rápido, triage, clasificación y conversión trazable a OT.
- `work-orders`: ciclo de vida industrial, asignaciones, labor, materiales, downtime y eventos.
- `preventive`: planes, tareas, requisitos, materiales previstos, contadores y generación idempotente de OT.
- `planning`: agenda semanal, workforce, capacidad, backlog, conflictos y reprogramación persistida.
- `reliability`: métricas acotadas en el tiempo, modos de fallo, recurrencia, health explicable, Pareto, tendencias, eficacia preventiva y RCA.
- `inventory`: catálogo MRO, almacenes, políticas y ledger inmutable de movimientos.
- `procurement`: requisiciones, ofertas aprobadas, pedidos, recepciones y transferencias internas.
- `field`: agenda del técnico, identificación de activo, ejecución guiada, seguridad, evidencia, mediciones y relevo.
- `analytics`: consultas calculadas y exportables para availability, MTBF/MTTR, costes, backlog, PM compliance y riesgo.
- `governance`: calendarios productivos, turnos, tarifas históricas, scopes e integridad observable.
- `audit`: registro append-only de acciones sensibles, éxitos y denegaciones.

Las páginas consumen repositorios server-side; los componentes interactivos solo gestionan estado de interfaz. Todo agregado operativo se filtra por `organization_id` y `site_id`. Las consultas de lista son paginadas y usan orden estable.

## Flujo de petición

1. El layout protegido resuelve una cookie de sesión opaca.
2. La sesión determina usuario, permisos, organización, plantas permitidas y scope efectivo de área/almacén.
3. El repositorio y cada operación aplican ese scope; no aceptan tenancy desde el navegador.
4. El servidor devuelve DTOs ya autorizados a la vista.
5. Las mutaciones validan invariantes y escriben auditoría/movimientos en la misma operación lógica.

## Decisiones

- D1 mantiene compatibilidad SQLite local y ejecución edge; Docker usa el mismo runtime local.
- La inicialización demo es determinista e idempotente. Las migraciones permanecen como fuente de esquema.
- El ledger de inventario es fuente de verdad; `stock_levels` es una proyección de lectura.
- Los identificadores técnicos visibles son inmutables y distintos del ID interno.
- Las mutaciones operativas viven en `lib/server/operations`: aplican RBAC, scope, transiciones y control optimista antes de escribir proyección, evento y auditoría.
- Los eventos de dominio son internos al monolito y quedan persistidos; no se introduce broker ni dependencia de IA.
- El motor preventivo evalúa calendario, contador o la primera condición que venza. Cada ocurrencia tiene una clave de ventana única que impide generar dos OT equivalentes.
- El Planner calcula capacidad y conflictos desde asignaciones, turnos, disponibilidad, skills y certificaciones. Los conflictos duros rechazan la operación; los warnings se persisten con feedback explícito.
- La ingeniería de fiabilidad es determinista: repositorios SQL construyen observaciones acotadas a 7/30/90 días y funciones puras calculan MTBF, MTTR, availability, recurrencia, Pareto, tendencias y health. Cada penalización conserva explicación y ventana.
- Una RCA es un agregado versionado. Evidencias, 5 Whys, estados y acciones quedan trazados; las acciones de tipo OT/inspección crean trabajo real en el mismo monolito, sin broker ni IA externa.
- Procurement mantiene snapshots de precio por línea, recepción idempotente y proyección `on_order` derivada de pedidos enviados pendientes. Las recepciones y transferencias actualizan stock exclusivamente mediante operaciones con ledger, scope y control optimista.
- La ejecución de campo reutiliza el agregado OT: las respuestas tipadas, mediciones, evidencias, safety acknowledgements y handovers se persisten con scope y auditoría. Los binarios viven detrás de `EvidenceStorage` en R2; D1 conserva metadatos y relaciones.
- La cola offline usa IndexedDB y claves idempotentes solo para incidencias, notas, checklist, mediciones y relevos. Stock, lifecycle, cierre y otras mutaciones críticas permanecen online-only.
- El calendario productivo aporta el denominador de disponibilidad. La exposición de planta se agrega por unidad productiva activa; los costes de labor se congelan al cerrar cada sesión.
- Reporting y Audit se resuelven server-side con filtros scoped. Data Integrity detecta desviaciones y ofrece guía, pero nunca repara silenciosamente.
