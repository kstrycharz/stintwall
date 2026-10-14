import { test } from "node:test";
import assert from "node:assert/strict";
import { browserPlanStore } from "../public/storage.js";
const memory = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};
test("static plans survive saving and a fresh store instance", () => {
  const storage = memory(),
    a = browserPlanStore(storage, "/stintwall/");
  assert.deepEqual(a.load(), { revision: 0, plan: null });
  const plan = {
    schema: 1,
    notes: [{ text: "Private race note" }],
    drivers: [],
    stints: [],
  };
  assert.equal(a.save(plan, 0), 1);
  assert.deepEqual(browserPlanStore(storage, "/stintwall/").load(), {
    revision: 1,
    plan,
  });
});
test("a stale tab cannot overwrite a saved browser plan", () => {
  const storage = memory(),
    a = browserPlanStore(storage),
    b = browserPlanStore(storage);
  a.save({ name: "First window" }, 0);
  assert.throws(() => b.save({ name: "Stale window" }, 0), /Another tab/);
  assert.equal(a.load().plan.name, "First window");
});
test("storage errors remain visible rather than reporting a successful save", () => {
  const a = browserPlanStore({
    getItem: () => null,
    setItem: () => {
      throw Error("Quota exceeded");
    },
  });
  assert.throws(() => a.save({ name: "Plan" }, 0), /Quota exceeded/);
});
