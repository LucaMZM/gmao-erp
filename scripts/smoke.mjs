const baseUrl = process.env.MAZMI_BASE_URL ?? "http://localhost:3000";
const credentials = {
  email: process.env.MAZMI_DEMO_EMAIL ?? "responsable@mazmi.demo",
  password: process.env.MAZMI_DEMO_PASSWORD ?? "Mazmi2026!",
};
const origin = new URL(baseUrl).origin;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRenderedPage(response, path) {
  assert(response.ok, `${path} failed with ${response.status}`);
  const body = await response.text();
  // Streaming SSR may send HTTP 200 before a route fails. Check the completed
  // payload, not just its shell/status (error boundaries are serialized too).
  const decoded = body.replaceAll('\\"', '"');
  assert(
    !/:E\{"digest":/.test(decoded),
    `${path} streamed an RSC error despite HTTP ${response.status}`,
  );
  assert(/<h1(?:\s[^>]*)?>/.test(body), `${path} did not render page content`);
  return body;
}

async function expectApiError(response, status, code) {
  assert(
    response.status === status,
    `Expected ${status}, got ${response.status}`,
  );
  const body = await response.json();
  assert(
    body.error?.code === code,
    `Expected ${code}, got ${body.error?.code}`,
  );
  assert(body.error?.requestId, `${code} did not include a requestId.`);
}

async function expectRejectedOrigin(response) {
  assert(response.status === 403, `Expected 403, got ${response.status}`);
  const body = await response.text();
  if (body.trim() === "Forbidden") {
    return;
  }
  const payload = JSON.parse(body);
  assert(
    payload.error?.code === "ORIGIN_REJECTED",
    `Expected ORIGIN_REJECTED, got ${payload.error?.code}`,
  );
  assert(payload.error?.requestId, "Origin rejection omitted requestId.");
}

async function expectPageRedirect(path, cookie, destination = "/overview") {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie },
    redirect: "manual",
  });
  assert(
    [301, 302, 303, 307, 308].includes(response.status),
    `${path} should redirect, got ${response.status}.`,
  );
  const location = new URL(
    response.headers.get("location") ?? "/missing",
    baseUrl,
  );
  assert(
    location.pathname === destination,
    `${path} redirected to ${location.pathname}, expected ${destination}.`,
  );
}

async function postJson(path, cookie, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin,
    },
    body: JSON.stringify(body),
  });
}

async function postJsonIdempotent(path, cookie, body, idempotencyKey) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      cookie,
      origin,
    },
    body: JSON.stringify(body),
  });
}

async function expectOkData(response, context) {
  const body = await response.json();
  assert(
    response.ok,
    `${context} failed with ${response.status}: ${body.error?.code ?? "unknown"} ${body.error?.message ?? ""}`,
  );
  assert(body.requestId, `${context} omitted requestId.`);
  return body.data;
}

const health = await fetch(`${baseUrl}/api/health`);
assert(health.ok, `Health check failed with ${health.status}`);
const healthData = await health.json();
assert(
  healthData.schemaVersion === "0010_atomic_mutation_assertions",
  `Unexpected schema version ${healthData.schemaVersion}.`,
);
assert(healthData.assets === 72, "Expected 72 seeded assets.");
assert(healthData.workOrders >= 80, "Expected at least 80 seeded work orders.");
assert(healthData.parts === 180, "Expected 180 seeded MRO references.");
assert(healthData.rootCauseAnalyses >= 4, "Expected the V1C reliability seed.");
assert(healthData.foreignKeyViolations === 0, "Foreign-key violations found.");
assert(healthData.stockInvariantViolations === 0, "Stock invariant violated.");
assert(
  healthData.reliabilityInvariantViolations === 0,
  "Reliability invariant violated.",
);
assert(
  healthData.purchaseRequisitions > 0,
  "Expected the V1D procurement seed.",
);
assert(healthData.purchaseOrders > 0, "Expected seeded purchase orders.");
assert(healthData.goodsReceipts > 0, "Expected a seeded goods receipt.");
assert(
  healthData.procurementInvariantViolations === 0,
  "Procurement invariant violated.",
);
assert(
  healthData.onOrderInvariantViolations === 0,
  "On-order invariant violated.",
);
assert(
  healthData.transferInvariantViolations === 0,
  "Transfer invariant violated.",
);
assert(healthData.fieldEvidenceItems > 0, "Expected the V2A evidence seed.");
assert(healthData.shiftHandovers > 0, "Expected the V2A handover seed.");
assert(
  healthData.workOrderMeasurements > 0,
  "Expected the V2A measurement seed.",
);
assert(healthData.fieldInvariantViolations === 0, "Field invariant violated.");
assert(
  healthData.assetsWithoutScanCode === 0,
  "Asset scan-code coverage is incomplete.",
);
assert(
  healthData.productionCalendars === 2,
  "Expected two production calendars.",
);
assert(healthData.scopedMemberships >= 16, "Membership scopes are incomplete.");
assert(
  healthData.pricedLaborSessions > 0,
  "Historical labor rates were not frozen.",
);
assert(
  healthData.governanceInvariantViolations === 0,
  "Enterprise governance invariant violated.",
);
assert(
  healthData.scopeInvariantViolations === 0,
  "Access scope invariant violated.",
);

const protectedRoute = await fetch(`${baseUrl}/overview`, {
  redirect: "manual",
});
assert(
  [301, 302, 303, 307, 308].includes(protectedRoute.status),
  `Protected route did not redirect (${protectedRoute.status}).`,
);
assert(
  new URL(protectedRoute.headers.get("location") ?? "/missing", baseUrl)
    .pathname === "/",
  "Protected route did not redirect to login.",
);

await expectApiError(
  await fetch(`${baseUrl}/api/search?q=LM-02`),
  401,
  "UNAUTHORIZED",
);

await expectApiError(
  await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: "{",
  }),
  400,
  "MALFORMED_JSON",
);

await expectApiError(
  await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ ...credentials, password: "Credencial-Incorrecta" }),
  }),
  401,
  "INVALID_CREDENTIALS",
);

await expectRejectedOrigin(
  await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://origen-no-permitido.example",
    },
    body: JSON.stringify(credentials),
  }),
);

await expectApiError(
  await fetch(`${baseUrl}/api/session/site`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ siteId: "site-alzira" }),
  }),
  401,
  "UNAUTHORIZED",
);

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify(credentials),
});
assert(login.ok, `Demo login failed with ${login.status}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
assert(cookie, "Login did not return a session cookie.");

const routes = [
  "/overview",
  "/assets",
  "/assets/LM-02-APP",
  "/incidents",
  "/incidents/INC-LEV-2026-0104",
  "/work-orders",
  "/work-orders/OT-LEV-2026-0184",
  "/inventory",
  "/maintenance-plans",
  "/maintenance-plans/PM-LEV-2026-003",
  "/planner?week=2026-09-01",
  "/reliability",
  "/reliability/rca/RCA-LEV-2026-001",
  "/procurement",
  "/procurement/requisitions/PR-LEV-2026-048",
  "/procurement/purchase-orders/PO-LEV-2026-069",
  "/my-work",
  "/my-work/OT-LEV-2026-0390",
  "/scan",
  "/scan/MZ-LEV-LM-02-APP",
  "/reports",
  "/audit",
  "/governance",
];

for (const route of routes) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { cookie } });
  const body = await assertRenderedPage(response, route);
  assert(body.includes("Mazmi"), `${route} did not render the product shell.`);
  assert(
    !body.includes("No se han podido cargar los datos"),
    `${route} rendered the route error boundary.`,
  );
  console.log(`✓ ${route}`);
}

const levanteSearch = await fetch(`${baseUrl}/api/search?q=LM-02`, {
  headers: { cookie },
});
assert(levanteSearch.ok, "Levante search failed.");
assert(
  (await levanteSearch.text()).includes("LM-02"),
  "Levante asset was not searchable.",
);

const incidentIdempotencyKey = `smoke-incident-${crypto.randomUUID()}`;
const incidentPayload = {
  functionalLocationId: "loc-lev-lm-01",
  assetId: "asset-lm-01-drv",
  title: "Validación integral del acoplamiento de LM-01",
  description:
    "Se detecta vibración reproducible durante el cambio de velocidad del equipo.",
  severity: "HIGH",
  initialImpact: "REDUCED_SPEED",
  origin: "MAINTENANCE",
};
const incident = await expectOkData(
  await postJsonIdempotent(
    "/api/incidents",
    cookie,
    incidentPayload,
    incidentIdempotencyKey,
  ),
  "Incident report",
);
assert(incident.id && incident.number, "Incident creation omitted identity.");
const replayedIncident = await expectOkData(
  await postJsonIdempotent(
    "/api/incidents",
    cookie,
    incidentPayload,
    incidentIdempotencyKey,
  ),
  "Incident idempotency replay",
);
assert(
  replayedIncident.id === incident.id,
  "Incident idempotency did not return the original resource.",
);

await expectOkData(
  await postJson(`/api/incidents/${incident.id}/triage`, cookie, {
    action: "START_TRIAGE",
    note: "Revisión iniciada por mantenimiento.",
  }),
  "Start triage",
);
await expectOkData(
  await postJson(`/api/incidents/${incident.id}/triage`, cookie, {
    action: "ACCEPT",
    assetId: "asset-lm-01-drv",
    priority: "P3_HIGH",
    classification: "CORRECTIVE",
    note: "Activo y afectación confirmados.",
  }),
  "Accept incident",
);
const converted = await expectOkData(
  await postJson(`/api/incidents/${incident.id}/convert`, cookie, {}),
  "Convert incident",
);
assert(
  converted.number && converted.id,
  "Conversion omitted work order identity.",
);
const workOrderPath = `/api/work-orders/${encodeURIComponent(converted.number)}`;
const plannedStart = new Date(Date.now() + 30 * 60_000).toISOString();
const plannedEnd = new Date(Date.now() + 150 * 60_000).toISOString();

await expectOkData(
  await postJson(`${workOrderPath}/actions`, cookie, {
    action: "SCHEDULE",
    plannedStart,
    plannedEnd,
  }),
  "Schedule work order",
);
await expectOkData(
  await postJson(`${workOrderPath}/actions`, cookie, {
    action: "ASSIGN",
    technicianId: "user-tech-4",
  }),
  "Assign technician",
);
await expectOkData(
  await postJson(`${workOrderPath}/actions`, cookie, {
    action: "START",
    technicianId: "user-tech-4",
  }),
  "Start work",
);
await expectOkData(
  await postJson(`${workOrderPath}/actions`, cookie, {
    action: "PAUSE",
    note: "Pausa breve para aislar energías.",
  }),
  "Pause work",
);
await expectOkData(
  await postJson(`${workOrderPath}/actions`, cookie, {
    action: "RESUME",
    technicianId: "user-tech-4",
  }),
  "Resume work",
);
await expectOkData(
  await postJson(`${workOrderPath}/actions`, cookie, {
    action: "WAIT_PART",
    note: "Recambio preparado por almacén.",
  }),
  "Wait for part",
);
const resumed = await expectOkData(
  await postJson(`${workOrderPath}/actions`, cookie, {
    action: "RESUME",
    technicianId: "user-tech-4",
  }),
  "Resume after part",
);

const plannedMaterial = await expectOkData(
  await postJson(`${workOrderPath}/materials`, cookie, {
    action: "ADD_PLANNED",
    partId: "part-010",
    quantity: 2,
  }),
  "Add planned material",
);
await expectOkData(
  await postJson(`${workOrderPath}/materials`, cookie, {
    action: "RESERVE",
    materialId: plannedMaterial.materialId,
    quantity: 2,
  }),
  "Reserve material",
);
await expectOkData(
  await postJson(`${workOrderPath}/materials`, cookie, {
    action: "RELEASE",
    materialId: plannedMaterial.materialId,
    quantity: 1,
  }),
  "Release material",
);
await expectOkData(
  await postJson(`${workOrderPath}/materials`, cookie, {
    action: "CONSUME",
    materialId: plannedMaterial.materialId,
    quantity: 2,
  }),
  "Consume material",
);
await expectOkData(
  await postJson(`${workOrderPath}/materials`, cookie, {
    action: "RETURN",
    materialId: plannedMaterial.materialId,
    quantity: 1,
  }),
  "Return material",
);

const stockoutMaterial = await expectOkData(
  await postJson(`${workOrderPath}/materials`, cookie, {
    action: "ADD_PLANNED",
    partId: "part-047",
    quantity: 1,
  }),
  "Add unavailable material",
);
await expectApiError(
  await postJson(`${workOrderPath}/materials`, cookie, {
    action: "RESERVE",
    materialId: stockoutMaterial.materialId,
    quantity: 1,
  }),
  409,
  "INSUFFICIENT_AVAILABLE_STOCK",
);

const downtime = await expectOkData(
  await postJson(`${workOrderPath}/downtime`, cookie, {
    action: "START",
    kind: "UNPLANNED",
    productionImpact: "REDUCED_SPEED",
    cause: "Intervención correctiva sobre accionamiento.",
  }),
  "Start downtime",
);
const completionData = {
  action: "COMPLETE",
  diagnosis: "Holgura y desgaste del elemento elástico confirmados.",
  solution:
    "Acoplamiento sustituido, alineación verificada y prueba funcional correcta.",
  failureMode: "VIBRATION",
  failureCause: "WEAR",
};
await expectApiError(
  await postJson(`${workOrderPath}/actions`, cookie, completionData),
  409,
  "ACTIVE_LABOR_SESSION",
);
await expectOkData(
  await postJson(`${workOrderPath}/actions`, cookie, {
    action: "STOP_SESSION",
    laborSessionId: resumed.laborSessionId,
  }),
  "Stop labor session",
);
await expectApiError(
  await postJson(`${workOrderPath}/actions`, cookie, completionData),
  409,
  "ACTIVE_DOWNTIME",
);
await expectOkData(
  await postJson(`${workOrderPath}/downtime`, cookie, {
    action: "END",
    downtimeId: downtime.id,
  }),
  "End downtime",
);
await expectOkData(
  await postJson(`${workOrderPath}/actions`, cookie, completionData),
  "Complete work order",
);
await expectOkData(
  await postJson(`${workOrderPath}/actions`, cookie, { action: "CLOSE" }),
  "Close work order",
);
await expectApiError(
  await postJson(`${workOrderPath}/actions`, cookie, { action: "CLOSE" }),
  409,
  "INVALID_WORK_ORDER_TRANSITION",
);
await expectApiError(
  await postJson(`${workOrderPath}/materials`, cookie, {
    action: "RESERVE",
    materialId: plannedMaterial.materialId,
    quantity: 1,
  }),
  409,
  "FINAL_WORK_ORDER",
);
await expectApiError(
  await postJson(`${workOrderPath}/downtime`, cookie, {
    action: "START",
    kind: "UNPLANNED",
    productionImpact: "FULL_STOP",
    cause: "No debe registrarse tras el cierre.",
  }),
  409,
  "FINAL_WORK_ORDER",
);
await expectApiError(
  await postJson(`/api/incidents/${incident.id}/convert`, cookie, {}),
  409,
  "INCIDENT_NOT_ACCEPTED",
);

for (const [route, expected] of [
  [`/incidents/${encodeURIComponent(incident.number)}`, converted.number],
  [`/work-orders/${encodeURIComponent(converted.number)}`, incident.number],
  ["/assets/LM-01-DRV", "Validación integral del acoplamiento"],
]) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { cookie } });
  assert(response.ok, `${route} failed after operational workflow.`);
  assert(
    (await response.text()).includes(expected),
    `${route} did not expose the related operational history.`,
  );
}
console.log(`✓ V1A flow ${incident.number} → ${converted.number}`);

const preventiveFirstDue = new Date(Date.now() - 5 * 60_000).toISOString();
const preventivePlan = await expectOkData(
  await postJson("/api/maintenance-plans", cookie, {
    assetId: "asset-lm-01",
    ownerId: "user-planner",
    title: "Validación mensual de transmisión LM-01",
    description:
      "Plan E2E para inspeccionar transmisión, protecciones y condición del accionamiento.",
    criticality: "HIGH",
    priority: "P3_HIGH",
    estimatedMinutes: 120,
    triggerMode: "CALENDAR",
    calendarUnit: "MONTH",
    calendarInterval: 1,
    firstDueAt: preventiveFirstDue,
    meterId: null,
    meterInterval: null,
    meterThreshold: null,
    leadDays: 7,
    tasks: [
      { title: "Aplicar consignación LOTO", required: true },
      { title: "Inspeccionar transmisión y protecciones", required: true },
      { title: "Registrar condición y liberar equipo", required: true },
    ],
    skills: [{ skillId: "skill-mechanical", minimumLevel: 3 }],
    certificationIds: ["cert-atex"],
    materials: [{ partId: "part-002", quantity: 1 }],
  }),
  "Create preventive plan",
);
assert(preventivePlan.code, "Preventive plan creation omitted code.");

const generatedPreventive = await expectOkData(
  await postJson(
    `/api/maintenance-plans/${encodeURIComponent(preventivePlan.code)}/actions`,
    cookie,
    { action: "GENERATE" },
  ),
  "Generate preventive work order",
);
assert(
  generatedPreventive.created && generatedPreventive.number,
  "Preventive generation omitted work-order identity.",
);
const idempotentGeneration = await expectOkData(
  await postJson(
    `/api/maintenance-plans/${encodeURIComponent(preventivePlan.code)}/actions`,
    cookie,
    { action: "GENERATE" },
  ),
  "Repeat preventive generation",
);
assert(
  idempotentGeneration.created === false &&
    idempotentGeneration.number === generatedPreventive.number,
  "Preventive generation was not idempotent on immediate retry.",
);

const plannerDate = new Date().toISOString().slice(0, 10);
await expectApiError(
  await postJson("/api/planner/schedule", cookie, {
    number: generatedPreventive.number,
    expectedVersion: 1,
    technicianId: "user-tech-1",
    date: plannerDate,
  }),
  409,
  "HARD_PLANNING_CONFLICT",
);
const firstPlannerMove = await expectOkData(
  await postJson("/api/planner/schedule", cookie, {
    number: generatedPreventive.number,
    expectedVersion: 1,
    technicianId: "user-tech-2",
    date: plannerDate,
  }),
  "Assign preventive in planner",
);
assert(
  firstPlannerMove.version === 2,
  "Planner assignment did not increment version.",
);
assert(
  firstPlannerMove.conflicts.some((item) => item.code === "MISSING_SKILL"),
  "Planner did not report the controlled skill warning.",
);
const backlogMove = await expectOkData(
  await postJson("/api/planner/schedule", cookie, {
    number: generatedPreventive.number,
    expectedVersion: 2,
    technicianId: null,
    date: null,
  }),
  "Move preventive to backlog",
);
assert(backlogMove.version === 3, "Backlog move did not persist its version.");
const nextPlannerDate = new Date(Date.now() + 86_400_000)
  .toISOString()
  .slice(0, 10);
const finalPlannerMove = await expectOkData(
  await postJson("/api/planner/schedule", cookie, {
    number: generatedPreventive.number,
    expectedVersion: 3,
    technicianId: "user-tech-2",
    date: nextPlannerDate,
  }),
  "Reprogram preventive from backlog",
);
assert(
  finalPlannerMove.version === 4,
  "Planner reprogramming did not persist.",
);

const meterReading = await expectOkData(
  await postJson("/api/meters/meter-comp02-hours/readings", cookie, {
    value: 999_999_999,
    recordedAt: new Date().toISOString(),
    note: "Lectura E2E de validación V1B.",
  }),
  "Record meter reading",
);
assert(
  meterReading.duePlanCodes.includes("PM-LEV-2026-003"),
  "Meter reading did not activate its preventive trigger.",
);

await expectOkData(
  await postJson(
    `/api/maintenance-plans/${encodeURIComponent(preventivePlan.code)}/actions`,
    cookie,
    { action: "SET_STATUS", status: "INACTIVE", expectedVersion: 2 },
  ),
  "Pause preventive plan",
);
await expectOkData(
  await postJson(
    `/api/maintenance-plans/${encodeURIComponent(preventivePlan.code)}/actions`,
    cookie,
    { action: "SET_STATUS", status: "ACTIVE", expectedVersion: 3 },
  ),
  "Reactivate preventive plan",
);

for (const [route, expected] of [
  [
    `/maintenance-plans/${encodeURIComponent(preventivePlan.code)}`,
    generatedPreventive.number,
  ],
  [
    `/work-orders/${encodeURIComponent(generatedPreventive.number)}`,
    preventivePlan.code,
  ],
  ["/assets/LM-01", preventivePlan.code],
  [`/planner?week=${plannerDate}`, generatedPreventive.number],
  ["/overview", "Cumplimiento PM"],
]) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { cookie } });
  assert(response.ok, `${route} failed after preventive workflow.`);
  assert(
    (await response.text()).includes(expected),
    `${route} did not expose ${expected}.`,
  );
}
console.log(
  `✓ V1B flow ${preventivePlan.code} → ${generatedPreventive.number}`,
);

const reliabilityPage = await fetch(`${baseUrl}/reliability`, {
  headers: { cookie },
});
assert(reliabilityPage.ok, "Reliability Center failed.");
const reliabilityBody = await reliabilityPage.text();
for (const expected of [
  "Reliability Center",
  "Bad actors",
  "Pareto operacional",
  "MTBF",
  "MTTR",
  "RCA-LEV-2026-001",
]) {
  assert(
    reliabilityBody.includes(expected),
    `Reliability Center did not expose ${expected}.`,
  );
}

const rca = await expectOkData(
  await postJson("/api/reliability/rca", cookie, {
    assetId: "asset-lm-01-drv",
    sourceWorkOrderId: converted.id,
    failureModeId: "fm-vibration",
    ownerId: "user-reliability",
    problem:
      "Recurrencia de vibración en accionamiento LM-01 durante validación E2E.",
    impact: "Producción degradada y riesgo de parada no planificada.",
    targetAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  }),
  "Create root cause analysis",
);
assert(rca.number, "RCA creation omitted its number.");
const rcaPath = `/api/reliability/rca/${encodeURIComponent(rca.number)}/actions`;
await expectOkData(
  await postJson(rcaPath, cookie, {
    action: "SAVE_INVESTIGATION",
    immediateCause: "Desalineación residual del acoplamiento.",
    rootCause: "La pauta de alineación no incluía verificación bajo carga.",
    whys: [
      {
        question: "¿Por qué apareció la vibración?",
        answer: "El acoplamiento trabajaba desalineado bajo carga.",
      },
      {
        question: "¿Por qué no se detectó en la intervención?",
        answer: "La comprobación se realizó únicamente en vacío.",
      },
    ],
    version: 1,
  }),
  "Save RCA investigation",
);
await expectApiError(
  await postJson(rcaPath, cookie, {
    action: "SAVE_INVESTIGATION",
    immediateCause: "Actualización obsoleta.",
    rootCause: "No debe persistir.",
    whys: [],
    version: 1,
  }),
  409,
  "CONCURRENT_MODIFICATION",
);
await expectOkData(
  await postJson(rcaPath, cookie, {
    action: "ADD_EVIDENCE",
    kind: "MEASUREMENT",
    description: "Lectura de vibración axial reproducible bajo carga nominal.",
    sourceReference: converted.number,
  }),
  "Add RCA evidence",
);
const correctiveAction = await expectOkData(
  await postJson(rcaPath, cookie, {
    action: "CREATE_ACTION",
    title: "Verificar alineación dinámica de LM-01",
    description:
      "Repetir alineación con comprobación en vacío y bajo carga nominal.",
    actionType: "CREATE_WORK_ORDER",
    ownerId: "user-supervisor-mech",
    targetAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    maintenancePlanId: null,
    version: 2,
  }),
  "Create RCA corrective action",
);
assert(correctiveAction.actionId, "RCA action omitted its identity.");
assert(
  correctiveAction.workOrderNumber,
  "RCA corrective action did not generate its work order.",
);
await expectOkData(
  await postJson(rcaPath, cookie, {
    action: "CHANGE_STATUS",
    status: "VERIFICATION",
    version: 3,
  }),
  "Move RCA to verification",
);
await expectApiError(
  await postJson(rcaPath, cookie, {
    action: "CHANGE_STATUS",
    status: "CLOSED",
    version: 4,
  }),
  409,
  "RCA_CLOSURE_INCOMPLETE",
);
await expectOkData(
  await postJson(rcaPath, cookie, {
    action: "COMPLETE_ACTION",
    actionId: correctiveAction.actionId,
  }),
  "Complete RCA action",
);
await expectOkData(
  await postJson(rcaPath, cookie, {
    action: "CHANGE_STATUS",
    status: "CLOSED",
    version: 4,
  }),
  "Close RCA",
);
await expectApiError(
  await postJson(rcaPath, cookie, {
    action: "CHANGE_STATUS",
    status: "INVESTIGATING",
    version: 5,
  }),
  409,
  "INVALID_RCA_TRANSITION",
);

for (const [route, expected] of [
  [`/reliability/rca/${encodeURIComponent(rca.number)}`, "En verificación"],
  [
    `/work-orders/${encodeURIComponent(correctiveAction.workOrderNumber)}`,
    rca.number,
  ],
  ["/assets/LM-01-DRV", "Por qué el health"],
  ["/overview", "Fiabilidad que requiere decisión"],
]) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { cookie } });
  assert(response.ok, `${route} failed after reliability workflow.`);
  const body = await response.text();
  const pageExpected = route.includes("/reliability/rca/")
    ? "Cerrada"
    : expected;
  assert(
    body.includes(pageExpected),
    `${route} did not expose ${pageExpected}.`,
  );
}
const healthAfterRca = await (await fetch(`${baseUrl}/api/health`)).json();
assert(
  healthAfterRca.reliabilityAuditEntries > healthData.reliabilityAuditEntries,
  "RCA workflow did not generate audit entries.",
);
assert(
  healthAfterRca.reliabilityInvariantViolations === 0,
  "RCA workflow left an invalid terminal/action state.",
);
console.log(`✓ V1C flow ${rca.number} → ${correctiveAction.workOrderNumber}`);

const procurementRequisition = await expectOkData(
  await postJson("/api/procurement/requisitions", cookie, {
    partId: "part-001",
    quantity: 6,
    warehouseId: "warehouse-lev-mro",
    workOrderNumber: "OT-LEV-2026-0185",
    origin: "WORK_ORDER",
    urgency: "CRITICAL",
    needBy: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    justification:
      "Stock insuficiente para reanudar la intervención correctiva vinculada.",
    submit: true,
  }),
  "Create work-order requisition",
);
assert(
  procurementRequisition.number &&
    procurementRequisition.status === "SUBMITTED",
  "Procurement requisition was not submitted.",
);
await expectApiError(
  await postJson("/api/procurement/requisitions", cookie, {
    partId: "part-001",
    quantity: 6,
    warehouseId: "warehouse-lev-mro",
    workOrderNumber: "OT-LEV-2026-0185",
    origin: "WORK_ORDER",
    urgency: "CRITICAL",
    justification:
      "La misma necesidad no debe duplicarse mientras siga abierta.",
    submit: true,
  }),
  409,
  "OPEN_REQUISITION_EXISTS",
);
const requisitionPath = `/api/procurement/requisitions/${encodeURIComponent(procurementRequisition.number)}`;
await expectOkData(
  await postJson(`${requisitionPath}/actions`, cookie, {
    action: "APPROVE",
    version: 1,
  }),
  "Approve purchase requisition",
);
const purchaseOrder = await expectOkData(
  await postJson(`${requisitionPath}/convert`, cookie, {
    vendorId: "vendor-motionex",
    offerId: "offer-primary-part-001",
    warehouseId: "warehouse-lev-mro",
    destinationBinId: "bin-lev-01",
    expectedAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    taxRate: 21,
    version: 2,
  }),
  "Convert requisition to purchase order",
);
assert(
  purchaseOrder.number && purchaseOrder.lines?.length === 1,
  "Purchase-order conversion omitted its line contract.",
);
await expectApiError(
  await postJson(`${requisitionPath}/convert`, cookie, {
    vendorId: "vendor-motionex",
    version: 2,
  }),
  409,
  "REQUISITION_NOT_APPROVED",
);
const purchaseOrderPath = `/api/procurement/purchase-orders/${encodeURIComponent(purchaseOrder.number)}`;
await expectOkData(
  await postJson(`${purchaseOrderPath}/actions`, cookie, {
    action: "APPROVE",
    version: 1,
  }),
  "Approve purchase order",
);
await expectOkData(
  await postJson(`${purchaseOrderPath}/actions`, cookie, {
    action: "SEND",
    version: 2,
  }),
  "Send purchase order",
);

const purchaseOrderLine = purchaseOrder.lines[0];
const firstReceiptPayload = {
  idempotencyKey: `smoke-receipt-${purchaseOrder.id}-1`,
  externalReference: "ALB-SMOKE-1",
  version: 3,
  lines: [{ lineId: purchaseOrderLine.id, quantity: 2 }],
};
const firstReceipt = await expectOkData(
  await postJson(`${purchaseOrderPath}/receipts`, cookie, firstReceiptPayload),
  "Post partial goods receipt",
);
assert(firstReceipt.created === true, "Partial receipt was not created.");
const repeatedReceipt = await expectOkData(
  await postJson(`${purchaseOrderPath}/receipts`, cookie, firstReceiptPayload),
  "Retry partial goods receipt",
);
assert(
  repeatedReceipt.created === false && repeatedReceipt.id === firstReceipt.id,
  "Goods-receipt idempotency did not return the original receipt.",
);
await expectApiError(
  await postJson(`${purchaseOrderPath}/receipts`, cookie, {
    idempotencyKey: `smoke-receipt-${purchaseOrder.id}-over`,
    version: 4,
    lines: [{ lineId: purchaseOrderLine.id, quantity: 5 }],
  }),
  409,
  "OVER_RECEIPT",
);
await expectOkData(
  await postJson(`${purchaseOrderPath}/receipts`, cookie, {
    idempotencyKey: `smoke-receipt-${purchaseOrder.id}-2`,
    externalReference: "ALB-SMOKE-2",
    version: 4,
    lines: [{ lineId: purchaseOrderLine.id, quantity: 4 }],
  }),
  "Complete goods receipt",
);

const cancellationRequisition = await expectOkData(
  await postJson("/api/procurement/requisitions", cookie, {
    partId: "part-001",
    quantity: 1,
    warehouseId: "warehouse-lev-mro",
    origin: "MANUAL",
    urgency: "ROUTINE",
    justification: "Pedido control para validar la cancelación sin recepción.",
    submit: true,
  }),
  "Create cancellation control requisition",
);
const cancellationRequisitionPath = `/api/procurement/requisitions/${encodeURIComponent(cancellationRequisition.number)}`;
await expectOkData(
  await postJson(`${cancellationRequisitionPath}/actions`, cookie, {
    action: "APPROVE",
    version: 1,
  }),
  "Approve cancellation control requisition",
);
const cancelledOrder = await expectOkData(
  await postJson(`${cancellationRequisitionPath}/convert`, cookie, {
    vendorId: "vendor-motionex",
    offerId: "offer-primary-part-001",
    warehouseId: "warehouse-lev-mro",
    destinationBinId: "bin-lev-01",
    version: 2,
  }),
  "Convert cancellation control requisition",
);
const cancelledOrderPath = `/api/procurement/purchase-orders/${encodeURIComponent(cancelledOrder.number)}`;
await expectOkData(
  await postJson(`${cancelledOrderPath}/actions`, cookie, {
    action: "APPROVE",
    version: 1,
  }),
  "Approve cancellation control order",
);
await expectOkData(
  await postJson(`${cancelledOrderPath}/actions`, cookie, {
    action: "SEND",
    version: 2,
  }),
  "Send cancellation control order",
);
await expectOkData(
  await postJson(`${cancelledOrderPath}/actions`, cookie, {
    action: "CANCEL",
    version: 3,
  }),
  "Cancel sent purchase order",
);
await expectApiError(
  await postJson(`${cancelledOrderPath}/receipts`, cookie, {
    idempotencyKey: `smoke-receipt-${cancelledOrder.id}`,
    version: 4,
    lines: [{ lineId: cancelledOrder.lines[0].id, quantity: 1 }],
  }),
  409,
  "PURCHASE_ORDER_NOT_RECEIVABLE",
);

const waitingWorkOrderPath = "/api/work-orders/OT-LEV-2026-0185";
const receivedMaterial = await expectOkData(
  await postJson(`${waitingWorkOrderPath}/materials`, cookie, {
    action: "ADD_PLANNED",
    partId: "part-001",
    quantity: 2,
  }),
  "Add received material to waiting work order",
);
await expectOkData(
  await postJson(`${waitingWorkOrderPath}/materials`, cookie, {
    action: "RESERVE",
    materialId: receivedMaterial.materialId,
    quantity: 2,
  }),
  "Reserve received material",
);
await expectOkData(
  await postJson(`${waitingWorkOrderPath}/actions`, cookie, {
    action: "ASSIGN",
    technicianId: "user-supervisor-mech",
  }),
  "Assign available technician after supply",
);
const supplyResume = await expectOkData(
  await postJson(`${waitingWorkOrderPath}/actions`, cookie, {
    action: "RESUME",
    technicianId: "user-supervisor-mech",
  }),
  "Resume work order after supply",
);
await expectOkData(
  await postJson(`${waitingWorkOrderPath}/actions`, cookie, {
    action: "STOP_SESSION",
    laborSessionId: supplyResume.laborSessionId,
  }),
  "Stop resumed supply-validation session",
);

const transfer = await expectOkData(
  await postJson("/api/procurement/transfers", cookie, {
    partId: "part-001",
    fromBinId: "bin-lev-01",
    toBinId: "bin-lev-line-2",
    quantity: 1,
    note: "Reposición de punto de uso durante smoke V1D.",
  }),
  "Create internal stock transfer",
);
const transferPath = `/api/procurement/transfers/${encodeURIComponent(transfer.number)}`;
await expectOkData(
  await postJson(`${transferPath}/actions`, cookie, {
    action: "DISPATCH",
    version: 1,
  }),
  "Dispatch internal transfer",
);
await expectOkData(
  await postJson(`${transferPath}/actions`, cookie, {
    action: "RECEIVE",
    version: 2,
  }),
  "Receive internal transfer",
);

const lineWarehouseRequisition = await expectOkData(
  await postJson("/api/procurement/requisitions", cookie, {
    partId: "part-001",
    quantity: 1,
    warehouseId: "warehouse-lev-line",
    origin: "MANUAL",
    urgency: "ROUTINE",
    justification:
      "Caso centinela para validar el scope de lectura de almacén.",
    submit: true,
  }),
  "Create out-of-scope warehouse requisition sentinel",
);
const lineWarehouseRequisitionPath = `/api/procurement/requisitions/${encodeURIComponent(lineWarehouseRequisition.number)}`;
await expectOkData(
  await postJson(`${lineWarehouseRequisitionPath}/actions`, cookie, {
    action: "APPROVE",
    version: 1,
  }),
  "Approve out-of-scope warehouse requisition sentinel",
);
const lineWarehouseOrder = await expectOkData(
  await postJson(`${lineWarehouseRequisitionPath}/convert`, cookie, {
    vendorId: "vendor-motionex",
    offerId: "offer-primary-part-001",
    warehouseId: "warehouse-lev-line",
    destinationBinId: "bin-lev-line-1",
    expectedAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    taxRate: 21,
    version: 2,
  }),
  "Convert out-of-scope warehouse requisition sentinel",
);

for (const [route, expected] of [
  ["/procurement", "Supply operativo"],
  [
    `/procurement/requisitions/${encodeURIComponent(procurementRequisition.number)}`,
    "Aprobada",
  ],
  [
    `/procurement/purchase-orders/${encodeURIComponent(purchaseOrder.number)}`,
    "Recibido",
  ],
  ["/work-orders/OT-LEV-2026-0185", procurementRequisition.number],
  ["/inventory?part=part-001", "MEC-ROD-001"],
  ["/overview", "Supply operativo"],
]) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { cookie } });
  assert(response.ok, `${route} failed after procurement workflow.`);
  assert(
    (await response.text()).includes(expected),
    `${route} did not expose ${expected}.`,
  );
}
const healthAfterProcurement = await (
  await fetch(`${baseUrl}/api/health`)
).json();
assert(
  healthAfterProcurement.procurementAuditEntries >
    healthData.procurementAuditEntries,
  "Procurement workflow did not generate audit entries.",
);
for (const field of [
  "foreignKeyViolations",
  "stockInvariantViolations",
  "procurementInvariantViolations",
  "onOrderInvariantViolations",
  "transferInvariantViolations",
]) {
  assert(
    healthAfterProcurement[field] === 0,
    `${field} failed after V1D flow.`,
  );
}
console.log(
  `✓ V1D flow ${procurementRequisition.number} → ${purchaseOrder.number} → ${transfer.number}`,
);

const technicianLogin = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify({
    email: "tecnico4@mazmi.demo",
    password: credentials.password,
  }),
});
assert(technicianLogin.ok, "Technician login failed.");
const technicianCookie = technicianLogin.headers
  .get("set-cookie")
  ?.split(";")[0];
assert(technicianCookie, "Technician login omitted session cookie.");

const outOfAreaAsset = await fetch(`${baseUrl}/assets/PR-01-DRY`, {
  headers: { cookie: technicianCookie },
});
assert(
  outOfAreaAsset.status === 404,
  `Area-scoped technician accessed Printing (${outOfAreaAsset.status}).`,
);

for (const [route, expected] of [
  ["/my-work", "OT-LEV-2026-0390"],
  ["/my-work/OT-LEV-2026-0390", "Checklist de trabajo"],
  ["/scan", "Identifica el activo"],
  ["/scan/MZ-LEV-LM-02-APP", "rodillo aplicador"],
]) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { cookie: technicianCookie },
  });
  assert(response.ok, `${route} failed for technician.`);
  assert(
    (await response.text()).includes(expected),
    `${route} did not expose ${expected}.`,
  );
}

const fieldWorkPath = "/api/work-orders/OT-LEV-2026-0390";
await expectApiError(
  await postJson(`${fieldWorkPath}/actions`, technicianCookie, {
    action: "START",
  }),
  409,
  "SAFETY_ACK_REQUIRED",
);
await expectOkData(
  await postJson(
    "/api/field/work-orders/OT-LEV-2026-0390/safety",
    technicianCookie,
    {},
  ),
  "Acknowledge field safety",
);
const fieldStart = await expectOkData(
  await postJson(`${fieldWorkPath}/actions`, technicianCookie, {
    action: "START",
  }),
  "Start assigned field work",
);
assert(
  fieldStart.laborSessionId,
  "Field start did not create a labor session.",
);

const checklistPath = "/api/field/work-orders/OT-LEV-2026-0390/checklist";
for (const response of [
  { taskId: "wo-v2a-pm-v2a-task-1", value: true },
  { taskId: "wo-v2a-pm-v2a-task-2", value: "PASS" },
  {
    taskId: "wo-v2a-pm-v2a-task-5",
    value:
      "Guarda, fijaciones y superficie del rodillo sin desviaciones visibles.",
  },
]) {
  await expectOkData(
    await postJson(checklistPath, technicianCookie, response),
    `Record checklist ${response.taskId}`,
  );
}
const measurementsPath = "/api/field/work-orders/OT-LEV-2026-0390/measurements";
const vibrationMeasurement = await expectOkData(
  await postJson(measurementsPath, technicianCookie, {
    taskId: "wo-v2a-pm-v2a-task-3",
    meterId: "meter-lm02-vibration",
    label: "Vibración lado operador",
    unit: "mm/s",
    value: 3.6,
    minimumValue: 0,
    maximumValue: 4.5,
    note: "Lectura estable tras diez minutos de régimen.",
  }),
  "Record linked vibration measurement",
);
assert(
  vibrationMeasurement.result === "IN_RANGE",
  "Vibration range evaluation failed.",
);
await expectApiError(
  await postJson(measurementsPath, technicianCookie, {
    taskId: "wo-v2a-pm-v2a-task-3",
    label: "Unidad incorrecta",
    unit: "bar",
    value: 3.7,
  }),
  409,
  "MEASUREMENT_UNIT_MISMATCH",
);
await expectOkData(
  await postJson(measurementsPath, technicianCookie, {
    taskId: "wo-v2a-pm-v2a-task-4",
    label: "Temperatura de apoyo",
    unit: "°C",
    value: 43,
    minimumValue: 15,
    maximumValue: 70,
  }),
  "Record checklist temperature",
);

const evidencePath = "/api/field/work-orders/OT-LEV-2026-0390/evidence";
await expectApiError(
  await postJson(evidencePath, technicianCookie, {
    kind: "DOCUMENT",
    stage: "BEFORE",
    description: "Adjunto HTML que la política debe rechazar.",
    fileName: "evidencia.html",
    contentType: "text/html",
    dataBase64: "PGh0bWw+PC9odG1sPg==",
  }),
  409,
  "EVIDENCE_TYPE_NOT_ALLOWED",
);
await expectApiError(
  await postJson(evidencePath, technicianCookie, {
    kind: "PHOTO",
    stage: "BEFORE",
    description: "Contenido HTML declarado falsamente como imagen.",
    fileName: "evidencia.png",
    contentType: "image/png",
    dataBase64: "PGh0bWw+PC9odG1sPg==",
  }),
  409,
  "EVIDENCE_CONTENT_MISMATCH",
);
const idempotencyKey = `field_note_${crypto.randomUUID()}`;
const idempotentEvidenceBody = {
  kind: "NOTE",
  stage: "BEFORE",
  description: "Nota durable creada una sola vez aunque se reintente.",
};
const firstEvidenceResponse = await postJsonIdempotent(
  evidencePath,
  technicianCookie,
  idempotentEvidenceBody,
  idempotencyKey,
);
const firstEvidencePayload = await firstEvidenceResponse.json();
assert(
  firstEvidenceResponse.status === 201,
  "Initial offline-safe write failed.",
);
assert(firstEvidencePayload.replayed === false, "Initial write was replayed.");
const replayEvidenceResponse = await postJsonIdempotent(
  evidencePath,
  technicianCookie,
  idempotentEvidenceBody,
  idempotencyKey,
);
const replayEvidencePayload = await replayEvidenceResponse.json();
assert(replayEvidenceResponse.status === 200, "Idempotent replay failed.");
assert(replayEvidencePayload.replayed === true, "Retry was not identified.");
assert(
  replayEvidencePayload.data.id === firstEvidencePayload.data.id,
  "Idempotent replay created a second evidence identity.",
);
for (const evidence of [
  {
    kind: "NOTE",
    stage: "BEFORE",
    description: "Consignación verificada antes de retirar la guarda.",
  },
  {
    kind: "NOTE",
    stage: "DURING",
    description: "No se observan holguras en las fijaciones.",
  },
  {
    kind: "NOTE",
    stage: "AFTER",
    description: "Guarda instalada y zona liberada tras la prueba.",
  },
]) {
  await expectOkData(
    await postJson(evidencePath, technicianCookie, evidence),
    `Add ${evidence.stage} evidence`,
  );
}
const photoEvidence = await expectOkData(
  await postJson(evidencePath, technicianCookie, {
    kind: "PHOTO",
    stage: "AFTER",
    description: "Estado final de la guarda del rodillo aplicador.",
    fileName: "guarda-lm02.png",
    contentType: "image/png",
    dataBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
  }),
  "Store field photo evidence",
);
const photoContent = await fetch(
  `${baseUrl}/api/field/evidence/${photoEvidence.id}/content`,
  { headers: { cookie: technicianCookie } },
);
assert(photoContent.ok, "Stored field evidence could not be retrieved.");
assert(
  photoContent.headers.get("x-content-type-options") === "nosniff",
  "Evidence content omitted MIME-sniffing protection.",
);
const unauthenticatedEvidence = await fetch(
  `${baseUrl}/api/field/evidence/${photoEvidence.id}/content`,
);
assert(
  unauthenticatedEvidence.status === 401,
  `Unauthenticated evidence returned ${unauthenticatedEvidence.status}.`,
);

await expectOkData(
  await postJson(`${fieldWorkPath}/materials`, technicianCookie, {
    action: "CONSUME",
    materialId: "material-v2a-field",
    quantity: 1,
  }),
  "Consume field material",
);
const fieldDowntime = await expectOkData(
  await postJson(`${fieldWorkPath}/downtime`, technicianCookie, {
    action: "START",
    kind: "PLANNED",
    productionImpact: "NO_IMPACT",
    cause: "Ventana preventiva coordinada con producción.",
  }),
  "Start field downtime",
);

const quickIncident = await expectOkData(
  await postJson("/api/incidents", technicianCookie, {
    functionalLocationId: "loc-lev-lm-02",
    assetId: "asset-lm-02-app",
    title: "Marca superficial detectada en apoyo LM-02",
    description:
      "Se registra para seguimiento visual en la siguiente ronda preventiva.",
    severity: "LOW",
    initialImpact: "NO_IMPACT",
    origin: "MAINTENANCE",
  }),
  "Report quick field incident",
);
assert(quickIncident.number, "Quick incident omitted its identity.");

await expectApiError(
  await postJson(`${fieldWorkPath}/actions`, technicianCookie, {
    action: "COMPLETE",
    diagnosis: "Inspección preventiva completada.",
    solution: "Condición verificada y registro actualizado.",
  }),
  409,
  "ACTIVE_LABOR_SESSION",
);
await expectOkData(
  await postJson(`${fieldWorkPath}/actions`, technicianCookie, {
    action: "STOP_SESSION",
    laborSessionId: fieldStart.laborSessionId,
  }),
  "Stop field labor session",
);
await expectApiError(
  await postJson(`${fieldWorkPath}/actions`, technicianCookie, {
    action: "COMPLETE",
    diagnosis: "Inspección preventiva completada.",
    solution: "Condición verificada y registro actualizado.",
  }),
  409,
  "ACTIVE_DOWNTIME",
);
await expectOkData(
  await postJson(`${fieldWorkPath}/downtime`, technicianCookie, {
    action: "END",
    downtimeId: fieldDowntime.id,
  }),
  "End field downtime",
);
await expectOkData(
  await postJson("/api/field/handovers", technicianCookie, {
    fromShift: "M1",
    toShift: "T1",
    summary:
      "Inspección LM-02 finalizada; queda pendiente observar la marca superficial.",
    risks: "Sin riesgos activos; mantener seguimiento visual.",
    partsPending: null,
    workOrderNumbers: ["OT-LEV-2026-0390"],
  }),
  "Create technician handover",
);
await expectOkData(
  await postJson(`${fieldWorkPath}/actions`, technicianCookie, {
    action: "COMPLETE",
    diagnosis: "Condición del rodillo y fijaciones dentro de criterio.",
    solution: "Inspección, medición y montaje final verificados.",
  }),
  "Complete field work",
);
await expectApiError(
  await postJson(`${fieldWorkPath}/actions`, technicianCookie, {
    action: "CLOSE",
  }),
  403,
  "FORBIDDEN_OPERATION",
);
await expectOkData(
  await postJson(`${fieldWorkPath}/actions`, cookie, { action: "CLOSE" }),
  "Manager closes field work",
);

for (const [route, expected] of [
  ["/work-orders/OT-LEV-2026-0390", "Mediciones y evidencias"],
  ["/assets/LM-02-APP", "Trazabilidad de campo"],
  [
    `/incidents/${encodeURIComponent(quickIncident.number)}`,
    "Marca superficial",
  ],
  ["/planner?week=2026-09-07", "Planner de mantenimiento"],
]) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { cookie } });
  assert(response.ok, `${route} failed after field workflow.`);
  const body = await response.text();
  assert(body.includes(expected), `${route} did not expose ${expected}.`);
}
const healthAfterField = await (await fetch(`${baseUrl}/api/health`)).json();
for (const field of [
  "foreignKeyViolations",
  "stockInvariantViolations",
  "fieldInvariantViolations",
  "assetsWithoutScanCode",
]) {
  assert(healthAfterField[field] === 0, `${field} failed after V2A flow.`);
}
assert(
  healthAfterField.workOrderMeasurements > healthData.workOrderMeasurements,
  "Field workflow did not persist measurements.",
);
assert(
  healthAfterField.fieldEvidenceItems > healthData.fieldEvidenceItems,
  "Field workflow did not persist evidence.",
);
console.log(`✓ V2A field flow OT-LEV-2026-0390 → ${quickIncident.number}`);

await expectApiError(
  await fetch(`${baseUrl}/api/session/site`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin },
    body: JSON.stringify({ siteId: "site-no-autorizado" }),
  }),
  403,
  "FORBIDDEN",
);

const switchToAlzira = await fetch(`${baseUrl}/api/session/site`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie, origin },
  body: JSON.stringify({ siteId: "site-alzira" }),
});
assert(switchToAlzira.ok, `Alzira switch failed with ${switchToAlzira.status}`);

await expectApiError(
  await postJsonIdempotent(
    "/api/incidents",
    cookie,
    {
      functionalLocationId: "loc-alz-sr-04",
      title: "Ensayo de aislamiento de idempotencia",
      description:
        "La respuesta de Levante no debe cruzar al centro de Alzira.",
      severity: "LOW",
      initialImpact: "NO_IMPACT",
      origin: "MAINTENANCE",
    },
    incidentIdempotencyKey,
  ),
  409,
  "IDEMPOTENCY_KEY_REUSED",
);

const alziraOverview = await fetch(`${baseUrl}/overview`, {
  headers: { cookie },
});
assert(alziraOverview.ok, "Alzira overview failed.");
const alziraBody = await alziraOverview.text();
assert(
  alziraBody.includes("Alzira"),
  "Alzira overview did not show its site context.",
);
assert(
  !alziraBody.includes("Riesgo alto en LM-02"),
  "Levante notification leaked into Alzira.",
);

const alziraSearch = await fetch(`${baseUrl}/api/search?q=LM-02`, {
  headers: { cookie },
});
assert(alziraSearch.ok, "Alzira search failed.");
assert(
  !(await alziraSearch.text()).includes("LM-02"),
  "Levante asset leaked into Alzira search.",
);
const outOfScopeEvidence = await fetch(
  `${baseUrl}/api/field/evidence/${photoEvidence.id}/content`,
  { headers: { cookie } },
);
assert(
  outOfScopeEvidence.status === 404,
  `Cross-site evidence returned ${outOfScopeEvidence.status}.`,
);

for (const outOfScopeRoute of [
  "/assets/LM-02-APP",
  "/work-orders/OT-LEV-2026-0184",
  `/incidents/${encodeURIComponent(incident.number)}`,
  `/maintenance-plans/${encodeURIComponent(preventivePlan.code)}`,
  `/work-orders/${encodeURIComponent(generatedPreventive.number)}`,
  `/reliability/rca/${encodeURIComponent(rca.number)}`,
  `/procurement/requisitions/${encodeURIComponent(procurementRequisition.number)}`,
  `/procurement/purchase-orders/${encodeURIComponent(purchaseOrder.number)}`,
  "/my-work/OT-LEV-2026-0390",
  "/scan/MZ-LEV-LM-02-APP",
]) {
  const response = await fetch(`${baseUrl}${outOfScopeRoute}`, {
    headers: { cookie },
  });
  assert(
    response.status === 404,
    `${outOfScopeRoute} should be out of scope in Alzira (${response.status}).`,
  );
}
await expectApiError(
  await postJson(
    `/api/maintenance-plans/${encodeURIComponent(preventivePlan.code)}/actions`,
    cookie,
    { action: "GENERATE" },
  ),
  404,
  "MAINTENANCE_PLAN_NOT_FOUND",
);

const alziraReliability = await fetch(`${baseUrl}/reliability`, {
  headers: { cookie },
});
assert(alziraReliability.ok, "Alzira Reliability Center failed.");
const alziraReliabilityBody = await alziraReliability.text();
assert(
  alziraReliabilityBody.includes("RCA-ALZ-2026-001"),
  "Alzira RCA was not visible in its site scope.",
);
assert(
  !alziraReliabilityBody.includes("RCA-LEV-2026-001"),
  "Levante RCA leaked into Alzira Reliability Center.",
);
const alziraProcurement = await fetch(`${baseUrl}/procurement`, {
  headers: { cookie },
});
assert(alziraProcurement.ok, "Alzira Procurement failed.");
const alziraProcurementBody = await alziraProcurement.text();
assert(
  alziraProcurementBody.includes("PR-ALZ-2026-041"),
  "Alzira requisition was not visible in its site scope.",
);
assert(
  !alziraProcurementBody.includes(procurementRequisition.number) &&
    !alziraProcurementBody.includes(purchaseOrder.number),
  "Levante procurement data leaked into Alzira.",
);
await expectApiError(
  await postJson(`${purchaseOrderPath}/actions`, cookie, {
    action: "CANCEL",
    version: 5,
  }),
  404,
  "PURCHASE_ORDER_NOT_FOUND",
);

const switchToLevante = await fetch(`${baseUrl}/api/session/site`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie, origin },
  body: JSON.stringify({ siteId: "site-levante" }),
});
assert(
  switchToLevante.ok,
  `Levante switch failed with ${switchToLevante.status}`,
);

const viewerLogin = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify({
    email: "viewer@mazmi.demo",
    password: credentials.password,
  }),
});
assert(viewerLogin.ok, "Viewer login failed.");
const viewerCookie = viewerLogin.headers.get("set-cookie")?.split(";")[0];
assert(viewerCookie, "Viewer login omitted session cookie.");

const operatorLogin = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify({
    email: "operario@mazmi.demo",
    password: credentials.password,
  }),
});
assert(operatorLogin.ok, "Area-scoped operator login failed.");
const operatorCookie = operatorLogin.headers.get("set-cookie")?.split(";")[0];
assert(operatorCookie, "Area-scoped operator login omitted cookie.");
for (const restrictedPage of [
  "/maintenance-plans",
  "/maintenance-plans/PM-LEV-2026-003",
  "/planner",
  "/reliability",
  "/reliability/rca/RCA-LEV-2026-001",
  "/procurement",
  "/procurement/requisitions/PR-LEV-2026-048",
  "/procurement/purchase-orders/PO-LEV-2026-069",
  "/audit",
  "/governance",
]) {
  await expectPageRedirect(restrictedPage, operatorCookie);
}
const outOfAreaEvidence = await fetch(
  `${baseUrl}/api/field/evidence/${photoEvidence.id}/content`,
  { headers: { cookie: operatorCookie } },
);
assert(
  outOfAreaEvidence.status === 403,
  `Area-scoped user accessed evidence outside its area (${outOfAreaEvidence.status}).`,
);
await expectApiError(
  await postJson("/api/incidents", operatorCookie, {
    functionalLocationId: "loc-lev-lm-02",
    assetId: "asset-lm-02-app",
    title: "Incidencia fuera del área autorizada",
    description:
      "La API debe rechazar el contexto de laminación para impresión.",
    severity: "MEDIUM",
    initialImpact: "NO_IMPACT",
    origin: "OPERATOR",
  }),
  403,
  "AREA_SCOPE_DENIED",
);

const warehouseLogin = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify({
    email: "almacen@mazmi.demo",
    password: credentials.password,
  }),
});
assert(warehouseLogin.ok, "Warehouse-scoped user login failed.");
const warehouseCookie = warehouseLogin.headers.get("set-cookie")?.split(";")[0];
assert(warehouseCookie, "Warehouse-scoped user login omitted cookie.");
const warehouseInventory = await fetch(`${baseUrl}/inventory?part=part-001`, {
  headers: { cookie: warehouseCookie },
});
assert(warehouseInventory.ok, "Warehouse-scoped inventory failed.");
const warehouseInventoryBody = await warehouseInventory.text();
assert(
  warehouseInventoryBody.includes("Almacén MRO Levante"),
  "Allowed MRO warehouse was omitted from scoped inventory.",
);
assert(
  !warehouseInventoryBody.includes("Puntos MRO de línea"),
  "Inventory leaked a warehouse outside the user's scope.",
);
const warehouseProcurement = await fetch(`${baseUrl}/procurement`, {
  headers: { cookie: warehouseCookie },
});
assert(
  warehouseProcurement.ok,
  "Warehouse receiver could not access scoped procurement.",
);
await assertRenderedPage(
  warehouseProcurement,
  "/procurement (warehouse scoped)",
);
for (const outOfWarehouseRoute of [
  `/procurement/requisitions/${encodeURIComponent(lineWarehouseRequisition.number)}`,
  `/procurement/purchase-orders/${encodeURIComponent(lineWarehouseOrder.number)}`,
]) {
  const response = await fetch(`${baseUrl}${outOfWarehouseRoute}`, {
    headers: { cookie: warehouseCookie },
  });
  const body = await response.text();
  assert(
    response.status === 404 ||
      /:E\{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"/.test(
        body.replaceAll('\\"', '"'),
      ),
    `${outOfWarehouseRoute} did not render a scoped not-found response (${response.status}).`,
  );
  assert(
    !body.includes("Caso centinela para validar el scope de lectura"),
    `${outOfWarehouseRoute} exposed data outside warehouse scope.`,
  );
}
await expectApiError(
  await postJson("/api/procurement/requisitions", warehouseCookie, {
    partId: "part-017",
    quantity: 1,
    warehouseId: "warehouse-lev-line",
    origin: "MANUAL",
    urgency: "ROUTINE",
    justification: "Validación de aislamiento por almacén.",
    submit: true,
  }),
  403,
  "WAREHOUSE_SCOPE_DENIED",
);
await expectApiError(
  await postJson("/api/work-orders/OT-LEV-2026-0188/actions", viewerCookie, {
    action: "CHANGE_PRIORITY",
    priority: "P4_NORMAL",
  }),
  403,
  "FORBIDDEN_OPERATION",
);
await expectApiError(
  await postJson("/api/maintenance-plans", viewerCookie, {
    assetId: "asset-lm-01",
    ownerId: "user-planner",
    title: "Plan sin autorización",
    description: "La creación debe ser rechazada por permisos.",
    criticality: "LOW",
    priority: "P5_LOW",
    estimatedMinutes: 30,
    triggerMode: "CALENDAR",
    calendarUnit: "MONTH",
    calendarInterval: 1,
    firstDueAt: new Date().toISOString(),
    leadDays: 7,
    tasks: [{ title: "Tarea no autorizada" }],
    skills: [],
    certificationIds: [],
    materials: [],
  }),
  403,
  "FORBIDDEN_OPERATION",
);
await expectApiError(
  await postJson("/api/reliability/rca", viewerCookie, {
    assetId: "asset-lm-01",
    ownerId: "user-reliability",
    problem: "Investigación que no debe autorizarse para el rol viewer.",
    impact: "Sin autorización de ingeniería.",
  }),
  403,
  "FORBIDDEN_OPERATION",
);
await expectApiError(
  await postJson("/api/procurement/requisitions", viewerCookie, {
    partId: "part-001",
    quantity: 1,
    origin: "MANUAL",
    urgency: "ROUTINE",
    justification: "Una persona viewer no puede crear esta requisición.",
    submit: true,
  }),
  403,
  "FORBIDDEN_OPERATION",
);

const viewerReports = await fetch(`${baseUrl}/reports`, {
  headers: { cookie: viewerCookie },
});
assert(viewerReports.ok, "Viewer could not access governed reporting.");
await expectApiError(
  await fetch(`${baseUrl}/api/reports/export`, {
    headers: { cookie: viewerCookie },
  }),
  403,
  "EXPORT_FORBIDDEN",
);

const reportExport = await fetch(
  `${baseUrl}/api/reports/export?from=2026-01-01&to=2026-12-31`,
  { headers: { cookie } },
);
assert(reportExport.ok, "Manager reporting export failed.");
assert(
  (reportExport.headers.get("content-type") ?? "").includes("text/csv"),
  "Reporting export did not return CSV.",
);
const reportCsv = await reportExport.text();
assert(
  reportCsv.includes('"Activo"'),
  "Reporting CSV omitted its governed schema.",
);
assert(!reportCsv.includes("ALZ-"), "Alzira data leaked into Levante export.");

const auditPage = await fetch(`${baseUrl}/audit?action=ACCESS_DENIED`, {
  headers: { cookie },
});
assert(auditPage.ok, "Audit investigation view failed.");
assert(
  (await auditPage.text()).includes("ACCESS DENIED"),
  "Denied API actions were not written to the audit trail.",
);

for (let attempt = 0; attempt < 5; attempt += 1) {
  await expectApiError(
    await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email: "admin@mazmi.demo",
        password: "Credencial-Incorrecta",
      }),
    }),
    401,
    "INVALID_CREDENTIALS",
  );
}
await expectApiError(
  await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: "admin@mazmi.demo",
      password: credentials.password,
    }),
  }),
  401,
  "INVALID_CREDENTIALS",
);
const lockoutAudit = await fetch(`${baseUrl}/audit?action=LOGIN_LOCKOUT`, {
  headers: { cookie },
});
const lockoutAuditBody = await lockoutAudit.text();
assert(lockoutAudit.ok, "Login lockout audit view failed.");
assert(lockoutAuditBody.includes("LOGIN LOCKOUT"), "Lockout was not audited.");
assert(
  !lockoutAuditBody.includes("Credencial-Incorrecta"),
  "Audit trail exposed a failed password.",
);

const fixationLogin = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie, origin },
  body: JSON.stringify(credentials),
});
assert(fixationLogin.ok, "Session rotation login failed.");
const rotatedCookie = fixationLogin.headers.get("set-cookie")?.split(";")[0];
assert(rotatedCookie, "Session rotation omitted its cookie.");
await expectApiError(
  await fetch(`${baseUrl}/api/search?q=LM-02`, { headers: { cookie } }),
  401,
  "UNAUTHORIZED",
);

const logout = await fetch(`${baseUrl}/api/auth/logout`, {
  method: "POST",
  headers: { cookie: rotatedCookie, origin },
});
assert(logout.ok, `Logout failed with ${logout.status}`);
await expectApiError(
  await fetch(`${baseUrl}/api/search?q=LM-02`, {
    headers: { cookie: rotatedCookie },
  }),
  401,
  "UNAUTHORIZED",
);

console.log("✓ auth/API negative paths");
console.log("✓ Levante ↔ Alzira scope isolation");
console.log("Mazmi Factory smoke test passed.");
