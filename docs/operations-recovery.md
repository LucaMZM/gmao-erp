# Recuperación operativa — piloto

Este procedimiento distingue la base D1 (datos, auditoría y metadatos de
evidencias) de R2 (bytes de evidencias). El simulacro nunca usa producción.
Los acknowledgements de EPI/aislamiento en la aplicación **no sustituyen**
consignación física, LOTO ni permisos HSE.

## Preparación y objetivos

- Designar responsable de incidente y custodio de credenciales. Guardar en un
  gestor externo la identidad de cuenta, nombres de D1/R2, configuración del
  Worker, secretos y revisión desplegada. No guardar secretos en Git ni en un
  export SQL.
- Registrar antes de un cambio el bookmark D1 (`wrangler d1 time-travel info
<DB>`), la revisión del Worker, el último delta en `_mazmi_migrations`, los
  recuentos de registros críticos y un inventario de claves/checksums R2.
- Objetivo piloto, no garantía del proveedor: RPO operativo ≤ 24 h para D1
  y R2 **solo si** existe copia diaria independiente de objetos R2 y se
  verifica; RTO objetivo ≤ 8 h con personal y credenciales disponibles.
  Sin esa copia R2 no se promete RPO de evidencias. D1 Time Travel tiene
  retención sujeta a plan y disponibilidad del servicio (ver documentación
  vigente); no sustituye una copia de retención larga.

## Orden de recuperación

1. Poner el Worker en mantenimiento o bloquear escrituras; anotar UTC del
   incidente. No seguir escribiendo sobre una base cuyo punto de restauración
   se está eligiendo.
2. Elegir un bookmark/timestamp D1 anterior al incidente y comprobar que está
   dentro de la ventana de Time Travel. Exportar además el estado actual para
   análisis forense, sin sobrescribirlo.
3. Restaurar D1 mediante `wrangler d1 time-travel restore <DB>
--bookmark=<BOOKMARK>` **solo tras aprobación operativa y en el entorno
   objetivo correcto**. En una práctica, usar una base aislada temporal.
4. Confirmar `_mazmi_migrations`, estructura física, `PRAGMA foreign_key_check`,
   recuentos centinela, movimientos MRO, sesiones activas y auditoría. Si la
   restauración dejó el código por delante del esquema, volver a la revisión
   compatible del Worker o aplicar un forward-fix probado; nunca marcar una
   migración como aplicada sin su huella física. Una migración SQLite aplicada
   no se “deshace” borrando una fila del ledger.
5. Restaurar objetos R2 desde la copia independiente al bucket privado,
   conservando claves exactas y `contentType`; verificar tamaño y SHA-256
   contra `evidence_items`. No presumir que un objeto borrado es recuperable
   por D1 Time Travel: éste solo restaura metadatos.
6. Reponer secretos/configuración desde el gestor externo (no desde el dump).
   Verificar bindings D1/R2, `MAZMI_APP_MODE=PRODUCTION`, token de bootstrap
   retirado y acceso privado. Rotar credenciales si hubo exposición.
7. Validar health, login, scoping, una lectura de activo/OT, una evidencia,
   stock/ledger, cron PM y reporting; revisar logs. Abrir escrituras solo tras
   reconciliar el intervalo entre bookmark y evento, evitando reimportar dos
   veces operaciones con idempotency keys.

## Rollback de aplicación y esquema

Un rollback de Worker solo es seguro si la revisión anterior comprende el
esquema actual. Las migraciones 0011–0013 son aditivas; no borrar columnas ni
historial para “retroceder”. Ante incompatibilidad, congelar escrituras,
restaurar Worker compatible o preparar un forward-fix ensayado en copia. Una
restauración D1 revierte **todos** los cambios posteriores al bookmark: requiere
reconciliación de OTs, movimientos, compras y evidencias R2 correspondientes.

## Simulacro aislado

`node scripts/restore-rehearsal.mjs` ejecuta el simulacro local automatizado:
aplica todo el SQL de migración en SQLite temporal, crea una organización,
centro, activo y evidencia ajenos al seed, guarda una copia de base y bytes,
simula pérdida, restaura en otra base y comprueba sentinelas, FK, integridad y
checksum. Además, `tests/integration/pilot-factory.test.ts` crea una fábrica
en modo PRODUCTION sin seed, completa una OT y evidencia R2, copia la
persistencia D1/R2 temporal, simula pérdida, restaura y verifica que los
repositorios de la aplicación leen de nuevo la OT, Reliability, health y los
bytes SHA-256 de la evidencia. Ambos limpian sus archivos temporales. Esto
**no prueba** Time Travel remoto ni un arranque HTTP del Worker restaurado;
se ensayan aparte en staging antes de prometer el RTO objetivo.

Usar una D1 y bucket R2 temporales con datos **no demo**: organización/centro
ficticios propios del ensayo, activo, OT, movimiento y evidencia. Registrar
sentinelas y checksums, exportar D1 a SQL (`wrangler d1 export <DB> --local
--output=<ARCHIVO>`) o usar Time Travel de una base staging, copiar objetos R2
al almacén temporal, simular pérdida _solo en la copia_, restaurar en otra base
temporal (`wrangler d1 execute <DB_RESTORE> --local --file=<ARCHIVO>`), verificar
FK/ledger/metadata/checksum y arrancar el Worker contra ella para smoke. El
ensayo no ha concluido hasta comprobar lectura de evidencia y login tras el
restore. No usar la base ni el bucket de producción para ninguna operación
destructiva de prueba.

Fuentes de operación: [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/),
[D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/),
[R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/).
