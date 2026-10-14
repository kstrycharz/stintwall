// Runs our own compiled client in an isolated test DOM; no browser or user UI.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
const html = fs.readFileSync("dist/index.html", "utf8");
const asset = html.match(/src="([^"]+\.js)"/)[1];
const bundle = fs.readFileSync(path.join("dist", asset), "utf8");
const source = JSON.parse(fs.readFileSync("public/workbook.json", "utf8"));
const errors = [],
  requests = [];
const console = new VirtualConsole();
console.on("jsdomError", (e) => {
  if (!e.message.includes("HTMLCanvasElement")) errors.push(e.message);
});
const dom = new JSDOM(html, {
  url: "https://example.test/stintwall/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole: console,
});
const w = dom.window,
  d = w.document;
w.structuredClone = structuredClone;
w.scrollTo = () => {};
w.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
w.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
w.HTMLCanvasElement.prototype.getContext = () => null; // Chart has no canvas in this unit-test DOM.
w.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
w.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
w.fetch = async (url) => {
  requests.push(String(url));
  assert.ok(
    String(url).includes("workbook-"),
    "Only the bundled example may be fetched",
  );
  return { ok: true, json: async () => source };
};
w.addEventListener("error", (e) => errors.push(e.error?.stack || e.message));
w.eval(bundle.replaceAll('import.meta.url', JSON.stringify(new URL(asset,'https://example.test/stintwall/').href)));
const settle = async () => {
  await new Promise((r) => setTimeout(r, 50));
};
await settle();
assert.match(
  d.querySelector("#save-status").textContent,
  /Saved in this browser/,
);
assert.equal(d.querySelectorAll(".step-card").length, 4);
assert.ok(d.querySelector("#stint-share-chart"));
const initial = JSON.parse(
  w.localStorage.getItem("stintwall:/stintwall/:plan:v1"),
);
assert.equal(initial.plan.drivers.length, 16);
assert.equal(initial.plan.stints.length, 45);
assert.ok(d.querySelector("#view").textContent.includes("407.833"));
d.querySelector('nav [data-view="strategy"]').click();
await settle();
assert.equal(d.querySelectorAll('input[name^="periodEnabled"]').length, 8);
assert.equal(d.querySelectorAll("[data-manual-duration]").length, 4);
d.querySelector('[name="track"]').value = "Static deployment test";
d.querySelector("#strategy-form").dispatchEvent(
  new w.Event("submit", { bubbles: true, cancelable: true }),
);
await settle();
assert.match(d.querySelector("#notice").textContent, /Strategy saved/);
assert.equal(
  JSON.parse(w.localStorage.getItem("stintwall:/stintwall/:plan:v1")).plan
    .track,
  "Static deployment test",
);
d.querySelector('nav [data-view="drivers"]').click();
await settle();
assert.equal(d.querySelectorAll(".driver-card").length, 16);
assert.ok(d.querySelector('[data-action="reset-availability"]'));
const first = d.querySelector("[data-availability]");
for (let i = 0; i < 3; i++) {
  d.querySelector(
    `[data-availability="${first.dataset.availability}"]`,
  ).click();
  await settle();
}
assert.ok(
  d
    .querySelector(`[data-availability="${first.dataset.availability}"]`)
    .classList.contains("unassigned"),
);
d.querySelector('nav [data-view="checklists"]').click();
await settle();
assert.equal(d.querySelectorAll("[data-check]").length, 8);
d.querySelector("#handover-button").click();
await settle();
assert.equal(d.querySelectorAll('#modal-content [name^="check"]').length, 8);
assert.ok(
  d
    .querySelector("#modal-content")
    .textContent.includes("Actual cumulative in-lap"),
);
d.querySelector("#modal-cancel").click();
d.querySelector('nav [data-view="workbook"]').click();
await settle();
assert.equal(d.querySelectorAll("#source-sheet option").length, 9);
const original = d.querySelector("a[download]");
assert.ok(original.href.includes("/stintwall/assets/"));
assert.ok(original.href.endsWith(".xlsx"));
d.querySelector('nav [data-view="schedule"]').click();
await settle();
assert.ok(
  d
    .querySelector("#schedule-table")
    .textContent.includes("Actual / projected in-lap"),
);
assert.ok(d.querySelector('[data-action="toggle-surplus"]'));
assert.deepEqual(errors, []);
assert.equal(requests.length, 1);
dom.window.close();
process.stdout.write(
  "Static application integration passed: setup/save, 8 periods, 4 fuel scenarios, 16 drivers, availability cycling, 8 checklist items, 9 source tabs, XLSX subpath and detailed schedule. No API calls.\n",
);
