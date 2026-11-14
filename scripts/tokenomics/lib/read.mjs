// Seed loading for the tokenomics data build (lane B1).
// Seeds live in scripts/tokenomics/seeds/, resolved relative to this file.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const seedsDir = join(here, "..", "seeds");

// Read and parse one seed file. Throws an Error naming the file if the file
// is missing, unreadable, or not valid JSON.
export function readSeed(name) {
  const p = join(seedsDir, name);
  let raw;
  try {
    raw = readFileSync(p, "utf8");
  } catch (err) {
    throw new Error(`seed ${name} missing or unreadable at ${p}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`seed ${name} is not valid JSON at ${p}: ${err.message}`);
  }
}

// Fail the build with a list of one-line reasons.
export function fail(list) {
  throw new Error(list.join("\n"));
}
