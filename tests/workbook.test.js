import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { workbookPlan } from "../public/workbook.js";
import { calculate } from "../public/engine.js";
const source = JSON.parse(
  fs.readFileSync(new URL("../public/workbook.json", import.meta.url), "utf8"),
);
test("complete workbook survives mapping and JSON backup unchanged", () => {
  const p = workbookPlan(source),
    restored = JSON.parse(JSON.stringify(p));
  assert.deepEqual(restored.sourceWorkbook, source);
  assert.equal(p.drivers.length, 16);
  assert.equal(p.stints.length, 45);
  assert.equal(source.sheets.length, 9);
  assert.equal(p.config.start, "2018-06-01T13:30:00.000Z");
  assert.equal(p.config.lap, 203);
  assert.equal(p.config.saveLap, 205.03);
  assert.equal(p.config.simStartHour, 14.5);
  assert.equal(p.drivers[2].availability[0], "blocked");
  assert.equal(p.drivers[0].sourceId, 1);
  assert.equal(p.drivers[0].rating, 1);
  assert.ok(
    p.stints.every((s) => s.actualEnd === null && s.actualLaps === null),
    "cached formulas are not recorded actuals",
  );
  assert.ok(!("hub" in p));
});
test("all time-of-day periods affect calculated pace and later timings", () => {
  const p = workbookPlan(source);
  p.config.periods.find((v) => v.name === "Afternoon").factor = 1.1;
  const m = calculate(p);
  assert.equal(m.rows[0].pace, 223.3);
  assert.equal(m.rows[1].start, m.rows[0].end);
  assert.ok(m.rows.some((r) => r.surplus));
  // Source M = (track + tires) * factor + pit, so 30 * 1.1 + 70.
  assert.equal(m.rows[0].service, 103);
});
test("saving, tires, driver pace and actual zero laps survive edits", () => {
  const p = workbookPlan(source),
    s = p.stints[0];
  s.mode = "save";
  s.tires = false;
  s.actualLaps = 0;
  p.drivers[0].pace = 1.05;
  s.actualEnd = new Date(Date.parse(p.config.start) + 2500000).toISOString();
  const m = calculate(p);
  assert.equal(m.rows[1].start, Date.parse(s.actualEnd));
  assert.equal(m.rows[0].service, 70);
  assert.equal(m.rows[0].pace, p.config.saveLap * 1.05);
  assert.equal(m.rows[0].actualLaps, 0);
});
