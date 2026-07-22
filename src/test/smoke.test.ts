/**
 * Smoke tests for shared utilities — runs via plain Node.js (no VS Code required).
 * Run: npx tsx src/test/smoke.test.ts
 */

import { deepStrictEqual, ok } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Test locale keys coverage ────────────────────────────

function testLocaleKeys(): void {
  const en = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "package.nls.json"), "utf8"),
  );
  const zh = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "package.nls.zh-cn.json"), "utf8"),
  );

  let missing = 0;
  for (const key of Object.keys(en)) {
    if (!(key in zh)) {
      console.warn(`  MISSING zh-cn: ${key}`);
      missing++;
    }
  }
  if (missing > 0) {
    throw new Error(`${missing} keys missing Chinese translation`);
  }

  const extraInZh = Object.keys(zh).filter((k) => !(k in en));
  if (extraInZh.length > 0) {
    console.warn(`  Extra keys in zh-cn: ${extraInZh.join(", ")}`);
  }

  console.log(`  OK: ${Object.keys(en).length} keys, all translated`);
}

// ── Test bridge helpers (pure functions) ─────────────────

function testTruncateText(): void {
  const truncateText = (text: string, maxLines = 2000, maxBytes = 50 * 1024): string => {
    const lines = text.split("\n");
    let output = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") : text;
    if (Buffer.byteLength(output, "utf8") > maxBytes) {
      output = Buffer.from(output, "utf8").subarray(0, maxBytes).toString("utf8");
    }
    return output;
  };

  deepStrictEqual(truncateText("hello"), "hello");

  const manyLines = Array(3000).fill("line").join("\n");
  const truncated = truncateText(manyLines);
  ok(truncated.split("\n").length <= 2000);

  const bigLine = "x".repeat(60 * 1024);
  const byteTruncated = truncateText(bigLine);
  ok(Buffer.byteLength(byteTruncated, "utf8") <= 50 * 1024);

  console.log("  OK: truncation works");
}

function testBoundedJson(): void {
  const boundedJson = (value: unknown): string => {
    const text = JSON.stringify(value) ?? "null";
    const lineCount = text.split("\n").length;
    const byteCount = Buffer.byteLength(text, "utf8");
    if (lineCount <= 2000 && byteCount <= 50 * 1024) { return text; }
    return JSON.stringify({
      truncated: true,
      message: "Result exceeded output limits.",
      originalBytes: byteCount,
      originalLines: lineCount,
      resultJsonPrefix: "truncated",
    });
  };

  const small = boundedJson({ hello: "world" });
  ok(small.includes("hello"));

  const big = { items: Array(100000).fill("x") };
  const result = JSON.parse(boundedJson(big));
  ok(result.truncated === true);

  console.log("  OK: boundedJson works");
}

// ── Run ──────────────────────────────────────────────────

console.log("\n=== Smoke Tests ===\n");

const tests: Array<{ name: string; fn: () => void }> = [
  { name: "Locale keys coverage", fn: testLocaleKeys },
  { name: "truncateText", fn: testTruncateText },
  { name: "boundedJson", fn: testBoundedJson },
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    console.log(`[TEST] ${test.name}`);
    test.fn();
    passed++;
  } catch (e) {
    console.error(`  FAILED: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) { process.exit(1); }
