/**
 * CLI: turn GPS logs into an installable Assetto Corsa track zip.
 *
 *   npx tsx tools/generate.ts fixtures/run1-8.csv [more.csv ...] -o out/
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { buildTrack } from "../packages/core/src/package/buildTrack.js";

const args = process.argv.slice(2);
const outIndex = args.findIndex((a) => a === "-o" || a === "--out");
const outDir = outIndex >= 0 ? args[outIndex + 1]! : "out";
const inputs = args.filter((a, i) => !a.startsWith("-") && i !== outIndex + 1);

if (inputs.length === 0) {
  console.error("usage: generate.ts <run.csv> [run2.csv ...] [-o outDir]");
  process.exit(1);
}

const sources = inputs.map((path) => ({
  name: basename(path),
  text: readFileSync(path, "utf8"),
}));

const result = buildTrack(sources);

mkdirSync(outDir, { recursive: true });
const zipPath = join(outDir, `${result.meta.id}.zip`);
writeFileSync(zipPath, result.zip);

console.log(`track id     : ${result.meta.id}`);
console.log(`name         : ${result.meta.name}`);
console.log(`runs used    : ${result.runs.length}`);
console.log(`course length: ${result.meta.lengthMetres} m`);
console.log(`target time  : ${(result.meta.targetTimeMs / 1000).toFixed(2)} s`);
console.log(`cones        : ${result.cones.length}`);
console.log("files        :");
for (const file of result.files) {
  console.log(`  ${file.path.padEnd(24)} ${file.data.length.toLocaleString()} bytes`);
}
if (result.warnings.length) {
  console.log("warnings     :");
  for (const w of result.warnings) console.log(`  - ${w}`);
}
console.log(`\nwrote ${zipPath} (${result.zip.length.toLocaleString()} bytes)`);
