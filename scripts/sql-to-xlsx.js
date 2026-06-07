const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const XLSX = require("xlsx");

const backupDir = path.join(process.cwd(), "backups", "diario");

const sqlFile = fs
  .readdirSync(backupDir)
  .filter(name => name.endsWith(".sql"))
  .sort()
  .pop();

if (!sqlFile) {
  throw new Error("No se ha encontrado ningún archivo SQL en backups/diario");
}

const sqlPath = path.join(backupDir, sqlFile);
const datePart = sqlFile.match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().slice(0, 10);

const dbPath = path.join(backupDir, `tmp-${datePart}.sqlite`);
const xlsxPath = path.join(backupDir, `inscripciones-${datePart}.xlsx`);

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const sql = fs.readFileSync(sqlPath, "utf8");

const db = new Database(dbPath);
db.exec(sql);

const rows = db.prepare(`
  SELECT *
  FROM inscripciones
  ORDER BY fecha_creacion DESC
`).all();

const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.json_to_sheet(rows);

XLSX.utils.book_append_sheet(workbook, worksheet, "Inscripciones");
XLSX.writeFile(workbook, xlsxPath);

db.close();
fs.unlinkSync(dbPath);

console.log(`Excel generado: ${xlsxPath}`);
