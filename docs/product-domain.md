# Producto y dominio

Mazmi Factory GMAO sirve a una empresa ficticia de packaging flexible con impresión, laminación, coating, corte, rebobinado, utilities, calidad y almacén MRO. V2B gobierna ese contexto operativo con permisos explícitos, trazabilidad, calendario productivo y coste histórico.

## Lenguaje ubicuo

- **Ubicación funcional**: contexto industrial donde se cumple una función; forma un árbol independiente.
- **Activo**: objeto mantenible situado en una ubicación; puede contener conjuntos y componentes.
- **Orden de trabajo**: intervención trazable con estado, prioridad, activo, personas, fechas y conocimiento.
- **Incidencia**: señal operativa previa a una OT que conserva origen, contexto, impacto y decisión de triage.
- **Sesión de labor**: intervalo real de trabajo de un técnico; los tiempos agregados se derivan de sus intervalos.
- **Movimiento**: evento inmutable que explica cualquier variación de stock.
- **Disponible**: físico menos reservado; nunca es sinónimo de físico.
- **Downtime**: intervalo temporal coherente con impacto productivo y causa.
- **Plan preventivo**: definición reutilizable de una intervención, su trigger y el contenido que heredará cada OT.
- **Ocurrencia preventiva**: ventana única de ejecución de un plan; solo puede originar una OT.
- **Contador**: serie monotónica de lecturas de un activo usada para disparar mantenimiento por uso.
- **Capacidad**: minutos disponibles de un técnico frente a minutos planificados en un día.
- **Conflicto de planificación**: desviación evaluada contra turno, disponibilidad, capacidad, solape, skill o certificación.
- **Modo de fallo**: clasificación formal y reutilizable que relaciona síntomas, efecto, OT, downtime y recurrencia.
- **Señal de recurrencia**: patrón explicable —aislado, estable, recurrente o creciente— calculado por activo, modo y ventana.
- **Health**: score reproducible que parte de 100 y aplica ajustes documentados por criticidad, condición, fallos, recurrencia, downtime, vencimientos, incidencias, backlog, edad y mantenimiento reciente.
- **RCA**: investigación versionada con problema, impacto, cadena causal, evidencias, 5 Whys, acciones y trazabilidad.
- **Requisición**: necesidad aprobable de material, opcionalmente originada por una OT o una señal de reposición.
- **Pedido**: compromiso versionado con proveedor aprobado y precios históricos por línea.
- **Recepción**: entrada idempotente, total o parcial, que reduce pendiente y genera ledger.
- **Transferencia**: desplazamiento interno entre bins del mismo centro mediante salida y entrada compensadas.
- **Paso de checklist**: instrucción ejecutable con respuesta tipada, criterio y trazabilidad propia.
- **Medición de intervención**: valor, unidad, rango y resultado vinculados a OT, activo y, cuando corresponde, contador.
- **Safety acknowledgement**: confirmación personal e instantánea del contexto de seguridad requerido antes de iniciar.
- **Evidencia de campo**: nota, foto o documento contextualizado; D1 conserva metadatos y el objeto binario se abstrae del dominio.
- **Relevo**: resumen de continuidad entre turnos con riesgos, material pendiente y OT relacionadas.

## Invariantes

1. Ningún activo existe sin organización, planta y ubicación funcional.
2. Las jerarquías de ubicaciones y activos no pueden formar ciclos.
3. Un activo retirado no acepta nuevas órdenes planificadas.
4. Una OT completada o cerrada no puede tener labor ni downtime activos y conserva diagnóstico/solución.
5. Toda transición de OT deja un evento de estado.
6. Todo cambio de stock crea movimiento; no existe edición directa de cantidades.
7. Disponible = físico − reservado y una reserva no excede el disponible.
8. Un consumo se vincula a una OT o a un motivo explícito y conserva coste histórico.
9. El fin de trabajo o downtime nunca precede al inicio.
10. La conversión incidencia → OT es única y deja eventos y auditoría en ambas entidades.
11. Cierres, prioridades, asignaciones, labor, materiales y downtime sensibles quedan auditados.
12. Un plan activo solo genera una OT por ventana preventiva y conserva la referencia de origen.
13. Las lecturas acumulativas no retroceden ni alteran el pasado; cada lectura tiene valor y timestamp válidos.
14. Una OT preventiva hereda checklist, duración, requisitos y materiales como snapshot de la ocurrencia.
15. La planificación fuera de turno, con solape, sobrecarga o skill insuficiente produce warning; indisponibilidad y certificación obligatoria ausente son restricciones duras.
16. PM Compliance se deriva de OT preventivas vencidas en la ventana de análisis, no de un valor seed.
17. MTBF requiere al menos dos fallos en la ventana; MTTR solo usa reparaciones con tiempos válidos. La ausencia de evidencia se presenta como datos insuficientes.
18. Los fallos recurrentes se agrupan por activo y modo formal dentro de una ventana explícita; cada señal conserva la explicación que la originó.
19. Una RCA cerrada exige causa raíz y ninguna acción abierta; los estados terminales no se reabren directamente.
20. Las acciones RCA que crean OT o inspección generan una orden real vinculada; las actualizaciones concurrentes se rechazan mediante versión esperada.
21. Las métricas y RCA siempre se filtran por organización y planta efectiva; una entidad fuera de scope se comporta como inexistente.
22. Una requisición convertida solo puede originar un pedido; los estados terminales no admiten nuevas transiciones.
23. `on_order` equivale a la cantidad pendiente de pedidos enviados o parcialmente recibidos; cancelar antes de recibir revierte esa proyección.
24. Una recepción no puede superar lo pedido, no se registra sobre un pedido cancelado y una misma clave idempotente no duplica stock.
25. Los precios de pedido, recepción y consumo son snapshots inmutables aunque cambie después el coste actual.
26. Una transferencia expedida resta una sola vez en origen y al recibirse suma una sola vez en destino; el balance del ledger es cero.
27. Requisiciones, pedidos, recepciones y transferencias aplican RBAC y scope de organización, planta, almacén y bin.
28. Una OT con checklist obligatorio no puede completarse mientras existan pasos pendientes o no conformes.
29. Las mediciones validan unidad, rango y orden temporal; las lecturas acumulativas nunca retroceden.
30. Una intervención crítica o con aislamiento no comienza sin acknowledgement del técnico que ejecuta.
31. Una evidencia mantiene organización, planta, entidad, autor y momento; el acceso al binario aplica el mismo scope.
32. Un identificador QR/manual solo resuelve activos del centro efectivo de la sesión.
33. Una acción offline se etiqueta como pendiente hasta recibir confirmación; solo las operaciones declaradas seguras entran en cola y cada reintento reutiliza su clave idempotente.
34. La ausencia de un scope explícito nunca concede acceso global; área y almacén se validan también en backend.
35. Una sesión expirada o revocada no se reutiliza y un nuevo login rota cualquier sesión presentada en la petición.
36. Una sesión laboral conserva tarifa, moneda y coste calculado como snapshot; cambios de tarifa posteriores no alteran históricos.
37. La disponibilidad usa exposición productiva calculada desde calendario, excepciones y unidades productivas activas.
38. Auditoría es append-only y registra actor, acción, entidad, contexto, resultado y request ID sin almacenar secretos.
39. Reporting y exportaciones respetan filtros, permisos y scope; Data Integrity detecta incoherencias sin modificarlas.
40. Las evidencias aceptan únicamente tipos y tamaños permitidos, conservan checksum y aplican el mismo scope al contenido.

Los invariantes implementados viven en servicios puros, operaciones transaccionales/versionadas y constraints SQL. Los restantes guían el roadmap.
