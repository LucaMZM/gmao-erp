# Pilot readiness — estrategia de evolución

Estado: implementación en curso sobre el monolito V2B existente.

## Idempotencia interrumpida

Una reserva sin respuesta permanece en curso durante 15 minutos: el retry
inmediato recibe `OPERATION_SYNCING` y no vuelve a ejecutar. Después, el mismo
actor, planta, clave, operación y payload pueden reclamarla automáticamente.
La retirada condicional de la reserva y su auditoría son atómicas; el worker
anterior queda _fenced_ porque su lote de negocio exige actualizar exactamente
su propia reserva antes de confirmar. Si ya se confirmó, siempre se devuelve
la respuesta persistida. Reutilizar la clave para otro payload o planta se
rechaza; nunca se mezcla una respuesta entre ámbitos. Una operación externa
fuera del lote D1 (por ejemplo, R2) requiere su propia limpieza si el proceso
cae antes de registrar metadatos; no se promete atomicidad distribuida D1/R2.

## Migraciones

`0000`–`0007` fueron generadas por Drizzle. `0008`–`0010` son SQL manual
posterior al journal: éste no representa el estado físico final. Los nuevos
deltas de esta fase se añaden como SQL manual con `--> statement-breakpoint`,
se registran en la lista explícita de `lib/server/database.ts` y se prueban
contra D1 desde cero y sobre la versión anterior. No se ejecuta
`drizzle-kit generate` sin reconciliar primero snapshots/journal: hacerlo
podría recrear objetos ya aplicados. Nunca se editan 0000–0010.

Sites puede aplicar SQL antes de que el Worker actualice `_mazmi_migrations`.
La adopción alojada exige huellas de esquema por delta y no puede marcar como
aplicada una migración cuyo objeto no exista. Si ledger y físico discrepan,
se falla cerrado; no se borra historial ni se inventa un upgrade completado.

## Entornos

`MAZMI_APP_MODE=DEMO` habilita explícitamente todos los seeds y las
credenciales de portfolio. Una binding ausente o `PRODUCTION` no carga ningún
dato demo. El desarrollo local (`vinext dev`) usa DEMO por comodidad; la
compilación para hosting usa PRODUCTION por defecto. Un despliegue real debe
configurar `MAZMI_APP_MODE` como variable de runtime y el token de bootstrap
exclusivamente como secreto privado del Worker, sin copiar `.env` al
repositorio ni pasar el token al proceso de build. El build ignora
`MAZMI_BOOTSTRAP_TOKEN` deliberadamente para no serializarlo en el artefacto.

En una base vacía de producción, un token privado aleatorio de al menos 32
caracteres (`MAZMI_BOOTSTRAP_TOKEN`) permite crear una sola organización,
planta y cuenta ADMIN desde la página inicial o `POST /api/setup`. El token
no se persiste; retirarlo tras el alta. El primer password se elige durante
el aprovisionamiento y se guarda con PBKDF2+salt aleatorio. Bases ya pobladas
no admiten este endpoint. Recuperación de contraseña por email queda fuera de
esta fase si no hay infraestructura de correo segura; requiere procedimiento
administrativo independiente.

## Seguridad física

Los acknowledgements de EPI y aislamiento de Field Ops son registros de
software. **No sustituyen** consignación física, LOTO, permisos de trabajo ni
los procedimientos HSE de la fábrica. Una OT solo debe iniciarse tras cumplir
los procedimientos reales definidos por la planta.
