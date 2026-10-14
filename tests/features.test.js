import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { workbookPlan } from "../public/workbook.js";
import { calculate, validatePlan } from "../public/engine.js";
import {
  raceSummary,
  fuelForDuration,
  availabilitySlots,
  resampleAvailability,
} from "../public/race-features.js";
const source = JSON.parse(
  fs.readFileSync(new URL("../public/workbook.json", import.meta.url), "utf8"),
);
test("workbook race total and final fractional stint match cached source", () => {
  const p = workbookPlan(source),
    m = calculate(p),
    o = source.sheets.find((s) => s.name === "Overview").cells;
  assert.ok(Math.abs(m.idealLapTotal - o.H23.value) < 0.0001);
  assert.ok(m.rows.find((r) => r.final && !r.surplus).laps < 1);
  assert.equal(m.fairLaps, o.H25.value);
  assert.equal(m.averageRating, o.E25.value);
  const s = raceSummary(p, m);
  assert.equal(s.idealFairStints, o.H24.value);
  assert.ok(Math.abs(s.finalStandard.fuel - o.J29.value) < 0.001);
});
test("manual fuel calculator reproduces source continuous fuel and one-lap margin", () => {
  const p = workbookPlan(source),
    o = source.sheets.find((s) => s.name === "Overview").cells;
  const v = fuelForDuration(p.config, o.H33.value * 86400);
  assert.ok(Math.abs(v.fuel - o.I33.value) < 0.0001);
  assert.ok(Math.abs(v.withExtraLap - o.K33.value) < 0.0001);
});
test("cumulative in-laps derive per-stint laps and cumulative deltas", () => {
  const p = workbookPlan(source);
  p.stints[0].actualInLap = 10;
  p.stints[1].actualInLap = 21;
  const m = calculate(p);
  assert.equal(m.rows[0].actualLaps, 10);
  assert.equal(m.rows[1].actualLaps, 11);
  assert.equal(m.rows[1].idealInLap, 21);
  assert.equal(m.rows[0].lapDelta, -1);
  assert.equal(m.totals[p.drivers[0].id].actual, 10);
});
test("damage follows previous stint until a new override resets it", () => {
  const p = workbookPlan(source);
  p.stints[0].damageOverride = 2;
  p.stints[2].damageOverride = 0;
  const m = calculate(p);
  assert.equal(m.rows[0].damage, 2);
  assert.equal(m.rows[1].damage, 2);
  assert.equal(m.rows[2].damage, 0);
  assert.equal(m.rows[1].pace, p.config.lap + 2);
});
test("changing availability intervals preserves blocked and tentative coverage", () => {
  const p = workbookPlan(source);
  p.drivers[0].availability[0] = "blocked";
  p.drivers[0].availability[1] = "tentative";
  resampleAvailability(p, 15);
  validatePlan(p);
  assert.deepEqual(p.drivers[0].availability.slice(0, 4), [
    "blocked",
    "blocked",
    "tentative",
    "tentative",
  ]);
  resampleAvailability(p, 60);
  assert.equal(p.drivers[0].availability[0], "blocked");
});
test("availability maps both stints across a handover and driver local time", () => {
  const p = workbookPlan(source),
    m = calculate(p),
    slots = availabilitySlots(p, m);
  assert.deepEqual(slots[1].stints, [1, 2]);
  assert.equal(slots[0].drivers[0].localStart, slots[0].start + 3600000);
  assert.ok(availabilitySlots(p, m, true).some((s) => s.surplus));
});
test("optional pace periods and global tire toggle recalculate", () => {
  const p = workbookPlan(source);
  p.config.periods[5] = {
    name: "Optional",
    hour: 14,
    factor: 1.2,
    enabled: true,
  };
  p.config.addTireTime = false;
  const m = calculate(p);
  assert.equal(m.rows[0].timeFactor, 1.2);
  assert.equal(m.rows[0].service, 70);
  p.config.periods[5].enabled = false;
  assert.equal(calculate(p).rows[0].timeFactor, 1);
});
