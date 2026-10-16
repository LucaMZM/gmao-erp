import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Disposable SQLite/R2-object equivalent. Never receives a production URL,
// binding, credential or path. The same migration SQL is applied from zero.
const root = mkdtempSync(join(tmpdir(), "mazmi-restore-rehearsal-"));
const source = join(root, "source.sqlite");
const backup = join(root, "backup.sqlite");
const restored = join(root, "restored.sqlite");
const object = join(root, "evidence.bin");
const objectBackup = join(root, "evidence.backup.bin");
const at = "2026-10-04T10:00:00.000Z";
const bytes = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
]);
const checksum = createHash("sha256").update(bytes).digest("hex");
const sql = (file, statement) =>
  execFileSync("sqlite3", [file], { input: statement, encoding: "utf8" });
const value = (file, statement) =>
  execFileSync("sqlite3", [file, statement], { encoding: "utf8" }).trim();

try {
  for (const name of readdirSync("drizzle")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sql(source, readFileSync(join("drizzle", name), "utf8"));
  sql(
    source,
    `PRAGMA foreign_keys=ON;
    INSERT INTO organizations(id,code,name,created_at,updated_at)
      VALUES('pilot-restore-org','RESTORE-PILOT','Fábrica de ensayo aislada','${at}','${at}');
    INSERT INTO sites(id,organization_id,code,name,short_name,city,created_at,updated_at)
      VALUES('pilot-restore-site','pilot-restore-org','ES-TEST','Centro de ensayo','Ensayo','Valencia','${at}','${at}');
    INSERT INTO users(id,email,full_name,initials,job_title,avatar_color,password_hash,password_salt,created_at,updated_at)
      VALUES('pilot-restore-user','restore-only@example.invalid','Operador de ensayo','OE','Ensayo','#555555','not-a-login','not-a-login','${at}','${at}');
    INSERT INTO functional_locations(id,organization_id,site_id,code,name,type,created_at,updated_at)
      VALUES('pilot-restore-location','pilot-restore-org','pilot-restore-site','AREA-01','Área de ensayo','AREA','${at}','${at}');
    INSERT INTO asset_classes(id,organization_id,code,name,family)
      VALUES('pilot-restore-class','pilot-restore-org','TEST','Equipo de ensayo','OTHER');
    INSERT INTO assets(id,organization_id,site_id,functional_location_id,asset_class_id,code,name,
      description,kind,status,criticality,health_score,created_at,updated_at)
      VALUES('pilot-restore-asset','pilot-restore-org','pilot-restore-site','pilot-restore-location',
      'pilot-restore-class','TEST-01','Activo de ensayo','Solo simulacro','EQUIPMENT',
      'OPERATING','MEDIUM',100,'${at}','${at}');
    INSERT INTO evidence_items(id,organization_id,site_id,asset_id,author_id,kind,stage,
      description,storage_provider,storage_key,file_name,content_type,size_bytes,created_at,checksum_sha256)
      VALUES('pilot-restore-evidence','pilot-restore-org','pilot-restore-site','pilot-restore-asset',
      'pilot-restore-user','DOCUMENT','GENERAL','Evidencia de ensayo','R2',
      'pilot-restore-org/pilot-restore-site/evidence.bin','evidence.pdf','application/pdf',
      ${bytes.byteLength},'${at}','${checksum}');`,
  );
  writeFileSync(object, bytes);
  sql(source, `.backup '${backup}'`);
  copyFileSync(object, objectBackup);
  sql(
    source,
    "PRAGMA foreign_keys=ON; DELETE FROM evidence_items WHERE id='pilot-restore-evidence'; DELETE FROM assets WHERE id='pilot-restore-asset';",
  );
  rmSync(object);
  if (
    value(
      source,
      "SELECT count(*) FROM assets WHERE id='pilot-restore-asset'",
    ) !== "0" ||
    existsSync(object)
  )
    throw new Error("Loss simulation did not remove the sentinel");
  copyFileSync(backup, restored);
  copyFileSync(objectBackup, object);
  if (
    value(restored, "PRAGMA quick_check") !== "ok" ||
    value(restored, "PRAGMA foreign_key_check") !== ""
  )
    throw new Error("Restored SQLite integrity failed");
  if (
    value(
      restored,
      "SELECT count(*) FROM assets WHERE id='pilot-restore-asset'",
    ) !== "1" ||
    value(
      restored,
      "SELECT count(*) FROM evidence_items WHERE id='pilot-restore-evidence' AND storage_key='pilot-restore-org/pilot-restore-site/evidence.bin'",
    ) !== "1"
  )
    throw new Error("Sentinel or evidence metadata missing after restore");
  if (
    createHash("sha256").update(readFileSync(object)).digest("hex") !==
    value(
      restored,
      "SELECT checksum_sha256 FROM evidence_items WHERE id='pilot-restore-evidence'",
    )
  )
    throw new Error("Evidence bytes/checksum diverged after restore");
  console.log(
    "RESTORE_REHEARSAL_PASS: clean migrations, sentinel, FK, evidence metadata and bytes",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
