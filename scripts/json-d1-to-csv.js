const fs = require("fs");

const input = process.argv[2];
const output = process.argv[3];

if (!input || !output) {
  throw new Error("Uso: node scripts/json-d1-to-csv.js input.json output.csv");
}

const raw = JSON.parse(fs.readFileSync(input, "utf8"));

let rows = [];

if (Array.isArray(raw)) {
  rows = raw[0]?.results || raw[0]?.result?.results || raw[0]?.result || [];
} else {
  rows = raw.results || raw.result?.results || raw.result || [];
}

if (!Array.isArray(rows)) {
  rows = [];
}

const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];

function csvCell(value) {
  if (value === null || value === undefined) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

const csv = [
  headers.join(";"),
  ...rows.map(row => headers.map(h => csvCell(row[h])).join(";"))
].join("\n");

fs.writeFileSync(output, "\ufeff" + csv, "utf8");

console.log(`CSV generado: ${output}`);
