# Astra — auditoría independiente RC

Estado del informe: **gate local definitivo validado**. Base auditada: `d72877c73a9ebac060f418a4caa3bb49cc4e989d`; deployment privado anterior: v4. Este documento registra la evidencia anterior a publicar la corrección. La RC anterior no se hereda: la entrega final debe confirmar separadamente revisión publicada, smoke de contenido y logs reales.

## Evidencia y alcance

Las pruebas nuevas no sustituyen SQL por mocks: `tests/integration/independent-audit.test.ts` utiliza D1/workerd con migraciones y seed reales. Una barrera antes de `batch` fuerza lecturas concurrentes de la misma versión. Los fallos se inyectan con triggers y se comprueba la base completa de la operación después del rollback.

`scripts/independent-http.mjs` arranca el Worker **compilado**, con D1/R2 locales aislados. Usa HTTP real, conserva cookies de sesión viva y comprueba persistencia con SQLite. No añade endpoints de diagnóstico ni toca bases remotas. `tests/integration/offline-independent.test.ts` usa Chromium e IndexedDB reales; su red interceptada permite comprobar el ownership y retry del cliente, mientras el script HTTP valida la autorización backend.

## Hallazgos reproducidos y correcciones

| Severidad | Hallazgo / causa raíz                                                                                                                                                   | Corrección y regresión                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH      | Agregados, búsqueda, My Work, Audit y contexto Procurement omitían parte del scope de área/almacén. Una asignación antigua seguía exponiendo trabajo tras revocar área. | Relaciones SQL `scope_*` antes de agrupar/paginar; validación de contexto en mutaciones y del técnico destino. Positivos y negativos sobre D1 y sesión HTTP viva.                                               |
| HIGH      | Notificaciones/relevos materializados conservaban visibilidad del scope anterior.                                                                                       | Filtrado al leer, con pertenencia vigente de la entidad y permisos de su módulo. No se borra historial.                                                                                                         |
| HIGH      | CAS comprobado después del commit permitía material/ledger sin el cambio de stock correspondiente.                                                                      | Aserciones SQL dentro del mismo `batch`; un CAS fallido revierte toda la operación. Reservas, recepción, PM, RCA, labor y downtime con concurrencia/fault injection.                                            |
| HIGH      | Persistencia de respuesta idempotente posterior al negocio: fallo podía dejar evidencia confirmada y permitir duplicarla en retry.                                      | Respuesta idempotente y negocio en la misma transacción; fingerprint de operación/payload; permisos revalidados antes del replay.                                                                               |
| HIGH      | La cola offline adoptaba la sesión actual de otro usuario/planta.                                                                                                       | Se conserva usuario, organización, planta, key, ruta y payload; entradas antiguas sin autor no se reproducen. Headers de identidad esperada se contrastan con la sesión autenticada, no se usan como autoridad. |
| HIGH      | Carreras cancelación/reserva y completado/downtime podían dejar estados incompatibles; doble labor activa por técnico.                                                  | Guards transaccionales y dos índices UNIQUE parciales en 0010; no se debilitan invariantes.                                                                                                                     |
| HIGH      | Revocar `workorder.execute` ocultaba navegación pero no el workspace móvil ni la descarga directa de evidencias.                                                        | Guard backend en My Work y contenido de evidencia; descarga `private, no-store`. Prueba HTTP con la misma cookie antes/después/restauración.                                                                    |
| HIGH      | Revocar `incident.report` dejaba disponibles lista, detalle, metadata y búsqueda de Incidencias.                                                                        | Mismo permiso backend que navegación, también en búsqueda y notificaciones. Prueba de sesión viva.                                                                                                              |
| MEDIUM    | Devoluciones de lotes con precios distintos usaban el último precio; Reliability invertía de nuevo el signo del coste de devolución.                                    | Coste ponderado pendiente histórico de OT/pieza/ubicación, con fuentes trazables en auditoría; suma de importes firmados. Tests de devolución parcial/total, retry y cambio del precio actual.                  |
| MEDIUM    | Reliability calculaba totales/Pareto y recurrencia desde listas limitadas. Con 10×, recurrencia 4,76% frente al 0,75% SQL.                                              | Totales, recurrencia por activo y porcentajes Pareto sobre toda la población SQL; ranking visual limitado por separado. Health no depende de la lista de señales.                                               |
| MEDIUM    | Consulta histórica Reliability incluía fallos posteriores a `asOf`.                                                                                                     | Cota superior de ventana en métricas, costes, señales y tendencias. Regresión que añade un fallo futuro y exige resultados históricos idénticos.                                                                |
| MEDIUM    | SQL Procurement podía fallar durante streaming SSR con HTTP 200; el smoke aceptaba solo el status.                                                                      | Consulta corregida; smoke comprueba contenido real y ausencia de error RSC. Consola/runtime monitorizados en Playwright.                                                                                        |
| MEDIUM    | CSV entrecomillado permitía fórmulas ejecutables.                                                                                                                       | Neutralización de prefijos de fórmula/control; regresión específica.                                                                                                                                            |
| MEDIUM    | Adopción de esquema alojado comprobaba nombres, no definición efectiva de guards.                                                                                       | Fingerprint de definiciones de 0010; rechaza índices debilitados y ledger que declara guards ausentes.                                                                                                          |
| MEDIUM    | Overview y Reporting usaban minutos de downtime como MTTR, incluso cuando diferían de la intervención real.                                                             | MTTR desde `actual_start/actual_end` de intervenciones terminadas dentro de su cohorte temporal; comparación con SQL independiente, también en 7/30/90 y dataset 10×.                                           |
| LOW       | `MICROSTOP` persistido se etiquetaba como «Sin impacto productivo» al consultar Reliability.                                                                            | Correspondencia corregida con el enum real y regresión que inicia/finaliza una microparada por el servicio de dominio.                                                                                          |

## Migración 0010

`0010_atomic_mutation_assertions.sql` es **aditiva**. No reescribe 0000–0009 ni corrige/borra historial:

- `_mutation_assertions`: CHECK transaccional para abortar compare-and-swap fallidos; no almacena filas en operaciones correctas.
- `uq_labor_one_active_user`: una sesión activa por técnico.
- `uq_downtime_one_active_order`: un downtime activo por OT.
- `trg_work_order_finalization_guard`: impide finalizar con labor/downtime activo y cerrar/cancelar con reservas.
- `trg_material_final_order_guard`: no modifica material de OT cerrada/cancelada.
- `trg_downtime_final_order_guard`: no inicia downtime en OT completada/cerrada/cancelada.

El bootstrap ejecuta preflight de duplicados activos y falla con IDs y conteos si existen incompatibilidades. No hay reparación silenciosa. Sites mantiene su propio ledger: se validan tanto esquema físico 0009 como físico 0010 con ledger interno atrasado. Solo se adopta 0010 si están todos sus objetos y definiciones; un esquema parcial/debilitado se rechaza.

La suite de migración verifica bootstrap, upgrades desde 0006/0007/0008/0009, reseed/reintento, centinelas, FK y `PRAGMA quick_check` (el motor D1 no admite `PRAGMA integrity_check`). Las migraciones SQL y la lista explícita del bootstrap son la fuente de verdad. El journal de generación de Drizzle termina en 0007: 0008–0010 son deltas SQL manuales. No ejecutar `db:generate` y aplicar su salida sin reconciliar primero ese snapshot; podría proponer de nuevo cambios ya aplicados.

## Métricas / carga

Reliability usa una ventana de 90 días y exposición técnica 24/7 por activo no retirado. Reporting usa cohortes por fecha de completado y calendario productivo; no se presentan como la misma disponibilidad. El test 10× añade 648 activos y OTs persistidas a la población de 72 activos: **no representa 10× Procurement/MRO ni una prueba de carga multiusuario**. Compara totales y porcentajes con SQL independiente, 7/30/90 en Reporting, tendencias y expediente/health; mide tiempo y tamaño JSON de siete repositorios.

Los tiempos son mediciones locales, no SLA ni percentiles de producción. Última medición aislada con lockfile corregido (1× → 10×):

| Consulta    | Milisegundos | Bytes JSON    |
| ----------- | ------------ | ------------- |
| Overview    | 110 → 126    | 5288 → 5304   |
| Planner     | 62 → 56      | 29317 → 29317 |
| Reliability | 113 → 135    | 49993 → 95789 |
| Procurement | 82 → 78      | 61201 → 61201 |
| Reporting   | 65 → 75      | 3272 → 3289   |
| Inventario  | 36 → 35      | 10947 → 10947 |
| My Work     | 89 → 67      | 480 → 480     |

No se observa crecimiento cuadrático en esta muestra. My Work corresponde al responsable sin agenda propia; no se extrapola a una agenda de técnico masiva. La prueba compara recurrencia, MTBF, MTTR, disponibilidad, costes, Pareto, tendencias y health de cada bad actor contra SQL independiente/expediente.

## Visual y seguridad del toolchain

Las dos referencias de My Work anteriores incluían OTs de Impresión, Corte y Utilities fuera del área de Irene. El usuario autorizó **únicamente** su sustitución después de comprobar el scope de cada OT visible. Solo se sustituyeron `my-work-desktop-desktop-darwin.png` y `my-work-mobile-mobile-darwin.png`. Las cuatro OTs visibles (0390, 0223, 0233, 0259) pertenecen a Laminación y se contrastan con la jerarquía de áreas autorizadas en la regresión HTTP. Ninguna otra baseline cambió. La suite completa pasó 10/10 sin update tanto en preview como contra Worker compilado.

El audit inicial del lockfile encontró cinco alertas HIGH de toolchain. Se aplicaron parches compatibles con `npm audit fix`, **sin `--force`**. Quedan cuatro avisos moderados en la cadena Drizzle Kit → esbuild antiguo: solución propuesta incompatible (downgrade mayor de Drizzle). Clasificación **TOOLCHAIN**; no se usa su servidor esbuild y no entra en el Worker. `npm audit --omit=dev`: cero vulnerabilidades después de los parches. El audit completo conserva exit 1 por esos cuatro avisos; no se declara limpio.

## Límites y deuda explícita

- **MEDIUM**: si el proceso desaparece después de reservar una key idempotente pero antes del batch de negocio, puede quedar una reserva sin respuesta. El retry falla cerrado con `OPERATION_SYNCING`; no hay lease/reclamación automática para esa interrupción abrupta. Requiere diagnóstico del registro pendiente, no borrar reservas silenciosamente. Los fallos capturables y el rollback/retry sí están probados.
- **LOW**: reconciliar los snapshots de generación Drizzle antes de generar un futuro delta; no afecta a bootstrap/upgrades versionados actuales.
- **LOW**: snapshots visuales de referencia en macOS/Chromium. La CI Linux ejecuta integración/HTTP/smoke, no comparación binaria contra baselines de otra plataforma.
- **LOW**: accesibilidad validada con teclado, foco, landmarks, nombres y semántica; no equivale a certificación WCAG ni a revisión exhaustiva con lector de pantalla.
- **TOOLCHAIN**: cuatro advisories moderados dev-only descritos arriba. No se forzó una solución incompatible.

### Idempotencia interrumpida: MEDIUM, no bloquea esta RC privada

Es un defecto de disponibilidad/recuperación, no una relajación de seguridad. Afecta a operaciones que pasan por `runIdempotent` con key: reporte de incidencia, relevo, checklist, medición y evidencia (nota o archivo). Reservas/consumos, recepciones, generación preventiva y acciones RCA no usan este registro de sincronización; tienen sus propios controles transaccionales.

La regresión `interrupted idempotency checkpoint...` materializa en D1 exactamente el checkpoint durable de una petición terminada: reserva antigua sin respuesta y sin batch de negocio. Dos retries con contextos nuevos devuelven 409 `OPERATION_SYNCING`, no ejecutan el negocio y no crean evidencia. Después simula recuperación explícita del registro: el mismo payload/key confirma una vez, el siguiente retry reproduce la respuesta y FK permanece limpia. Esta prueba no pretende simular un corte eléctrico físico.

- **Pérdida:** no borra datos previamente confirmados. La operación interrumpida todavía no se ha guardado en el dominio; no debe mostrarse como confirmada. El payload offline permanece en IndexedDB si se conserva ese dispositivo/perfil. Un archivo online puede requerir seleccionarlo otra vez; no existe garantía de recuperación de un borrador local borrado por el usuario.
- **Duplicación/corrupción:** no observada en el checkpoint ni en la recuperación probada; el bloqueo impide ejecutar de nuevo y la respuesta se confirma atómicamente con el negocio. No editar ledger ni registros de intervención para recuperarlo.
- **Recuperación:** no hay autoservicio ni vencimiento de la reserva. Un administrador debe confirmar que la petición original ha terminado, identificar por ID/actor/organización/planta/key el registro sin `response_json`, comprobar ausencia de efecto de negocio y conservar evidencia del diagnóstico. Con acceso D1 autorizado elimina **solo ese registro pendiente**, condicionado a `response_json IS NULL`, registra la intervención y permite reintentar con la key y payload originales. Nunca eliminar una respuesta confirmada ni hacer borrado masivo por antigüedad.
- **Decisión:** MEDIUM porque bloquea una operación individual recuperable, sin exposición entre usuarios/plantas ni corrupción de datos confirmados. No impide razonablemente la RC privada auditada; no equivale a garantizar operación desatendida de alta disponibilidad.

Recuento de hallazgos de producto de Astra: **17** (8 HIGH, 8 MEDIUM, 1 LOW). Los 16 de la tabla fueron corregidos; este límite MEDIUM permanece documentado. Los advisories del toolchain se contabilizan aparte.

## Gate definitivo local (2026-09-11)

| Gate                                                                     | Resultado                                                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Format / format:check / lint / TypeScript                                | PASS                                                                                                                       |
| Unit/integration completos                                               | **152/152 PASS**, 11 archivos: 85 unitarios, 49 D1 adversariales, 9 migración, 9 IndexedDB/Chromium                        |
| HTTP adversarial sobre Worker compilado                                  | **34/34 PASS**; sesión viva, rotación simultánea, expiración, revocación, ownership, scope, concurrencia/fault injection   |
| E2E/smoke acumulado V1A–V2B                                              | PASS; flujos persistidos, rutas, negativos de auth/API, Levante/Alzira                                                     |
| Regresión visual sin update, Worker compilado                            | **10/10 PASS**; desktop 1440×1000 y móvil 390×844, dark/light, foco/landmarks/labels, consola y page errors vacíos         |
| Build Vinext/Worker                                                      | PASS                                                                                                                       |
| Bootstrap 0000→0010; upgrades 0006/0007/0008/0009→0010                   | PASS; casos Sites físico/ledger desfasados incluidos                                                                       |
| Seed/reseed/reintento, centinelas, FK, quick_check, guards e invariantes | PASS; cero violaciones                                                                                                     |
| Reliability 10× y ventanas históricas                                    | PASS; SQL independiente y expediente/health coherentes                                                                     |
| Audit producción                                                         | **0 vulnerabilidades**                                                                                                     |
| Audit completo                                                           | **4 moderate TOOLCHAIN**, exit 1 declarado; no force/upgrade incompatible                                                  |
| Preflight remoto de solo lectura, antes de publicar                      | 62 sesiones de labor (4 activas), 40 downtime (1 activo): cero duplicados incompatibles con 0010; ledger remoto hasta 0009 |

Automatización versionada: `npm test`, `npm run test:audit:http`, `npm run test:smoke:compiled`, `npm run test:visual:compiled`, `npm run format:check`, `npm run lint`, `npm run typecheck`, build y audit. El smoke compilado crea D1/R2 aislados y no toca el deployment; el smoke publicado es un recorrido acotado autenticado, no la suite mutativa entera sobre producción.

No hay BLOCKER/HIGH de producto abierto en el alcance auditado. El límite idempotente MEDIUM permanece explícito. La confirmación RC requiere además publicación **owner-private** de esta misma fuente/artefacto, 0010 activa, contenido real en health/login/Overview/My Work/Reliability/Procurement/Reporting, logout con acceso posterior denegado y logs reales sin errores nuevos. Los identificadores finales y el resultado de esa publicación se adjuntan en la entrega, no se presuponen aquí.
