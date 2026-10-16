import test from "node:test";
import assert from "node:assert/strict";
import { csvCell } from "../src/lib/csv.js";

test("spreadsheet exports neutralize formulas including whitespace-prefixed cells", () => {
  for (const value of ["=1+1", "+SUM(1,2)", "-1+2", "@SUM(A1)", " \t=1", "\tphone", "\n=1", "\uFEFF=1"]) {
    assert.ok(csvCell(value).startsWith('"\''), JSON.stringify(value));
  }
});

test("CSV retains numeric amounts, quotes, commas and empty cells", () => {
  assert.equal(csvCell(-12.5), '"-12.5"');
  assert.equal(csvCell(0), '"0"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell('Oil, "large"'), '"Oil, ""large"""');
});
