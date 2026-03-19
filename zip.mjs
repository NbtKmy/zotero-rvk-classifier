import { execSync } from "child_process";
import { readFileSync, mkdirSync } from "fs";
import { join } from "path";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const version = manifest.version;
const outDir = "dist";
const outFile = join(outDir, `zotero-rvk-classifier-${version}.xpi`);

mkdirSync(outDir, { recursive: true });

// Files and folders to include in the .xpi
const includes = [
  "manifest.json",
  "bootstrap.js",
  "prefs.js",
  "addon",
  "locale",
];

// Remove old file if exists
try { execSync(`rm -f "${outFile}"`); } catch {}

execSync(`zip -r "${outFile}" ${includes.join(" ")}`, { stdio: "inherit" });

console.log(`\nPackaged: ${outFile}`);
