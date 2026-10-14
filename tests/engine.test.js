import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultPlan,
  generate,
  calculate,
  availability,
  validatePlan,
  fuelProjection,
} from "../public/engine.js";

test("workbook standard stint: floor tank/burn, lap time plus pit and tires", () => {
  const p = defaultPlan();
  p.config.reserve = 0;
  generate(p);
  const r = calculate(p).rows[0];
  assert.equal(r.laps, 11);
  assert.ok(Math.abs(r.fuel - 59.4) < 1e-9);
  assert.equal((r.end - r.start) / 1000, 11 * 203 + 70 + 30);
});
test("fuel reserve and fractional final stint do not exceed the tank or race horizon", () => {
  const p = generate(defaultPlan()),
    m = calculate(p);
  assert.equal(m.uncovered, 0);
  assert.equal(m.rows.at(-1).end, m.finish);
  for (const r of m.rows) {
    assert.ok(r.fuel <= p.config.tank);
    assert.ok(r.end > r.start);
  }
});
test("race ending during final pit service retains the full remaining time", () => {
  const p = defaultPlan();
  p.config.hours = (11 * 203 + 50) / 3600;
  generate(p);
  const m = calculate(p);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].service, 50);
  assert.equal(m.rows[0].end, m.finish);
});
test("actual end shifts next stint, actual laps inform projected total", () => {
  const p = generate(defaultPlan()),
    before = calculate(p);
  p.stints[0].actualEnd = new Date(before.rows[0].end + 90000).toISOString();
  p.stints[0].actualLaps = 9;
  const after = calculate(p);
  assert.equal(after.rows[1].start, before.rows[1].start + 90000);
  assert.equal(after.rows[0].delta, 90);
  assert.equal(after.rows[1].lapStart, 9);
  assert.equal(after.totals[p.stints[0].driverId].actual, 9);
});
test("availability detects any blocked half hour including day rollover", () => {
  const p = defaultPlan(),
    d = p.drivers[0],
    start = Date.UTC(2026, 0, 1, 23, 30);
  d.availability[1] = "blocked";
  assert.equal(
    availability(d, start + 20 * 60000, start + 45 * 60000, start),
    "blocked",
  );
  assert.equal(availability(d, start, start + 30 * 60000, start), "open");
});
test("generator avoids unavailable driver when others can cover", () => {
  const p = defaultPlan();
  p.drivers[0].availability.fill("blocked");
  generate(p);
  assert.ok(p.stints.every((s) => s.driverId !== p.drivers[0].id));
});
test("rest and consecutive stint warnings expose infeasible plans", () => {
  const p = generate(defaultPlan());
  p.drivers[0].maxStints = 1;
  p.stints[1].driverId = p.stints[0].driverId;
  assert.ok(calculate(p).rows[1].warnings.includes("Stint limit"));
  p.stints[1].driverId = p.drivers[1].id;
  p.stints[2].driverId = p.drivers[0].id;
  assert.ok(calculate(p).rows[2].warnings.includes("Short rest"));
});
test("driver/night pace multiplies driving time, not service time", () => {
  const p = generate(defaultPlan());
  p.config.simStartHour = 22;
  p.config.nightFactor = 1.02;
  p.drivers[0].pace = 1.03;
  const r = calculate(p).rows[0];
  assert.equal(r.pace, 203 * 1.02 * 1.03);
  assert.equal(r.service, 100);
});
test("saving mode uses separate lap and consumption inputs", () => {
  const p = generate(defaultPlan());
  p.config.saveBurn = 5;
  p.stints[0].mode = "save";
  p.stints[0].tires = false;
  const r = calculate(p).rows[0];
  assert.equal(r.laps, 12);
  assert.equal(r.pace, 205.03);
  assert.equal(r.service, 70);
});
test("fair-share follows source workbook quarter-share rule", () => {
  const p = generate(defaultPlan()),
    m = calculate(p);
  assert.equal(m.fairLaps, Math.ceil(m.lapTotal / 4 / 4));
});
test("invalid fuel inputs cannot create infinite schedules", () => {
  const p = defaultPlan();
  p.config.burn = 0;
  assert.throws(() => generate(p));
  p.config.burn = 100;
  assert.throws(() => validatePlan(p));
});
test("fuel projection preserves zero and includes one extra finishing lap", () => {
  assert.equal(fuelProjection(0, 5, 100, 200, 2).safeLaps, 0);
  assert.equal(fuelProjection(0, 5, 100, 200, 2).needed, 17);
  assert.equal(fuelProjection(20, null, 100, 200, 2), null);
});
