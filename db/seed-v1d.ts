type SqlValue = string | number | null;
type Operation = { sql: string; params: SqlValue[] };

const ORGANIZATION_ID = "org-mazmi-flexpack";
const LEVANTE_ID = "site-levante";
const ALZIRA_ID = "site-alzira";
const ANCHOR = new Date("2026-09-06T06:00:00.000Z");
const NOW = ANCHOR.toISOString();

function at(dayOffset: number, hour = 8, minute = 0): string {
  const date = new Date(ANCHOR);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

function insert(
  table: string,
  columns: string[],
  values: SqlValue[],
): Operation {
  return {
    sql: `INSERT OR IGNORE INTO ${table} (${columns.join(",")}) VALUES (${values.map(() => "?").join(",")})`,
    params: values,
  };
}

async function executeInChunks(
  db: D1Database,
  operations: Operation[],
  size = 50,
): Promise<void> {
  for (let offset = 0; offset < operations.length; offset += size) {
    const chunk = operations.slice(offset, offset + size);
    try {
      await db.batch(
        chunk.map((operation) =>
          db.prepare(operation.sql).bind(...operation.params),
        ),
      );
    } catch (error) {
      throw new Error(
        `V1D seed failed in operation chunk ${offset}-${offset + chunk.length - 1}: ${chunk[0]?.sql}.`,
        { cause: error },
      );
    }
  }
}

async function repairV1DOnOrderBinProjection(db: D1Database): Promise<void> {
  const repairKey = "demo_seed_v1d_on_order_bins_1";
  const repaired = await db
    .prepare("SELECT value FROM system_state WHERE key = ?")
    .bind(repairKey)
    .first<{ value: string }>();
  if (repaired?.value === "complete") return;

  const mismatches = await db
    .prepare(
      `WITH expected AS (
         SELECT line.part_id, purchase_order.site_id,
           purchase_order.destination_bin_id AS bin_id,
           SUM(line.ordered_quantity - line.received_quantity) AS quantity
         FROM purchase_order_lines line
         INNER JOIN purchase_orders purchase_order
           ON purchase_order.id = line.purchase_order_id
         WHERE purchase_order.status IN ('SENT','PARTIALLY_RECEIVED')
         GROUP BY line.part_id, purchase_order.site_id,
           purchase_order.destination_bin_id
       ), projection_keys AS (
         SELECT part_id, site_id, bin_id FROM expected
         UNION
         SELECT part_id, site_id, bin_id FROM stock_levels WHERE on_order <> 0
       )
       SELECT projection_keys.part_id AS partId,
         projection_keys.site_id AS siteId,
         projection_keys.bin_id AS binId,
         stock.id AS stockId,
         part.organization_id AS organizationId,
         part.standard_cost AS unitCost,
         COALESCE(stock.on_order, 0) AS currentQuantity,
         COALESCE(expected.quantity, 0) AS expectedQuantity
       FROM projection_keys
       INNER JOIN parts part ON part.id = projection_keys.part_id
       LEFT JOIN stock_levels stock
         ON stock.part_id = projection_keys.part_id
        AND stock.site_id = projection_keys.site_id
        AND stock.bin_id = projection_keys.bin_id
       LEFT JOIN expected
         ON expected.part_id = projection_keys.part_id
        AND expected.site_id = projection_keys.site_id
        AND expected.bin_id = projection_keys.bin_id
       WHERE ABS(COALESCE(stock.on_order, 0) - COALESCE(expected.quantity, 0)) > 0.0001
       ORDER BY projection_keys.site_id, projection_keys.part_id,
         projection_keys.bin_id`,
    )
    .all<{
      partId: string;
      siteId: string;
      binId: string;
      stockId: string | null;
      organizationId: string;
      unitCost: number;
      currentQuantity: number;
      expectedQuantity: number;
    }>();

  const repairedAt = new Date().toISOString();
  const operations: Operation[] = [];
  for (const row of mismatches.results ?? []) {
    const delta = Number(row.expectedQuantity) - Number(row.currentQuantity);
    const stockId =
      row.stockId ?? `stock-v1d-repair-${row.partId}-${row.binId}`;
    if (!row.stockId) {
      operations.push({
        sql: `INSERT OR IGNORE INTO stock_levels
          (id, part_id, site_id, bin_id, on_hand, reserved, on_order, version, updated_at)
          VALUES (?, ?, ?, ?, 0, 0, 0, 1, ?)`,
        params: [stockId, row.partId, row.siteId, row.binId, repairedAt],
      });
    }
    operations.push(
      {
        sql: `UPDATE stock_levels SET on_order = ?, version = version + 1,
          updated_at = ? WHERE part_id = ? AND site_id = ? AND bin_id = ?`,
        params: [
          Number(row.expectedQuantity),
          repairedAt,
          row.partId,
          row.siteId,
          row.binId,
        ],
      },
      {
        sql: `INSERT OR IGNORE INTO inventory_movements
          (id, organization_id, site_id, part_id, bin_id, work_order_id,
           purchase_order_id, goods_receipt_id, stock_transfer_id, actor_id,
           movement_type, reference, reason, delta_on_hand, delta_reserved,
           delta_on_order, unit_cost, occurred_at, created_at)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'user-warehouse',
            'ORDER', 'SEED-REPAIR-V1D-001',
            'Reconciliación de pedido pendiente con ubicación de destino',
            0, 0, ?, ?, ?, ?)`,
        params: [
          `movement-v1d-on-order-repair-${row.partId}-${row.binId}`,
          row.organizationId,
          row.siteId,
          row.partId,
          row.binId,
          delta,
          Number(row.unitCost),
          repairedAt,
          repairedAt,
        ],
      },
    );
  }
  operations.push({
    sql: "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, 'complete', ?)",
    params: [repairKey, repairedAt],
  });
  await executeInChunks(db, operations);
}

export async function seedV1DDatabase(db: D1Database): Promise<void> {
  const seeded = await db
    .prepare("SELECT value FROM system_state WHERE key = 'demo_seed_v1d_1'")
    .first<{ value: string }>();
  if (seeded?.value === "complete") {
    await repairV1DOnOrderBinProjection(db);
    return;
  }

  const operations: Operation[] = [];
  const vendorProfiles = [
    [
      "vendor-motionex",
      "Marta Soler",
      "Parque Empresarial Táctica, Paterna",
      "NET30",
    ],
    [
      "vendor-rodatec",
      "Jordi Ferrer",
      "Polígono Fuente del Jarro, Paterna",
      "NET45",
    ],
    ["vendor-electrolev", "Álex Martí", "C/ dels Gremis, Valencia", "NET30"],
    [
      "vendor-aerotec",
      "Nuria Alba",
      "Parque Industrial Rey Juan Carlos I, Almussafes",
      "NET30",
    ],
    [
      "vendor-filtramec",
      "Clara Puig",
      "Polígono El Oliveral, Riba-roja",
      "NET60",
    ],
    ["vendor-sensora", "Iván Costa", "C/ de la Tecnología, Valencia", "NET30"],
    [
      "vendor-quimitec",
      "Teresa Blasco",
      "Polígono Industrial Norte, Sagunto",
      "NET45",
    ],
    [
      "vendor-pneumatik",
      "Pau Vidal",
      "Parque Empresarial, Quart de Poblet",
      "NET30",
    ],
    [
      "vendor-fixingpro",
      "Rosa León",
      "Polígono Vara de Quart, Valencia",
      "NET30",
    ],
  ] as const;
  for (const [id, contact, address, payment] of vendorProfiles) {
    operations.push({
      sql: "UPDATE vendors SET contact_name = ?, address = ?, payment_terms = ?, currency = 'EUR', updated_at = ? WHERE id = ?",
      params: [contact, address, payment, NOW, id],
    });
  }

  operations.push(
    insert(
      "warehouses",
      [
        "id",
        "organization_id",
        "site_id",
        "code",
        "name",
        "status",
        "created_at",
        "updated_at",
      ],
      [
        "warehouse-lev-line",
        ORGANIZATION_ID,
        LEVANTE_ID,
        "MRO-LINE",
        "Puntos MRO de línea",
        "ACTIVE",
        at(-80),
        NOW,
      ],
    ),
    insert(
      "warehouses",
      [
        "id",
        "organization_id",
        "site_id",
        "code",
        "name",
        "status",
        "created_at",
        "updated_at",
      ],
      [
        "warehouse-alz-mro",
        ORGANIZATION_ID,
        ALZIRA_ID,
        "MRO-ALZ",
        "Almacén técnico Alzira",
        "ACTIVE",
        at(-80),
        NOW,
      ],
    ),
  );
  const zones = [
    ["zone-lev-mech", "warehouse-lev-mro", "MEC", "Mecánica y transmisión"],
    ["zone-lev-elec", "warehouse-lev-mro", "ELEC", "Electricidad y control"],
    ["zone-lev-process", "warehouse-lev-mro", "PROC", "Proceso y fluidos"],
    ["zone-lev-line", "warehouse-lev-line", "LINE", "Supermercado de línea"],
    ["zone-alz-main", "warehouse-alz-mro", "MAIN", "Material técnico"],
  ] as const;
  for (const [id, warehouseId, code, name] of zones) {
    operations.push(
      insert(
        "warehouse_zones",
        ["id", "warehouse_id", "code", "name", "status"],
        [id, warehouseId, code, name, "ACTIVE"],
      ),
    );
  }
  for (let index = 1; index <= 24; index += 1) {
    const zoneId =
      index <= 8
        ? "zone-lev-mech"
        : index <= 16
          ? "zone-lev-elec"
          : "zone-lev-process";
    operations.push({
      sql: "UPDATE warehouse_bins SET zone_id = ? WHERE id = ?",
      params: [zoneId, `bin-lev-${String(index).padStart(2, "0")}`],
    });
  }
  for (let index = 1; index <= 4; index += 1) {
    operations.push(
      insert(
        "warehouse_bins",
        ["id", "warehouse_id", "zone_id", "code", "description", "status"],
        [
          `bin-lev-line-${index}`,
          "warehouse-lev-line",
          "zone-lev-line",
          `LINE-${String(index).padStart(2, "0")}`,
          `Punto de uso industrial ${index}`,
          "ACTIVE",
        ],
      ),
      insert(
        "warehouse_bins",
        ["id", "warehouse_id", "zone_id", "code", "description", "status"],
        [
          `bin-alz-${index}`,
          "warehouse-alz-mro",
          "zone-alz-main",
          `ALZ-A-01-${String(index).padStart(2, "0")}`,
          `Estantería técnica Alzira ${index}`,
          "ACTIVE",
        ],
      ),
    );
  }
  await executeInChunks(db, operations);
  operations.length = 0;

  const partRows = await db
    .prepare(
      `SELECT part.id, part.sku, part.name, part.manufacturer,
        part.standard_cost AS standardCost, policy.primary_vendor_id AS vendorId,
        policy.lead_time_days AS leadTimeDays
       FROM parts part INNER JOIN part_site_policies policy
         ON policy.part_id = part.id AND policy.site_id = ?
       WHERE part.organization_id = ? ORDER BY part.sku`,
    )
    .bind(LEVANTE_ID, ORGANIZATION_ID)
    .all<{
      id: string;
      sku: string;
      name: string;
      manufacturer: string | null;
      standardCost: number;
      vendorId: string;
      leadTimeDays: number;
    }>();
  const parts = partRows.results ?? [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    operations.push(
      insert(
        "part_vendor_offers",
        [
          "id",
          "organization_id",
          "part_id",
          "vendor_id",
          "vendor_sku",
          "manufacturer",
          "unit_price",
          "currency",
          "minimum_order_quantity",
          "lead_time_days",
          "preferred",
          "price_at",
          "valid_until",
          "status",
          "created_at",
          "updated_at",
        ],
        [
          `offer-primary-${part.id}`,
          ORGANIZATION_ID,
          part.id,
          part.vendorId,
          `${part.sku}-P`,
          part.manufacturer,
          Number(part.standardCost),
          "EUR",
          part.standardCost < 10 ? 5 : 1,
          part.leadTimeDays,
          1,
          at(-45),
          null,
          "ACTIVE",
          at(-45),
          NOW,
        ],
      ),
    );
    if (index < 24) {
      const alternativeVendor =
        parts[(index + 31) % parts.length]?.vendorId ?? part.vendorId;
      if (alternativeVendor !== part.vendorId) {
        operations.push(
          insert(
            "part_vendor_offers",
            [
              "id",
              "organization_id",
              "part_id",
              "vendor_id",
              "vendor_sku",
              "manufacturer",
              "unit_price",
              "currency",
              "minimum_order_quantity",
              "lead_time_days",
              "preferred",
              "price_at",
              "valid_until",
              "status",
              "created_at",
              "updated_at",
            ],
            [
              `offer-alt-${part.id}`,
              ORGANIZATION_ID,
              part.id,
              alternativeVendor,
              `${part.sku}-ALT`,
              part.manufacturer,
              Number((Number(part.standardCost) * 1.07).toFixed(2)),
              "EUR",
              2,
              part.leadTimeDays + 4,
              0,
              at(-21),
              null,
              "ACTIVE",
              at(-21),
              NOW,
            ],
          ),
        );
      }
    }
  }
  const substitutePairs = [
    [
      "part-001",
      "part-002",
      "Equivalente dimensional aprobado por Ingeniería.",
    ],
    [
      "part-003",
      "part-004",
      "Sustitución condicionada a verificación de juego.",
    ],
    ["part-024", "part-025", "Filtro alternativo validado para COMP-02."],
    ["part-045", "part-046", "Sensor equivalente con adaptador aprobado."],
    ["part-067", "part-068", "Bobina compatible con misma tensión de mando."],
  ] as const;
  for (const [partId, substituteId, note] of substitutePairs) {
    operations.push(
      insert(
        "part_substitutes",
        [
          "id",
          "organization_id",
          "part_id",
          "substitute_part_id",
          "approval_status",
          "note",
          "approved_by_id",
          "approved_at",
          "created_at",
          "updated_at",
        ],
        [
          `substitute-${partId}-${substituteId}`,
          ORGANIZATION_ID,
          partId,
          substituteId,
          "APPROVED",
          note,
          "user-reliability",
          at(-18),
          at(-18),
          NOW,
        ],
      ),
    );
  }
  operations.push({
    sql: "UPDATE part_site_policies SET lead_time_days = 24 WHERE part_id = 'part-001' AND site_id = ?",
    params: [LEVANTE_ID],
  });
  await executeInChunks(db, operations);
  operations.length = 0;

  const alziraParts = parts.slice(0, 8);
  for (let index = 0; index < alziraParts.length; index += 1) {
    const part = alziraParts[index];
    const onHand = 3 + index;
    const binId = `bin-alz-${(index % 4) + 1}`;
    operations.push(
      insert(
        "part_site_policies",
        [
          "id",
          "part_id",
          "site_id",
          "primary_vendor_id",
          "critical",
          "min_stock",
          "max_stock",
          "reorder_point",
          "lead_time_days",
          "average_cost",
        ],
        [
          `policy-alz-${part.id}`,
          part.id,
          ALZIRA_ID,
          part.vendorId,
          index < 2 ? 1 : 0,
          2,
          12,
          4,
          part.leadTimeDays + 1,
          part.standardCost,
        ],
      ),
      insert(
        "stock_levels",
        [
          "id",
          "part_id",
          "site_id",
          "bin_id",
          "on_hand",
          "reserved",
          "on_order",
          "version",
          "updated_at",
        ],
        [
          `stock-alz-${part.id}`,
          part.id,
          ALZIRA_ID,
          binId,
          onHand,
          0,
          0,
          1,
          NOW,
        ],
      ),
      insert(
        "inventory_movements",
        [
          "id",
          "organization_id",
          "site_id",
          "part_id",
          "bin_id",
          "work_order_id",
          "purchase_order_id",
          "goods_receipt_id",
          "stock_transfer_id",
          "actor_id",
          "movement_type",
          "reference",
          "reason",
          "delta_on_hand",
          "delta_reserved",
          "delta_on_order",
          "unit_cost",
          "occurred_at",
          "created_at",
        ],
        [
          `movement-alz-${part.id}-initial`,
          ORGANIZATION_ID,
          ALZIRA_ID,
          part.id,
          binId,
          null,
          null,
          null,
          null,
          "user-warehouse",
          "RECEIPT",
          "REC-ALZ-2026-001",
          "Stock inicial del almacén técnico de Alzira",
          onHand,
          0,
          0,
          part.standardCost,
          at(-50),
          at(-50),
        ],
      ),
    );
  }

  operations.push(
    insert(
      "purchase_requisitions",
      [
        "id",
        "organization_id",
        "site_id",
        "warehouse_id",
        "work_order_id",
        "number",
        "origin",
        "urgency",
        "need_by",
        "justification",
        "status",
        "requested_by_id",
        "approved_by_id",
        "approved_at",
        "decision_reason",
        "version",
        "created_at",
        "updated_at",
      ],
      [
        "pr-alz-review",
        ORGANIZATION_ID,
        ALZIRA_ID,
        "warehouse-alz-mro",
        null,
        "PR-ALZ-2026-041",
        "LOW_STOCK",
        "ROUTINE",
        at(5),
        "Reposición de seguridad del almacén técnico secundario.",
        "SUBMITTED",
        "user-planner",
        null,
        null,
        null,
        1,
        at(-1, 11),
        NOW,
      ],
    ),
    insert(
      "purchase_requisition_lines",
      [
        "id",
        "purchase_requisition_id",
        "part_id",
        "quantity",
        "available_snapshot",
        "on_order_snapshot",
        "note",
      ],
      [
        "prl-alz-review",
        "pr-alz-review",
        "part-003",
        6,
        5,
        0,
        "Reposición estándar",
      ],
    ),
    insert(
      "procurement_events",
      [
        "id",
        "organization_id",
        "site_id",
        "entity_type",
        "entity_id",
        "actor_id",
        "event_type",
        "from_status",
        "to_status",
        "note",
        "created_at",
      ],
      [
        "proc-event-pr-alz",
        ORGANIZATION_ID,
        ALZIRA_ID,
        "PURCHASE_REQUISITION",
        "pr-alz-review",
        "user-planner",
        "REQUISITION_SUBMITTED",
        null,
        "SUBMITTED",
        "Necesidad enviada a aprobación.",
        at(-1, 11),
      ],
    ),
  );
  await executeInChunks(db, operations);
  operations.length = 0;

  const outstandingRows = await db
    .prepare(
      `SELECT stock.id AS stockId, stock.part_id AS partId, stock.bin_id AS binId,
        stock.on_order AS onOrder, part.sku, part.name,
        policy.primary_vendor_id AS vendorId, policy.average_cost AS unitPrice
       FROM stock_levels stock
       INNER JOIN parts part ON part.id = stock.part_id
       INNER JOIN part_site_policies policy
         ON policy.part_id = stock.part_id AND policy.site_id = stock.site_id
       WHERE stock.site_id = ? AND stock.on_order > 0
       ORDER BY policy.primary_vendor_id, part.sku`,
    )
    .bind(LEVANTE_ID)
    .all<{
      stockId: string;
      partId: string;
      binId: string;
      onOrder: number;
      sku: string;
      name: string;
      vendorId: string;
      unitPrice: number;
    }>();
  const outstanding = outstandingRows.results ?? [];
  const showcase = outstanding.find((row) => row.partId === "part-024");
  const grouped = new Map<string, typeof outstanding>();
  for (const row of outstanding.filter((item) => item.partId !== "part-024")) {
    const groupKey = `${row.vendorId}:${row.binId}`;
    const current = grouped.get(groupKey) ?? [];
    current.push(row);
    grouped.set(groupKey, current);
  }
  let groupIndex = 0;
  for (const lines of grouped.values()) {
    groupIndex += 1;
    const vendorId = lines[0].vendorId;
    const requisitionId = `pr-v1d-supply-${groupIndex}`;
    const purchaseOrderId = `po-v1d-supply-${groupIndex}`;
    const requisitionNumber = `PR-LEV-2026-${String(50 + groupIndex).padStart(3, "0")}`;
    const purchaseOrderNumber = `PO-LEV-2026-${String(70 + groupIndex).padStart(3, "0")}`;
    const subtotal = Number(
      lines
        .reduce((sum, line) => sum + line.onOrder * line.unitPrice, 0)
        .toFixed(2),
    );
    const tax = Number((subtotal * 0.21).toFixed(2));
    operations.push(
      insert(
        "purchase_requisitions",
        [
          "id",
          "organization_id",
          "site_id",
          "warehouse_id",
          "work_order_id",
          "number",
          "origin",
          "urgency",
          "need_by",
          "justification",
          "status",
          "requested_by_id",
          "approved_by_id",
          "approved_at",
          "decision_reason",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          requisitionId,
          ORGANIZATION_ID,
          LEVANTE_ID,
          "warehouse-lev-mro",
          null,
          requisitionNumber,
          "LOW_STOCK",
          "ROUTINE",
          at(4 + groupIndex),
          "Reposición agrupada derivada del punto de pedido.",
          "CONVERTED",
          "user-planner",
          "user-manager",
          at(-8),
          null,
          3,
          at(-9),
          NOW,
        ],
      ),
      insert(
        "purchase_orders",
        [
          "id",
          "organization_id",
          "site_id",
          "requisition_id",
          "vendor_id",
          "warehouse_id",
          "destination_bin_id",
          "number",
          "status",
          "currency",
          "ordered_at",
          "expected_at",
          "sent_at",
          "received_at",
          "cancelled_at",
          "subtotal",
          "tax_rate",
          "tax_amount",
          "total",
          "created_by_id",
          "approved_by_id",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          purchaseOrderId,
          ORGANIZATION_ID,
          LEVANTE_ID,
          requisitionId,
          vendorId,
          "warehouse-lev-mro",
          lines[0].binId,
          purchaseOrderNumber,
          "SENT",
          "EUR",
          at(-8),
          groupIndex === 1 ? at(-1) : at(4 + groupIndex),
          at(-8, 10),
          null,
          null,
          subtotal,
          21,
          tax,
          subtotal + tax,
          "user-manager",
          "user-manager",
          3,
          at(-8),
          NOW,
        ],
      ),
    );
    for (const line of lines) {
      operations.push(
        insert(
          "purchase_requisition_lines",
          [
            "id",
            "purchase_requisition_id",
            "part_id",
            "quantity",
            "available_snapshot",
            "on_order_snapshot",
            "note",
          ],
          [
            `prl-${purchaseOrderId}-${line.partId}`,
            requisitionId,
            line.partId,
            line.onOrder,
            0,
            line.onOrder,
            "Reposición por política",
          ],
        ),
        insert(
          "purchase_order_lines",
          [
            "id",
            "purchase_order_id",
            "part_id",
            "vendor_offer_id",
            "vendor_sku_snapshot",
            "description_snapshot",
            "ordered_quantity",
            "received_quantity",
            "unit_price_snapshot",
            "line_total",
          ],
          [
            `pol-${purchaseOrderId}-${line.partId}`,
            purchaseOrderId,
            line.partId,
            `offer-primary-${line.partId}`,
            `${line.sku}-P`,
            line.name,
            line.onOrder,
            0,
            line.unitPrice,
            Number((line.onOrder * line.unitPrice).toFixed(2)),
          ],
        ),
        insert(
          "inventory_movements",
          [
            "id",
            "organization_id",
            "site_id",
            "part_id",
            "bin_id",
            "work_order_id",
            "purchase_order_id",
            "goods_receipt_id",
            "stock_transfer_id",
            "actor_id",
            "movement_type",
            "reference",
            "reason",
            "delta_on_hand",
            "delta_reserved",
            "delta_on_order",
            "unit_cost",
            "occurred_at",
            "created_at",
          ],
          [
            `movement-order-${purchaseOrderId}-${line.partId}`,
            ORGANIZATION_ID,
            LEVANTE_ID,
            line.partId,
            line.binId,
            null,
            purchaseOrderId,
            null,
            null,
            "user-manager",
            "ORDER",
            purchaseOrderNumber,
            "Pedido abierto migrado a trazabilidad V1D",
            0,
            0,
            line.onOrder,
            line.unitPrice,
            at(-8, 10),
            at(-8, 10),
          ],
        ),
      );
    }
  }

  if (showcase) {
    const receivedQuantity = Math.min(2, Number(showcase.onOrder));
    const remaining = Number(showcase.onOrder) - receivedQuantity;
    const subtotal = Number((showcase.onOrder * showcase.unitPrice).toFixed(2));
    const tax = Number((subtotal * 0.21).toFixed(2));
    operations.push(
      insert(
        "work_order_materials",
        [
          "id",
          "work_order_id",
          "part_id",
          "bin_id",
          "planned_quantity",
          "reserved_quantity",
          "consumed_quantity",
          "returned_quantity",
          "created_by_id",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          "material-wo002-part024",
          "wo-002",
          showcase.partId,
          showcase.binId,
          showcase.onOrder,
          0,
          0,
          0,
          "user-planner",
          1,
          at(-10),
          NOW,
        ],
      ),
      insert(
        "purchase_requisitions",
        [
          "id",
          "organization_id",
          "site_id",
          "warehouse_id",
          "work_order_id",
          "number",
          "origin",
          "urgency",
          "need_by",
          "justification",
          "status",
          "requested_by_id",
          "approved_by_id",
          "approved_at",
          "decision_reason",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          "pr-v1d-wo002",
          ORGANIZATION_ID,
          LEVANTE_ID,
          "warehouse-lev-mro",
          "wo-002",
          "PR-LEV-2026-049",
          "WORK_ORDER",
          "CRITICAL",
          at(-2),
          "Filtro necesario para continuar la intervención de COMP-02.",
          "CONVERTED",
          "user-tech-1",
          "user-manager",
          at(-9, 9),
          null,
          3,
          at(-10),
          NOW,
        ],
      ),
      insert(
        "purchase_requisition_lines",
        [
          "id",
          "purchase_requisition_id",
          "part_id",
          "quantity",
          "available_snapshot",
          "on_order_snapshot",
          "note",
        ],
        [
          "prl-v1d-wo002",
          "pr-v1d-wo002",
          showcase.partId,
          showcase.onOrder,
          0,
          showcase.onOrder,
          "Necesidad crítica de OT",
        ],
      ),
      insert(
        "purchase_orders",
        [
          "id",
          "organization_id",
          "site_id",
          "requisition_id",
          "vendor_id",
          "warehouse_id",
          "destination_bin_id",
          "number",
          "status",
          "currency",
          "ordered_at",
          "expected_at",
          "sent_at",
          "received_at",
          "cancelled_at",
          "subtotal",
          "tax_rate",
          "tax_amount",
          "total",
          "created_by_id",
          "approved_by_id",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          "po-v1d-wo002",
          ORGANIZATION_ID,
          LEVANTE_ID,
          "pr-v1d-wo002",
          showcase.vendorId,
          "warehouse-lev-mro",
          showcase.binId,
          "PO-LEV-2026-069",
          remaining > 0 ? "PARTIALLY_RECEIVED" : "RECEIVED",
          "EUR",
          at(-9, 10),
          at(-2),
          at(-9, 10, 15),
          remaining > 0 ? null : at(-5),
          null,
          subtotal,
          21,
          tax,
          subtotal + tax,
          "user-manager",
          "user-manager",
          4,
          at(-9),
          NOW,
        ],
      ),
      insert(
        "purchase_order_lines",
        [
          "id",
          "purchase_order_id",
          "part_id",
          "vendor_offer_id",
          "vendor_sku_snapshot",
          "description_snapshot",
          "ordered_quantity",
          "received_quantity",
          "unit_price_snapshot",
          "line_total",
        ],
        [
          "pol-v1d-wo002",
          "po-v1d-wo002",
          showcase.partId,
          `offer-primary-${showcase.partId}`,
          `${showcase.sku}-P`,
          showcase.name,
          showcase.onOrder,
          receivedQuantity,
          showcase.unitPrice,
          subtotal,
        ],
      ),
      insert(
        "goods_receipts",
        [
          "id",
          "organization_id",
          "site_id",
          "purchase_order_id",
          "warehouse_id",
          "number",
          "idempotency_key",
          "external_reference",
          "received_by_id",
          "received_at",
          "status",
          "total_cost",
          "created_at",
        ],
        [
          "gr-v1d-wo002-first",
          ORGANIZATION_ID,
          LEVANTE_ID,
          "po-v1d-wo002",
          "warehouse-lev-mro",
          "GR-LEV-2026-012",
          "seed-v1d-gr-wo002-first",
          "ALB-FIL-88214",
          "user-warehouse",
          at(-5, 11),
          "POSTED",
          receivedQuantity * showcase.unitPrice,
          at(-5, 11),
        ],
      ),
      insert(
        "goods_receipt_lines",
        [
          "id",
          "goods_receipt_id",
          "purchase_order_line_id",
          "part_id",
          "bin_id",
          "quantity",
          "unit_cost_snapshot",
          "total_cost",
        ],
        [
          "grl-v1d-wo002-first",
          "gr-v1d-wo002-first",
          "pol-v1d-wo002",
          showcase.partId,
          showcase.binId,
          receivedQuantity,
          showcase.unitPrice,
          receivedQuantity * showcase.unitPrice,
        ],
      ),
      insert(
        "inventory_movements",
        [
          "id",
          "organization_id",
          "site_id",
          "part_id",
          "bin_id",
          "work_order_id",
          "purchase_order_id",
          "goods_receipt_id",
          "stock_transfer_id",
          "actor_id",
          "movement_type",
          "reference",
          "reason",
          "delta_on_hand",
          "delta_reserved",
          "delta_on_order",
          "unit_cost",
          "occurred_at",
          "created_at",
        ],
        [
          "movement-order-po-v1d-wo002",
          ORGANIZATION_ID,
          LEVANTE_ID,
          showcase.partId,
          showcase.binId,
          "wo-002",
          "po-v1d-wo002",
          null,
          null,
          "user-manager",
          "ORDER",
          "PO-LEV-2026-069",
          "Pedido enviado por necesidad de OT",
          0,
          0,
          showcase.onOrder,
          showcase.unitPrice,
          at(-9, 10, 15),
          at(-9, 10, 15),
        ],
      ),
      insert(
        "inventory_movements",
        [
          "id",
          "organization_id",
          "site_id",
          "part_id",
          "bin_id",
          "work_order_id",
          "purchase_order_id",
          "goods_receipt_id",
          "stock_transfer_id",
          "actor_id",
          "movement_type",
          "reference",
          "reason",
          "delta_on_hand",
          "delta_reserved",
          "delta_on_order",
          "unit_cost",
          "occurred_at",
          "created_at",
        ],
        [
          "movement-receipt-po-v1d-wo002",
          ORGANIZATION_ID,
          LEVANTE_ID,
          showcase.partId,
          showcase.binId,
          "wo-002",
          "po-v1d-wo002",
          "gr-v1d-wo002-first",
          null,
          "user-warehouse",
          "RECEIPT",
          "GR-LEV-2026-012",
          "Recepción parcial para OT",
          receivedQuantity,
          0,
          -receivedQuantity,
          showcase.unitPrice,
          at(-5, 11),
          at(-5, 11),
        ],
      ),
      {
        sql: "UPDATE stock_levels SET on_hand = on_hand + ?, on_order = ?, version = version + 1, updated_at = ? WHERE id = ?",
        params: [receivedQuantity, remaining, NOW, showcase.stockId],
      },
      insert(
        "work_order_events",
        [
          "id",
          "work_order_id",
          "actor_id",
          "event_type",
          "from_status",
          "to_status",
          "note",
          "created_at",
        ],
        [
          "event-wo002-procurement-received",
          "wo-002",
          "user-warehouse",
          "PART_RECEIVED",
          null,
          null,
          `GR-LEV-2026-012: ${showcase.sku} × ${receivedQuantity} recibido; quedan ${remaining} en pedido.`,
          at(-5, 11),
        ],
      ),
    );
  }

  operations.push(
    insert(
      "purchase_requisitions",
      [
        "id",
        "organization_id",
        "site_id",
        "warehouse_id",
        "work_order_id",
        "number",
        "origin",
        "urgency",
        "need_by",
        "justification",
        "status",
        "requested_by_id",
        "approved_by_id",
        "approved_at",
        "decision_reason",
        "version",
        "created_at",
        "updated_at",
      ],
      [
        "pr-v1d-pending",
        ORGANIZATION_ID,
        LEVANTE_ID,
        "warehouse-lev-mro",
        null,
        "PR-LEV-2026-048",
        "PLANNING",
        "HIGH",
        at(3),
        "Material previsto para ventana preventiva de laminación.",
        "SUBMITTED",
        "user-planner",
        null,
        null,
        null,
        1,
        at(-1, 8),
        NOW,
      ],
    ),
    insert(
      "purchase_requisition_lines",
      [
        "id",
        "purchase_requisition_id",
        "part_id",
        "quantity",
        "available_snapshot",
        "on_order_snapshot",
        "note",
      ],
      [
        "prl-v1d-pending",
        "pr-v1d-pending",
        "part-010",
        4,
        3,
        0,
        "Demanda del planner",
      ],
    ),
    insert(
      "procurement_events",
      [
        "id",
        "organization_id",
        "site_id",
        "entity_type",
        "entity_id",
        "actor_id",
        "event_type",
        "from_status",
        "to_status",
        "note",
        "created_at",
      ],
      [
        "proc-event-pr-pending",
        ORGANIZATION_ID,
        LEVANTE_ID,
        "PURCHASE_REQUISITION",
        "pr-v1d-pending",
        "user-planner",
        "REQUISITION_SUBMITTED",
        "DRAFT",
        "SUBMITTED",
        "Enviada a aprobación por ventana preventiva.",
        at(-1, 8),
      ],
    ),
    insert(
      "audit_entries",
      [
        "id",
        "organization_id",
        "site_id",
        "actor_id",
        "action",
        "entity_type",
        "entity_id",
        "previous_value",
        "new_value",
        "request_id",
        "created_at",
      ],
      [
        "audit-pr-v1d-pending",
        ORGANIZATION_ID,
        LEVANTE_ID,
        "user-planner",
        "PURCHASE_REQUISITION_SUBMITTED",
        "PURCHASE_REQUISITION",
        "pr-v1d-pending",
        '{"status":"DRAFT"}',
        '{"status":"SUBMITTED"}',
        "seed-v1d",
        at(-1, 8),
      ],
    ),
  );

  const transferPart = outstanding.find((row) => row.partId === "part-002");
  const part2 = parts.find((row) => row.id === "part-002");
  if (part2) {
    const sourceBin = "bin-lev-02";
    operations.push(
      insert(
        "stock_transfers",
        [
          "id",
          "organization_id",
          "site_id",
          "number",
          "from_warehouse_id",
          "to_warehouse_id",
          "requested_by_id",
          "status",
          "note",
          "shipped_at",
          "received_at",
          "cancelled_at",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          "transfer-v1d-received",
          ORGANIZATION_ID,
          LEVANTE_ID,
          "TR-LEV-2026-007",
          "warehouse-lev-mro",
          "warehouse-lev-line",
          "user-warehouse",
          "RECEIVED",
          "Reposición de punto de uso LM-02",
          at(-3, 8),
          at(-3, 9),
          null,
          3,
          at(-3, 7, 45),
          NOW,
        ],
      ),
      insert(
        "stock_transfer_lines",
        [
          "id",
          "stock_transfer_id",
          "part_id",
          "from_bin_id",
          "to_bin_id",
          "quantity",
          "unit_cost_snapshot",
        ],
        [
          "transfer-line-v1d-received",
          "transfer-v1d-received",
          part2.id,
          sourceBin,
          "bin-lev-line-1",
          1,
          part2.standardCost,
        ],
      ),
      insert(
        "stock_levels",
        [
          "id",
          "part_id",
          "site_id",
          "bin_id",
          "on_hand",
          "reserved",
          "on_order",
          "version",
          "updated_at",
        ],
        [
          "stock-part-002-line",
          part2.id,
          LEVANTE_ID,
          "bin-lev-line-1",
          1,
          0,
          0,
          1,
          NOW,
        ],
      ),
      {
        sql: "UPDATE stock_levels SET on_hand = on_hand - 1, version = version + 1, updated_at = ? WHERE part_id = ? AND site_id = ? AND bin_id = ? AND on_hand - reserved >= 1",
        params: [NOW, part2.id, LEVANTE_ID, sourceBin],
      },
      insert(
        "inventory_movements",
        [
          "id",
          "organization_id",
          "site_id",
          "part_id",
          "bin_id",
          "work_order_id",
          "purchase_order_id",
          "goods_receipt_id",
          "stock_transfer_id",
          "actor_id",
          "movement_type",
          "reference",
          "reason",
          "delta_on_hand",
          "delta_reserved",
          "delta_on_order",
          "unit_cost",
          "occurred_at",
          "created_at",
        ],
        [
          "movement-transfer-v1d-out",
          ORGANIZATION_ID,
          LEVANTE_ID,
          part2.id,
          sourceBin,
          null,
          null,
          null,
          "transfer-v1d-received",
          "user-warehouse",
          "TRANSFER",
          "TR-LEV-2026-007",
          "Salida a punto de uso",
          -1,
          0,
          0,
          part2.standardCost,
          at(-3, 8),
          at(-3, 8),
        ],
      ),
      insert(
        "inventory_movements",
        [
          "id",
          "organization_id",
          "site_id",
          "part_id",
          "bin_id",
          "work_order_id",
          "purchase_order_id",
          "goods_receipt_id",
          "stock_transfer_id",
          "actor_id",
          "movement_type",
          "reference",
          "reason",
          "delta_on_hand",
          "delta_reserved",
          "delta_on_order",
          "unit_cost",
          "occurred_at",
          "created_at",
        ],
        [
          "movement-transfer-v1d-in",
          ORGANIZATION_ID,
          LEVANTE_ID,
          part2.id,
          "bin-lev-line-1",
          null,
          null,
          null,
          "transfer-v1d-received",
          "user-warehouse",
          "TRANSFER",
          "TR-LEV-2026-007",
          "Entrada en punto de uso",
          1,
          0,
          0,
          part2.standardCost,
          at(-3, 9),
          at(-3, 9),
        ],
      ),
    );
  }
  void transferPart;
  await executeInChunks(db, operations);

  await db
    .prepare(
      "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES ('demo_seed_v1d_1', 'complete', ?)",
    )
    .bind(NOW)
    .run();
  await repairV1DOnOrderBinProjection(db);
  await db.prepare("PRAGMA optimize").run();
}
