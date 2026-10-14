import { TabulatorFull as Tabulator } from "tabulator-tables";
import { Timeline } from "vis-timeline/standalone";
import { DateTime, Duration } from "luxon";
import moment from "moment";
import { z } from "zod";
import "tabulator-tables/dist/css/tabulator_midnight.min.css";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";
import "./style.css";
import {
  defaultPlan,
  calculate,
  generate,
  validatePlan,
  colors,
  uid,
} from "./engine.js";
import Chart from "chart.js/auto";
import {
  raceSummary,
  fuelForDuration,
  availabilitySlots,
  resampleAvailability,
} from "./race-features.js";
import { workbookPlan } from "./workbook.js";
import workbookUrl from "./workbook.json?url";
import originalWorkbookUrl from "../Sassy Enduro Manager v0.08.1d (Example Live Schedule) - Dev version use at your peril.xlsx?url";
import { browserPlanStore } from "./storage.js";
const planStore = () =>
  browserPlanStore(localStorage, `stintwall:${location.pathname}`);
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : "—");
const duration = (s) =>
  Duration.fromObject({ seconds: Math.max(0, Math.floor(s)) }).toFormat(
    "hh:mm:ss",
  );
const time = (ms, offset = 0) =>
  DateTime.fromMillis(ms, { zone: "utc" })
    .plus({ hours: offset })
    .toFormat("HH:mm");
const datetime = (ms) =>
  DateTime.fromMillis(ms, { zone: "utc" }).toFormat("yyyy-MM-dd'T'HH:mm");
const lap = (v) =>
  `${Math.floor(v / 60)}:${(v % 60).toFixed(2).padStart(5, "0")}`;
let plan,
  source,
  revision = 0,
  view = "wall",
  table,
  timeline,
  shareChart,
  saveQueue = Promise.resolve(),
  saveBlocked = false,
  sourceSheet = "Overview";
const qty = (value) =>
  Number.isFinite(value)
    ? Number(value.toFixed(3)).toLocaleString("en-US", {
        maximumFractionDigits: 3,
      })
    : "—";
const simClock = (hour) =>
  `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.floor((hour % 1) * 60)).padStart(2, "0")}`;
const titles = {
  wall: ["Your race, at a glance", "RACE OVERVIEW"],
  strategy: ["Build your race plan", "01 / EVENT & STRATEGY"],
  drivers: ["Meet your rotation", "02 / DRIVERS & AVAILABILITY"],
  schedule: ["Every stint, accounted for", "03 / STINT SCHEDULE"],
  checklists: ["A smooth handover", "04 / CHECKLISTS & NOTES"],
  workbook: ["The complete workbook", "SOURCE / ALL NINE TABS"],
};
const planSchema = z
  .object({
    schema: z.literal(1),
    name: z.string().min(1).max(160),
    track: z.string().max(200),
    carNumber: z.string().max(20),
    drivers: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
            name: z.string().min(1).max(100),
            color: z.string().regex(/^#[0-9a-f]{6}$/i),
          })
          .passthrough(),
      )
      .min(1)
      .max(30),
    stints: z
      .array(
        z
          .object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })
          .passthrough(),
      )
      .max(1000),
    notes: z
      .array(z.object({ text: z.string().max(2000), ts: z.number() }))
      .max(1000),
    checks: z.record(z.string(), z.boolean()),
    strategy: z.record(z.string(), z.string()),
  })
  .passthrough();
const panel = (title, body, extra = "", caption = "") =>
  `<section class="panel ${extra}"><div class="panel-title"><h3>${title}</h3><span class="label">${caption}</span></div>${body}</section>`;
const model = () => calculate(plan);
function notify(message) {
  $("#notice").textContent = message;
  $("#notice").hidden = !message;
}
function cleanConnections(p) {
  delete p.hub;
  delete p.streamId;
  delete p.sessionId;
  p.drivers.forEach((d) => delete d.streamId);
  return p;
}
function save() {
  const snapshot = structuredClone(cleanConnections(plan));
  $("#save-status").textContent = "Saving your changes…";
  saveQueue = saveQueue
    .then(() => {
      if (saveBlocked)
        throw Error(
          "Another tab changed this plan. Export your changes before reloading.",
        );
      const store = planStore();
      // Save recovery separately, preserving a copy even when a revision conflicts.
      localStorage.setItem("stintwall-recovery", JSON.stringify(snapshot));
      revision = store.save(snapshot, revision);
      $("#save-status").textContent = "✓ Saved in this browser";
      return true;
    })
    .catch((e) => {
      notify(e.message + " Download a JSON backup to keep your changes.");
      $("#save-status").textContent = "Not saved · download a backup";
      return false;
    });
  return saveQueue;
}
window.addEventListener("storage", (event) => {
  if (event.key === planStore().key) {
    saveBlocked = true;
    notify(
      "Another tab updated this race plan. Export any unsaved changes before reloading.",
    );
  }
});
function currentRow(m) {
  return m.rows.find((r) => !r.actualEnd && !r.surplus);
}
function overviewFeatures() {
  const m = model(),
    s = raceSummary(plan, m),
    c = plan.config;
  const stats = [
    [
      "Average iRating",
      m.averageRating == null ? "—" : Math.round(m.averageRating),
    ],
    ["Ideal race laps", qty(m.idealLapTotal)],
    ["Projected race laps", qty(m.lapTotal)],
    ["Lap delta", qty(s.lapDelta)],
    ["Total timing delta", `${num(-m.timeDelta, 1)} s`],
    ["Time lost to lap delta", `${num(s.timeLost, 1)} s`],
    ["Ideal / projected fair laps", `${s.idealFairLaps} / ${m.fairLaps}`],
    [
      "Ideal / projected fair stints",
      `${s.idealFairStints} / ${s.projectedFairStints}`,
    ],
    [
      "Ideal / projected on-track duration",
      `${duration(c.hours * 3600)} / ${duration(s.actualOnTrack)}`,
    ],
    [
      "Race end UTC",
      DateTime.fromMillis(m.finish, { zone: "utc" }).toFormat("MMM d, HH:mm"),
    ],
    ["Sim race end", simClock((c.simStartHour + c.hours) % 24)],
  ];
  const fuelRows = [
    ["Standard", s.standard],
    ["Fuel saving", s.saving],
  ]
    .map(
      ([label, v]) =>
        `<tr><td>${label}</td><td>${lap(v.pace)}</td><td>${num(v.burn, 2)}</td><td>${v.laps}</td><td>${lap(v.lapWithPit)}</td><td>${duration(v.trackSeconds)}</td><td>${duration(v.withPitSeconds)}</td><td>${num(v.fuel, 2)}</td></tr>`,
    )
    .join("");
  return `<div class="section-gap">${panel("Overview calculations", `<div class="panel-body calculation-grid">${stats.map(([label, value]) => `<div><span class="label">${label}</span><strong>${value}</strong></div>`).join("")}</div>`)}</div><div class="section-gap">${panel("Fuel stint averages", `<div class="table-scroll"><table><thead><tr><th>Mode</th><th>Lap time</th><th>L/lap</th><th>Laps</th><th>Lap with pit</th><th>Track time</th><th>With pit</th><th>Fuel L</th></tr></thead><tbody>${fuelRows}</tbody></table></div>`)}</div><div class="section-gap grid2">${panel(
    "Final stint fuel calculator",
    `<div class="panel-body">${
      s.final
        ? `<p>Stint ${s.final.index} · ${time(s.final.start)}–${time(m.finish)} UTC · ${duration((m.finish - s.final.start) / 1000)}</p><div class="fuel-result">${[
            ["Standard", s.finalStandard],
            ["Fuel saving", s.finalSaving],
          ]
            .map(
              ([label, v]) =>
                `<div><span>${label}</span><strong>${num(v.fuel, 2)} L</strong><small>With one extra lap: ${num(v.withExtraLap, 2)} L</small></div>`,
            )
            .join("")}</div>`
        : "<p>Add enough stints to cover the race to calculate final-stint fuel.</p>"
    }</div>`,
  )}${panel("Driver stint percentages", '<div class="panel-body"><div class="chart-area"><canvas id="stint-share-chart" aria-label="Driver stint percentages" role="img"></canvas></div><p class="detail-note">Percentage of required fuel stints per driver. Surplus stints are excluded.</p></div>')}</div>`;
}
function mountShareChart() {
  const m = model();
  shareChart = new Chart($("#stint-share-chart"), {
    type: "doughnut",
    data: {
      labels: plan.drivers.map((d) => d.name),
      datasets: [
        {
          data: plan.drivers.map((d) => m.totals[d.id].stints),
          backgroundColor: plan.drivers.map((d) => d.color),
          borderColor: "#101114",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "35%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#bcbcc4", boxWidth: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const sum = context.dataset.data.reduce((a, b) => a + b, 0);
              return `${context.label}: ${context.raw} stints (${num((context.raw / Math.max(1, sum)) * 100, 1)}%)`;
            },
          },
        },
      },
    },
  });
}
function manualFuelRows() {
  const values = plan.manualDurations || [95, 97.5, 100, 128.917];
  return `<div class="section-gap">${panel(
    "Manual fuel duration scenarios",
    `<div class="panel-body"><p class="detail-note">The workbook’s four independent duration inputs. Values save with the race plan. Extra-lap columns add one lap of the relevant mode.</p><div class="table-scroll"><table><thead><tr><th>Driving minutes</th><th>Standard L</th><th>Saving L</th><th>Standard +1 lap L</th><th>Saving +1 lap L</th></tr></thead><tbody>${values
      .map((minutes, i) => {
        const a = fuelForDuration(plan.config, minutes * 60),
          b = fuelForDuration(plan.config, minutes * 60, true);
        return `<tr><td><input data-manual-duration="${i}" type="number" min="0" step="any" value="${minutes}" aria-label="Scenario ${i + 1} driving minutes"></td><td>${num(a.fuel, 3)}</td><td>${num(b.fuel, 3)}</td><td>${num(a.withExtraLap, 3)}</td><td>${num(b.withExtraLap, 3)}</td></tr>`;
      })
      .join("")}</tbody></table></div></div>`,
  )}</div>`;
}
function availabilityDetail() {
  const m = model(),
    slots = availabilitySlots(
      plan,
      m,
      Boolean(plan.ui?.showAvailabilitySurplus),
    );
  return `<div class="section-gap">${panel("Availability times and mapped stints", `<div class="panel-body"><button data-action="toggle-availability-surplus">${plan.ui?.showAvailabilitySurplus ? "Hide" : "Show"} surplus availability slots</button><p class="detail-note">Every overlapping stint is included when a slot crosses a handover. Local times use each driver's UTC offset.</p></div><div class="table-scroll"><table><thead><tr><th>UTC start</th><th>UTC end</th><th>Overlapping stints</th>${plan.drivers.map((d) => `<th style="color:${d.color}">${esc(d.name)} local</th>`).join("")}</tr></thead><tbody>${slots.map((slot) => `<tr class="${slot.surplus ? "surplus-row" : ""}"><td>${time(slot.start)}</td><td>${time(slot.end)}</td><td>${slot.surplus ? "Surplus" : slot.stints.join(", ") || "Unscheduled"}</td>${slot.drivers.map((d) => `<td><button class="${d.status}" data-availability="${d.id}:${slot.index}" title="${esc(d.status)}">${time(d.localStart)} · ${esc(d.status)}</button></td>`).join("")}</tr>`).join("")}</tbody></table></div>`)}</div>`;
}
function wallView() {
  const m = model(),
    r = currentRow(m),
    total = m.rows.filter((r) => !r.surplus).length;
  const metrics = [
    ["PROJECTED LAPS", qty(m.lapTotal), "Calculated from fuel and pace"],
    ["DRIVERS", plan.drivers.length, "Your complete team roster"],
    [
      "PLANNED STINTS",
      total,
      `${m.rows.filter((r) => r.actualEnd).length} recorded`,
    ],
    [
      "NEEDS ATTENTION",
      m.warnings,
      m.uncovered
        ? `${duration(m.uncovered)} uncovered`
        : "Full race time scheduled",
    ],
  ];
  return `<section class="welcome"><div><span class="eyebrow">YOUR ENDURANCE WORKSPACE</span><h2>Make the next stint<br><em>a good one.</em></h2><p>Set the strategy. Share the driving. Keep the details.</p><button class="primary" data-view="strategy">Edit race setup ↗</button><button data-view="schedule">Open schedule</button></div><div class="race-orbit"><div class="orbit-ring"></div><div class="orbit-center"><strong>${num(plan.config.hours, 1)}<small>HOURS</small></strong><span>${plan.drivers.length} drivers · one team</span></div><span class="orbit-dot"></span></div></section>
 ${plan.sourceNote ? `<div class="source-note">${esc(plan.sourceNote)} <button class="small-button" data-view="strategy">Update event dates</button></div>` : ""}
 <div class="metrics">${metrics.map(([label, value, note]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`).join("")}</div>
 <div class="step-grid">${[
   ["strategy", "01", "Race setup", "Dates, fuel, pace and team strategy"],
   ["drivers", "02", "Drivers", "Roster, local times and availability"],
   ["schedule", "03", "Stint schedule", "Assignments, pit stops and actuals"],
   ["checklists", "04", "Handover", "Check the details and record the swap"],
 ]
   .map(
     ([v, n, t, d]) =>
       `<button class="step-card" data-view="${v}"><span>${n}</span><strong>${t}</strong><small>${d}</small><b>↗</b></button>`,
   )
   .join("")}</div>
 <div class="grid2">${panel("Next unrecorded stint", `<div class="panel-body">${r ? `<div class="next-driver"><span class="avatar" style="color:${r.driver?.color}">${esc(r.driver?.name?.slice(0, 2) || "?")}</span><div><h2>${esc(r.driver?.name || "Assign a driver")}</h2><p>Stint ${r.index} · ${time(r.start)}–${time(r.end)} UTC · ${qty(r.laps)} laps</p></div></div><div class="between"><span>Fuel to load</span><strong>${num(r.fuel)} L</strong></div><div class="between"><span>Strategy</span><strong>${r.mode === "save" ? "Fuel saving" : "Standard"} · ${r.tires ? "Change tires" : "Keep tires"}</strong></div><button class="primary" data-action="handover">Record this handover</button>` : '<p>All planned stints have results, or your schedule is empty.</p><button data-view="schedule">Review schedule</button>'}</div>`)}${panel(
   "Plan health",
   `<div class="panel-body"><p class="muted">${m.warnings ? "Review these assignments before the race." : "Your planned assignments have no availability or rest conflicts."}</p><div class="health-list">${
     m.rows
       .filter((r) => r.warnings.length && !r.surplus)
       .slice(0, 5)
       .map(
         (r) =>
           `<button data-edit-stint="${r.id}"><span>Stint ${r.index} · ${esc(r.driver?.name || "Unassigned")}</span><small class="amber">${esc(r.warnings.join(" · "))}</small></button>`,
       )
       .join("") || '<div class="good">✓ No assignment conflicts</div>'
   }</div><p class="detail-note">Fair share: ${m.fairLaps} laps per driver. ${duration(m.uncovered)} race time uncovered.</p></div>`,
 )}</div><div class="section-gap">${panel(
   "Driving share",
   `<div class="panel-body share-chart">${plan.drivers
     .map((d) => {
       const t = m.totals[d.id];
       return `<div><span>${esc(d.name)}</span><div class="share-track"><i style="width:${Math.min(100, (t.seconds / (plan.config.hours * 3600)) * 100)}%;background:${d.color}"></i></div><small>${qty(t.laps)} planned / ${t.actual} recorded laps · ${duration(t.seconds)}</small></div>`;
     })
     .join("")}</div>`,
   "",
   "PLANNED TIME & RECORDED LAPS",
 )}</div>`;
}
function scheduleView() {
  const m = model();
  return `<div class="toolbar"><p>Click any stint to edit. Actual results automatically shift the next start.</p><div class="actions"><button data-action="toggle-surplus">${plan.ui?.showSurplus ? "Hide" : "Show"} surplus</button><button data-action="unassign-surplus">Unassign surplus</button><button data-action="csv">Export CSV</button><button data-action="add-stint">+ Add stint</button><button class="primary" data-action="generate">Generate rotation</button></div></div><div class="stats-strip"><div><span class="label">PROJECTED LAPS</span><strong>${qty(m.lapTotal)}</strong></div><div><span class="label">FAIR SHARE</span><strong>${m.fairLaps} laps</strong></div><div><span class="label">CONFLICTS</span><strong>${m.warnings}</strong></div><div><span class="label">UNCOVERED</span><strong>${duration(m.uncovered)}</strong></div></div>${panel("The driver rotation", '<div id="schedule-timeline"></div>', "", "UTC · CLICK TO EDIT")}<div class="section-gap">${panel("Every stint", '<div id="schedule-table"></div>', "", "PLANNED & RECORDED")}</div><p class="detail-note">Final stints stop at the race boundary. Toggle surplus rows without deleting them. Fuel includes your reserve. Times use UTC; driver local time uses their fixed offset.</p>`;
}
function checklistsView() {
  const cells = (plan.sourceWorkbook || source).sheets.find(
    (s) => s.name === "Checklists",
  ).cells;
  const items = Object.entries(cells)
    .filter(([ref, c]) => /^C(3|4|5|6|8|9|10|11)$/.test(ref))
    .map(([ref, c]) => [ref, c.value]);
  return `<div class="grid2">${panel("Before and after the swap", `<div class="panel-body"><p class="muted">Reusable preparation checklist. Each recorded handover also keeps its own checklist.</p>${items.map(([ref, text]) => `<label class="check-row"><input type="checkbox" data-check="source-${ref}" ${plan.checks["source-" + ref] ? "checked" : ""}>${esc(text)}</label>`).join("")}<button class="primary" data-action="handover">Record driver handover</button></div>`)}${panel(
    "Team notebook",
    `<div class="panel-body"><button data-action="note">+ Add a note</button><div class="notes">${
      [...plan.notes]
        .reverse()
        .map(
          (n) =>
            `<article><small>${DateTime.fromSeconds(n.ts, { zone: "utc" }).toFormat("MMM d · HH:mm")} UTC</small><p>${esc(n.text)}</p></article>`,
        )
        .join("") ||
      '<p class="muted">Setup changes, reminders, decisions. Keep them here.</p>'
    }</div></div>`,
  )}</div>`;
}
function workbookView() {
  const w = plan.sourceWorkbook || source;
  return `<div class="source-note">Original workbook snapshot. Values are cached Excel results; formulas here are preserved for reference. App calculations update in Setup and Schedule.</div><div class="toolbar"><select id="source-sheet" aria-label="Workbook sheet">${w.sheets.map((s) => `<option ${s.name === sourceSheet ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select><input id="source-search" placeholder="Search cells, values or formulas…" aria-label="Search workbook"><a class="import-button" href="${originalWorkbookUrl}" download>↓ Original XLSX</a></div>${panel("All source data", '<div id="source-table"></div>', "", "SEARCHABLE · FORMULAS PRESERVED")}<details class="panel-body"><summary>Named ranges (${w.names.length})</summary><pre>${esc(w.names.map((n) => n.name + " = " + n.value).join("\n"))}</pre></details>`;
}
function mountWorkbook() {
  const w = plan.sourceWorkbook || source;
  const rows = Object.entries(
    w.sheets.find((s) => s.name === sourceSheet).cells,
  ).map(([ref, c]) => ({
    ref,
    value: c.value,
    formula:
      "formula" in c
        ? "=" +
          c.formula +
          (c.formulaAttributes?.t === "shared" && !c.formula
            ? " [shared formula " + c.formulaAttributes.si + "]"
            : "")
        : "",
  }));
  table = new Tabulator($("#source-table"), {
    data: rows,
    height: 550,
    layout: "fitColumns",
    columns: [
      { title: "Cell", field: "ref", width: 100 },
      {
        title: "Original value",
        field: "value",
        formatter: "plaintext",
        minWidth: 250,
      },
      {
        title: "Excel formula",
        field: "formula",
        formatter: "plaintext",
        minWidth: 400,
      },
    ],
  });
  $("#source-sheet").onchange = (e) => {
    sourceSheet = e.target.value;
    render();
  };
  $("#source-search").oninput = (e) => {
    const query = e.target.value.toLowerCase();
    table.setFilter((r) =>
      [r.ref, r.value, r.formula].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(query),
      ),
    );
  };
}
function render() {
  if (!plan) return;
  shareChart?.destroy();
  shareChart = null;
  table?.destroy();
  timeline?.destroy();
  table = timeline = null;
  const [title, crumb] = titles[view];
  $("#page-title").textContent = title;
  $("#breadcrumb").textContent = crumb;
  $("#race-subtitle").textContent = `${plan.name} / ${plan.track}`;
  $("#team-label").textContent = `CAR #${plan.carNumber}`;
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#view").innerHTML = {
    wall: () => wallView() + overviewFeatures(),
    strategy: () => strategyView() + manualFuelRows(),
    drivers: () => driversView() + availabilityDetail(),
    schedule: scheduleView,
    checklists: checklistsView,
    workbook: workbookView,
  }[view]();
  if (view === "schedule") mountSchedule();
  if (view === "strategy") mountStrategy();
  if (view === "wall") mountShareChart();
  if (view === "workbook") mountWorkbook();
}
function mountSchedule() {
  const m = model();
  timeline = new Timeline(
    $("#schedule-timeline"),
    m.rows
      .filter((r) => !r.surplus)
      .map((r) => ({
        id: r.id,
        group: r.driverId || "unassigned",
        start: new Date(r.start),
        end: new Date(r.end),
        content: `${r.index} · ${qty(r.laps)} laps`,
        style: `background:${r.driver?.color || "#778899"};color:#111820;border:0`,
        title: `${time(r.start)}–${time(r.end)} UTC`,
      })),
    [
      ...plan.drivers.map((d) => ({ id: d.id, content: esc(d.name) })),
      { id: "unassigned", content: "Unassigned" },
    ],
    {
      start: new Date(m.start),
      end: new Date(m.finish),
      min: new Date(m.start - 3600000),
      max: new Date(m.finish + 3600000),
      stack: false,
      zoomMin: 3600000,
      zoomMax: 72 * 3600000,
      showCurrentTime: true,
      orientation: "top",
      height: `${Math.max(280, (plan.drivers.length + 1) * 34 + 80)}px`,
      moment: (date) => moment.utc(date),
    },
  );
  timeline.on("select", (p) => {
    if (p.items.length) editStint(p.items[0]);
  });
  table = new Tabulator($("#schedule-table"), {
    data: plan.ui?.showSurplus ? m.rows : m.rows.filter((r) => !r.surplus),
    layout: "fitDataStretch",
    height: 480,
    index: "id",
    placeholder: "Generate a rotation or add the first stint.",
    rowFormatter: (row) =>
      row
        .getElement()
        .classList.toggle(
          "highlighted-stint",
          Boolean(row.getData().highlight),
        ),
    columns: [
      { title: "#", field: "index", width: 55, frozen: true },
      {
        title: "Edit",
        headerSort: false,
        width: 65,
        frozen: true,
        formatter: () => "<button class=small-button>Edit</button>",
        cellClick: (_, c) => editStint(c.getRow().getData().id),
      },
      {
        title: "Driver",
        field: "driver.name",
        formatter: (c) =>
          `<span style="color:${c.getRow().getData().driver?.color || "#a9aab3"}">${esc(c.getValue())}</span>`,
        minWidth: 130,
      },
      {
        title: "UTC start",
        field: "start",
        formatter: (c) => time(c.getValue()),
      },
      { title: "UTC end", field: "end", formatter: (c) => time(c.getValue()) },
      {
        title: "Driver local",
        field: "start",
        formatter: (c) =>
          time(c.getValue(), c.getRow().getData().driver?.offset || 0),
      },
      { title: "Mode", field: "mode", formatter: "plaintext" },
      { title: "Tires", field: "tires", formatter: "tickCross" },
      { title: "Laps", field: "laps", formatter: (c) => qty(c.getValue()) },
      {
        title: "Ideal in-lap",
        field: "idealInLap",
        formatter: (c) => qty(c.getValue()),
      },
      {
        title: "Actual / projected in-lap",
        field: "inLap",
        formatter: (c) => qty(c.getValue()),
      },
      {
        title: "Lap delta",
        field: "lapDelta",
        formatter: (c) => qty(c.getValue()),
      },
      { title: "Fuel L", field: "fuel", formatter: (c) => num(c.getValue()) },
      {
        title: "Actual laps",
        field: "actualLaps",
        formatter: (c) => (c.getValue() == null ? "—" : qty(c.getValue())),
      },
      {
        title: "Sim start",
        field: "simStartHour",
        formatter: (c) => simClock(c.getValue()),
      },
      {
        title: "Sim end",
        field: "simEndHour",
        formatter: (c) => simClock(c.getValue()),
      },
      {
        title: "Local end",
        field: "end",
        formatter: (c) =>
          time(c.getValue(), c.getRow().getData().driver?.offset || 0),
      },
      { title: "Time factor", field: "timeFactor" },
      { title: "Driver factor", field: "driverFactor" },
      { title: "Damage s/lap", field: "damage" },
      { title: "Consecutive", field: "consecutive" },
      { title: "Preference", field: "driver.maxStints" },
      { title: "Driver ID", field: "driver.sourceId", formatter: "plaintext" },
      { title: "Final stint", field: "final", formatter: "tickCross" },
      {
        title: "Delta",
        field: "delta",
        formatter: (c) =>
          c.getValue() == null
            ? "—"
            : `${c.getValue() >= 0 ? "+" : ""}${num(c.getValue(), 0)}s`,
      },
      {
        title: "Status",
        field: "status",
        formatter: (c) => {
          const r = c.getRow().getData();
          return esc(
            r.surplus
              ? "Surplus"
              : r.warnings.length
                ? r.warnings.join(" · ")
                : r.actualEnd
                  ? "Recorded"
                  : r.status,
          );
        },
      },
      {
        title: "",
        headerSort: false,
        formatter: () => '<button class="small-button">Edit</button>',
        cellClick: (_, c) => editStint(c.getRow().getData().id),
      },
    ],
  });
}
function driversView() {
  const m = model();
  return `<div class="toolbar"><p>Availability uses ${plan.config.availabilityMinutes || 30}-minute blocks. Click to cycle Open → Tentative → Blocked → Unassigned.</p><div class="actions"><button data-action="reset-availability">Reset availability</button><button data-action="refresh-colors">Update driver colors</button><button data-action="add-driver">+ Add driver</button></div></div><div class="driver-cards">${plan.drivers
    .map((d) => {
      const t = m.totals[d.id];
      return `<section class="panel driver-card"><div class="driver-banner"><div class="avatar" style="color:${d.color};border-color:${d.color}">${esc(
        d.name
          .split(" ")
          .map((x) => x[0])
          .join("")
          .slice(0, 2),
      )}</div><div><h3>${esc(d.name)}</h3><small>UTC${d.offset >= 0 ? "+" : ""}${d.offset} · ${num(d.pace, 3)}× pace</small></div></div><div class="between"><span class="muted">Scheduled</span><strong>${t.stints} stints · ${duration(t.seconds)}</strong></div><div class="between"><span class="muted">Planned / recorded laps</span><strong>${qty(t.laps)} / ${t.actual}</strong></div><div class="between"><span class="muted">Fair-share target</span><strong class="${t.laps >= m.fairLaps ? "good" : "amber"}">${qty(t.laps)} / ${m.fairLaps}</strong></div><div class="bar"><span style="width:${Math.min(100, (t.laps / Math.max(1, m.fairLaps)) * 100)}%;background:${d.color}"></span></div><div class="between"><span class="label">${"Available for planning"}</span><button class="small-button" data-edit-driver="${d.id}">Edit driver</button></div></section>`;
    })
    .join("")}</div>${panel(
    "Driver availability",
    `<div class="table-scroll"><table class="availability"><thead><tr><th>DRIVER / UTC</th>${Array.from({ length: Math.ceil((plan.config.hours * 60) / (plan.config.availabilityMinutes || 30)) }, (_, i) => `<th>${time(m.start + i * (plan.config.availabilityMinutes || 30) * 60000)}</th>`).join("")}</tr></thead><tbody>${plan.drivers
      .map(
        (d) =>
          `<tr><td>${esc(d.name)}</td>${Array.from(
            {
              length: Math.ceil(
                (plan.config.hours * 60) /
                  (plan.config.availabilityMinutes || 30),
              ),
            },
            (_, i) => {
              const s = d.availability[i] || "open";
              return `<td><button class="${s}" data-availability="${d.id}:${i}" aria-label="${esc(d.name)}, ${time(m.start + i * (plan.config.availabilityMinutes || 30) * 60000)} UTC, ${s}">${s === "open" ? "✓" : s === "blocked" ? "×" : s === "unassigned" ? "—" : "?"}</button></td>`;
            },
          ).join("")}</tr>`,
      )
      .join("")}</tbody></table></div>`,
    "",
    "✓ OPEN · ? TENTATIVE · × BLOCKED · — UNASSIGNED",
  )}`;
}
const field = (name, label, value, type = "number", extra = "") =>
  `<label class="field">${esc(label)}<input name="${name}" type="${type}" value="${esc(typeof value === "number" ? Math.round(value * 1000) / 1000 : value)}" ${extra}></label>`;
function strategyView() {
  const c = plan.config;
  return `<form id="strategy-form"><div class="grid2">${panel("Race configuration", `<div class="panel-body form-grid">${field("name", "Event name", plan.name, "text", "required")}${field("track", "Circuit", plan.track, "text", "required")}${field("carNumber", "Team car number", plan.carNumber, "text", "required")}${field("hours", "Race duration · hours", c.hours, "number", 'min="0.5" max="72" step="0.5" required')}${field("sessionStart", "Session start · UTC", datetime(Date.parse(c.sessionStart || c.start)), "datetime-local", "required")}${field("greenOffset", "Minutes until green flag", c.greenOffset ?? 0, "number", 'min="0" step="1" required')}${field("start", "Green flag · UTC", datetime(Date.parse(c.start)), "datetime-local", "required")}${field("simStartHour", "Sim time at green · decimal hour", c.simStartHour, "number", 'min="0" max="23.99" step="0.01" required')}${field("minRest", "Minimum driver rest · minutes", c.minRest, "number", 'min="0" required')}${field("availabilityMinutes", "Availability interval · minutes", c.availabilityMinutes || 30, "number", 'min="1" max="120" step="1" required')}${field("fairShare", "Fair-share fraction", c.fairShare, "number", 'min="0" max="1" step="0.01" required')}</div>`)}${panel("Fuel, pace & service", `<div class="panel-body form-grid">${field("tank", "Tank capacity · L", c.tank, "number", 'min="1" step="0.1" required')}${field("reserve", "Fuel reserve · L", c.reserve, "number", 'min="0" step="0.1" required')}${field("lap", "Standard lap · seconds", c.lap, "number", 'min="1" step="0.001" required')}${field("burn", "Standard consumption · L/lap", c.burn, "number", 'min="0.01" step="0.01" required')}${field("saveLap", "Fuel-saving lap · seconds", c.saveLap, "number", 'min="1" step="0.001" required')}${field("saveBurn", "Fuel-saving consumption · L/lap", c.saveBurn, "number", 'min="0.01" step="0.01" required')}${field("pit", "Pit loss / fuel service · seconds", c.pit, "number", 'min="0" required')}${field("tires", "Additional tire service · seconds", c.tires, "number", 'min="0" required')}<label class="check-row"><input type="checkbox" name="addTireTime" ${c.addTireTime !== false ? "checked" : ""}>Include tire change time</label><p class="detail-note">Workbook calculations apply pace factors to tire time as in the source. Use 0 if it overlaps fuel service. The final stint uses the workbook’s fractional-lap calculation.</p></div>`)}</div><div class="section-gap">${panel("Time-of-day pace", `<div class="panel-body form-grid">${(c.periods || []).map((v, i) => `<label class="check-row"><input type="checkbox" name="periodEnabled${i}" ${v.enabled !== false ? "checked" : ""}>${esc(v.name)} enabled</label>` + field("periodHour" + i, v.name + " start · sim hour", v.hour, "number", 'min="0" max="23.99" step="0.01" required') + field("periodFactor" + i, v.name + " pace factor", v.factor, "number", 'min="0.1" step="0.001" required')).join("")}</div>`)}<div class="section-gap">${panel("Team strategy", `<div class="panel-body form-grid">${field("qualifier", "Qualifying driver", plan.strategy.qualifier, "text")}${field("comms", "Backup communications", plan.strategy.comms, "text")}${field("setup", "Setup reference", plan.strategy.setup, "text")}${field("registering", "Registering drivers", plan.strategy.registering, "text")}${field("practice", "Practice schedule", plan.strategy.practice, "text")}${field("retirement", "Retirement conditions", plan.strategy.retirement, "text")}<label class="field form-span">Team goals<textarea name="goal">${esc(plan.strategy.goal)}</textarea></label></div>`)}</div></div><div class="form-actions"><button class="primary" type="submit">Save strategy & recalculate</button></div></form><div class="section-gap">${panel("Manual fuel calculator", `<div class="panel-body"><label class="field">Target driving time · minutes<input id="fuel-minutes" type="number" value="38" min="0" step="1"></label><div id="fuel-result" class="fuel-result" role="status"></div><p class="detail-note">Uses the fuel and pace values currently in the form. Shows continuous fuel requirements, reserve, and a separate one-extra-lap amount. Amounts above tank capacity need a stop.</p></div>`)}</div>`;
}
function mountStrategy() {
  function fuelCalc() {
    const minutes = Number($("#fuel-minutes").value),
      f = $("#strategy-form").elements;
    const output = [
      ["Standard", "lap", "burn"],
      ["Fuel saving", "saveLap", "saveBurn"],
    ]
      .map(([label, pace, burn]) => {
        const seconds = Number(f[pace].value),
          rate = Number(f[burn].value),
          reserve = Number(f.reserve.value),
          tank = Number(f.tank.value);
        if (
          !Number.isFinite(minutes) ||
          minutes < 0 ||
          seconds <= 0 ||
          rate <= 0
        )
          return "<span>Enter valid driving time, pace and consumption.</span>";
        const laps = (minutes * 60) / seconds,
          fuel = laps * rate + reserve;
        return `<div><span>${label}</span><strong>${num(fuel)} L</strong><small>${qty(laps)} laps · with one extra lap: ${num(fuel + rate, 2)} L · ${fuel > tank ? "Exceeds tank capacity" : "Fits in tank"}</small></div>`;
      })
      .join("");
    $("#fuel-result").innerHTML = output;
  }
  $("#fuel-minutes").oninput = fuelCalc;
  $("#strategy-form").addEventListener("input", fuelCalc);
  fuelCalc();
  const form = $("#strategy-form");
  ["sessionStart", "greenOffset"].forEach((k) =>
    form.elements[k].addEventListener("input", () => {
      const date = DateTime.fromISO(form.elements.sessionStart.value, {
        zone: "utc",
      }).plus({ minutes: Number(form.elements.greenOffset.value) });
      if (date.isValid)
        form.elements.start.value = date.toFormat("yyyy-MM-dd'T'HH:mm");
    }),
  );
  form.elements.start.addEventListener("input", () => {
    const start = DateTime.fromISO(form.elements.start.value, { zone: "utc" });
    const session = DateTime.fromISO(form.elements.sessionStart.value, {
      zone: "utc",
    });
    if (start.isValid && session.isValid)
      form.elements.greenOffset.value = Math.max(
        0,
        start.diff(session, "minutes").minutes,
      );
  });
  $("#strategy-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const f = new FormData(e.target),
        next = structuredClone(plan);
      for (const k of ["name", "track", "carNumber"]) next[k] = f.get(k).trim();
      for (const k of [
        "hours",
        "tank",
        "reserve",
        "lap",
        "burn",
        "saveLap",
        "saveBurn",
        "pit",
        "tires",
        "simStartHour",
        "fairShare",
        "minRest",
        "start",
      ])
        next.config[k] =
          k === "start"
            ? DateTime.fromISO(f.get(k), { zone: "utc" }).toISO()
            : Number(f.get(k));
      resampleAvailability(next, Number(f.get("availabilityMinutes")));
      next.config.addTireTime = Boolean(f.get("addTireTime"));
      next.config.workbookMath = true;
      next.config.sessionStart = DateTime.fromISO(f.get("sessionStart"), {
        zone: "utc",
      }).toISO();
      next.config.greenOffset = Number(f.get("greenOffset"));
      next.config.periods = (next.config.periods || []).map((v, i) => ({
        ...v,
        enabled: Boolean(f.get("periodEnabled" + i)),
        hour: Number(f.get("periodHour" + i)),
        factor: Number(f.get("periodFactor" + i)),
      }));
      for (const k of Object.keys(next.strategy)) next.strategy[k] = f.get(k);
      validatePlan(next);
      if (plan.sourceNote && next.config.start !== plan.config.start)
        delete next.sourceNote;
      plan = next;
      const saved = await save();
      render();
      if (saved)
        notify(
          "Strategy saved. Existing stint assignments were preserved and timings recalculated.",
        );
    } catch (e) {
      notify(e.message);
    }
  };
}

function openModal(title, html, onSubmit, submit = "Save") {
  document.querySelector("#remove-record")?.remove();
  $("#modal-title").textContent = title;
  $("#modal-content").innerHTML =
    html + '<div class="dialog-error" role="alert"></div>';
  $("#modal-submit").textContent = submit;
  $("#modal-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await onSubmit(new FormData(e.target));
      $("#modal").close();
      render();
    } catch (err) {
      $(".dialog-error").textContent = err.message;
    }
  };
  $("#modal").showModal();
}
function removalButton(label, action) {
  const button = document.createElement("button");
  button.id = "remove-record";
  button.type = "button";
  button.className = "bad";
  button.textContent = label;
  button.onclick = action;
  document.querySelector(".dialog-actions").prepend(button);
}
function editStint(id) {
  const s = plan.stints.find((s) => s.id === id),
    r = model().rows.find((r) => r.id === id);
  if (!s) return;
  openModal(
    "Edit stint " + r.index,
    `<div class="form-grid"><label class="field">Driver<select name="driverId"><option value="">Unassigned</option>${plan.drivers.map((d) => `<option value="${d.id}" ${s.driverId === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label><label class="field">Fuel strategy<select name="mode"><option value="standard" ${s.mode === "standard" ? "selected" : ""}>Standard</option><option value="save" ${s.mode === "save" ? "selected" : ""}>Fuel saving</option></select></label><label class="field">Tires<select name="tires"><option value="yes" ${s.tires ? "selected" : ""}>Change tires</option><option value="no" ${!s.tires ? "selected" : ""}>Keep tires</option></select></label><label class="check-row"><input type="checkbox" name="highlight" ${s.highlight ? "checked" : ""}>Highlight this stint</label>${field("damage", "Damage · seconds/lap (blank inherits previous)", "damageOverride" in s ? (s.damageOverride ?? "") : s.damage, "number", 'min="0" step="0.1"')}${field("actualEnd", "Actual back-on-track time · UTC", s.actualEnd ? datetime(Date.parse(s.actualEnd)) : "", "datetime-local")}${field("actualInLap", "Actual cumulative in-lap", s.actualInLap ?? "", "number", 'min="0" step="1"')}<p class="detail-note">Previous in-lap: ${qty(r.lapStart)}. Planned in-lap: ${qty(r.idealInLap)}. Actual stint laps are derived from the difference.</p><p class="detail-note form-span">Planned ${time(r.start)}–${time(r.plannedEnd)} UTC. Actual end means the car is back on track, including pit service. Updating actuals shifts subsequent stints.</p></div>`,
    async (f) => {
      const updated = {
        ...s,
        driverId: f.get("driverId"),
        mode: f.get("mode"),
        tires: f.get("tires") === "yes",
        damage: Number(f.get("damage")),
        damageOverride: f.get("damage") === "" ? null : Number(f.get("damage")),
        highlight: Boolean(f.get("highlight")),
        actualEnd: f.get("actualEnd")
          ? DateTime.fromISO(f.get("actualEnd"), { zone: "utc" }).toISO()
          : null,
        actualLaps: f.get("actualInLap") === "" ? s.actualLaps : null,
        actualInLap:
          f.get("actualInLap") === "" ? null : Number(f.get("actualInLap")),
      };
      if (updated.actualInLap != null && updated.actualInLap < r.lapStart)
        throw Error("In-lap must not precede the previous stint’s in-lap.");
      if (updated.actualEnd && Date.parse(updated.actualEnd) <= r.start)
        throw Error("Actual end must be after stint start.");
      const next = structuredClone(plan);
      next.stints[next.stints.findIndex((x) => x.id === id)] = updated;
      validatePlan(next);
      plan = next;
      await save();
    },
  );
  if (!s.actualEnd && s.actualLaps == null && s.actualInLap == null)
    removalButton("Remove stint", () =>
      openModal(
        "Remove planned stint?",
        "<p>The following stints will move earlier. Recorded stint results are preserved.</p>",
        async () => {
          plan.stints = plan.stints.filter((row) => row.id !== id);
          await save();
        },
        "Remove stint",
      ),
    );
}
function editDriver(id) {
  const d = plan.drivers.find((d) => d.id === id) || {
    id: uid(),
    name: "",
    color: colors[plan.drivers.length % colors.length],
    offset: 0,
    pace: 1,
    maxStints: 3,
    streamId: "",
    availability: Array(
      Math.ceil(
        (plan.config.hours * 60) / (plan.config.availabilityMinutes || 30),
      ),
    ).fill("open"),
  };
  openModal(
    id ? "Edit driver" : "Add driver",
    `<div class="form-grid">${field("name", "Driver name", d.name, "text", 'required maxlength="100"')}${field("color", "Driver color", d.color, "color")}${field("offset", "UTC offset · hours", d.offset, "number", 'min="-14" max="14" step="0.25" required')}${field("pace", "Pace factor", d.pace, "number", 'min="0.1" step="0.001" required')}${field("maxStints", "Maximum consecutive stints", d.maxStints, "number", 'min="1" max="20" required')}${field("rating", "iRating", d.rating ?? "", "number", 'min="0" step="1"')}${field("sourceId", "Driver ID", d.sourceId ?? "", "text")}</div>`,
    async (f) => {
      const updated = {
        ...d,
        name: f.get("name").trim(),
        color: f.get("color"),
        offset: Number(f.get("offset")),
        pace: Number(f.get("pace")),
        maxStints: Number(f.get("maxStints")),
        rating: f.get("rating") === "" ? null : Number(f.get("rating")),
        sourceId: f.get("sourceId"),
      };
      const next = structuredClone(plan);
      if (id)
        next.drivers[next.drivers.findIndex((x) => x.id === id)] = updated;
      else next.drivers.push(updated);
      validatePlan(next);
      plan = next;
      await save();
    },
  );
  if (
    id &&
    plan.drivers.length > 1 &&
    !plan.stints.some(
      (s) =>
        s.driverId === id &&
        (s.actualEnd || s.actualLaps != null || s.actualInLap != null),
    )
  )
    removalButton("Remove driver", () =>
      openModal(
        "Remove driver?",
        `<p>Remove ${esc(d.name)} from the roster? Their planned stints will be marked unassigned for you to review.</p>`,
        async () => {
          plan.drivers = plan.drivers.filter((row) => row.id !== id);
          plan.stints.forEach((s) => {
            if (s.driverId === id) s.driverId = "";
          });
          await save();
        },
        "Remove driver",
      ),
    );
}
const fallbackChecks = [
  "Incoming driver has tested controls, audio and connection",
  "Fuel and tire choice confirmed with the outgoing driver",
  "Brake bias and in-car settings confirmed",
  "Incoming driver knows the next scheduled relief",
  "Outgoing driver waits in the car for the incoming driver",
  "Car is back on track and results are ready to record",
];
function handover() {
  const m = model(),
    r = currentRow(m);
  const checks = source
    ? Object.entries(source.sheets.find((s) => s.name === "Checklists").cells)
        .filter(([ref]) => /^C(3|4|5|6|8|9|10|11)$/.test(ref))
        .map(([, c]) => c.value)
    : fallbackChecks;
  if (!r) {
    notify("No unrecorded stint available. Add or review your schedule.");
    return;
  }
  openModal(
    `Record handover · stint ${r.index}`,
    `<div class="callout">${esc(r.driver?.name || "Unassigned")} → ${esc(m.rows[r.index]?.driver?.name || "Finish")}<br>Planned end ${time(r.end)} UTC</div>${checks.map((c, i) => `<label class="check-row"><input type="checkbox" name="check${i}" ${plan.checks[r.id + ":" + i] ? "checked" : ""}>${c}</label>`).join("")}<div class="form-grid section-gap">${field("end", "Actual back-on-track · UTC", datetime(r.end), "datetime-local", "required")}${field("laps", "Actual cumulative in-lap", r.actualInLap ?? Math.ceil(r.idealInLap), "number", 'min="0" step="1" required')}</div>`,
    async (f) => {
      if (checks.some((_, i) => !f.get("check" + i)))
        throw Error("Complete every handover check before recording.");
      const next = structuredClone(plan),
        s = next.stints.find((s) => s.id === r.id);
      s.actualEnd = DateTime.fromISO(f.get("end"), { zone: "utc" }).toISO();
      s.actualInLap = Number(f.get("laps"));
      s.actualLaps = null;
      const completed = s.actualInLap - r.lapStart;
      if (completed < 0)
        throw Error("Cumulative in-lap precedes the previous stint.");
      if (Date.parse(s.actualEnd) <= r.start)
        throw Error("Back-on-track time must be after the stint start.");
      checks.forEach((_, i) => (next.checks[r.id + ":" + i] = true));
      next.notes.push({
        text: `Stint ${r.index}: ${r.driver?.name || "Unassigned"} completed ${qty(completed)} laps (in-lap ${s.actualInLap}).`,
        ts: Date.now() / 1000,
      });
      validatePlan(next);
      plan = next;
      await save();
    },
    "Record handover",
  );
}
function download(name, body, type = "application/json") {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([body], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function backup() {
  download("stintwall-race-plan.json", JSON.stringify(plan, null, 2));
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b || !plan) return;
  try {
    if (b.dataset.view) {
      view = b.dataset.view;
      notify("");
      render();
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    if (b.dataset.editStint) editStint(b.dataset.editStint);
    if (b.dataset.editDriver) editDriver(b.dataset.editDriver);
    if (b.dataset.availability) {
      const [id, index] = b.dataset.availability.split(":"),
        d = plan.drivers.find((d) => d.id === id),
        states = ["open", "tentative", "blocked", "unassigned"];
      d.availability[index] =
        states[
          (states.indexOf(d.availability[index] || "open") + 1) % states.length
        ];
      save();
      render();
    }
    switch (b.dataset.action) {
      case "toggle-surplus":
        plan.ui ??= {};
        plan.ui.showSurplus = !plan.ui.showSurplus;
        await save();
        render();
        break;
      case "toggle-availability-surplus":
        plan.ui ??= {};
        plan.ui.showAvailabilitySurplus = !plan.ui.showAvailabilitySurplus;
        await save();
        render();
        break;
      case "refresh-colors":
        render();
        notify(
          "Driver colors are applied to the schedule, availability and chart.",
        );
        break;
      case "reset-availability":
        openModal(
          "Reset driver availability",
          "<p>Set every availability slot to Open? A JSON backup will download before the reset.</p>",
          async () => {
            backup();
            plan.drivers.forEach(
              (d) => (d.availability = d.availability.map(() => "open")),
            );
            await save();
          },
          "Reset availability",
        );
        break;
      case "unassign-surplus":
        openModal(
          "Unassign surplus stints",
          "<p>Clear only driver assignments on surplus stints without recorded results. Your plan downloads as a backup first.</p>",
          async () => {
            backup();
            const ids = new Set(
              model()
                .rows.filter(
                  (r) =>
                    r.surplus &&
                    !r.actualEnd &&
                    r.actualLaps == null &&
                    r.actualInLap == null,
                )
                .map((r) => r.id),
            );
            plan.stints.forEach((s) => {
              if (ids.has(s.id)) s.driverId = "";
            });
            await save();
          },
          "Unassign surplus",
        );
        break;
      case "handover":
        handover();
        break;
      case "add-driver":
        editDriver();
        break;
      case "generate":
        openModal(
          "Generate a new rotation",
          "<p>This replaces planned assignments. A backup of the current plan will download first. Recorded results must be kept in the existing schedule.</p>",
          async () => {
            if (
              plan.stints.some(
                (s) =>
                  s.actualEnd || s.actualLaps != null || s.actualInLap != null,
              )
            )
              throw Error(
                "This schedule has recorded results. Edit existing stints to preserve those results.",
              );
            backup();
            generate(plan);
            await save();
          },
          "Generate rotation",
        );
        break;
      case "add-stint":
        plan.stints.push({
          id: uid(),
          driverId: plan.drivers[0].id,
          mode: "standard",
          tires: true,
          damage: 0,
          damageOverride: null,
          actualEnd: null,
          actualLaps: null,
        });
        save();
        render();
        editStint(plan.stints.at(-1).id);
        break;
      case "note":
        openModal(
          "Add a team note",
          '<label class="field">Note<textarea name="text" required maxlength="2000"></textarea></label>',
          async (f) => {
            const text = f.get("text").trim();
            if (!text) throw Error("Enter a note.");
            plan.notes.push({ text, ts: Date.now() / 1000 });
            await save();
          },
          "Add note",
        );
        break;
      case "workbook-example":
        openModal(
          "Use the workbook example",
          "<p>Load the full roster, availability and assignments from the spreadsheet. Your current plan downloads as a backup before it is replaced.</p>",
          async () => {
            backup();
            plan = workbookPlan(source);
            await save();
          },
          "Load example",
        );
        break;
      case "csv": {
        const columns = [
          "Stint",
          "Driver",
          "Start UTC",
          "End UTC",
          "Driver local start",
          "Mode",
          "Tires",
          "Damage seconds/lap",
          "Planned laps",
          "Actual laps",
          "Fuel L",
          "Pace seconds",
          "Service seconds",
          "Actual end UTC",
          "Delta seconds",
          "Surplus",
          "Warnings",
        ];
        const rows = model().rows.map((r) => [
          r.index,
          r.driver?.name,
          new Date(r.start).toISOString(),
          new Date(r.end).toISOString(),
          time(r.start, r.driver?.offset || 0),
          r.mode,
          r.tires,
          r.damage,
          r.laps,
          r.actualLaps,
          r.fuel,
          r.pace,
          r.service,
          r.actualEnd,
          r.delta,
          r.surplus,
          r.warnings.join("; "),
        ]);
        const cell = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
        download(
          "stint-schedule.csv",
          [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n"),
          "text/csv",
        );
        break;
      }
    }
  } catch (err) {
    notify(err.message);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.manualDuration != null) {
    const minutes = Number(e.target.value);
    if (!Number.isFinite(minutes) || minutes < 0) {
      notify("Scenario duration cannot be negative.");
      return;
    }
    plan.manualDurations ??= [95, 97.5, 100, 128.917];
    plan.manualDurations[Number(e.target.dataset.manualDuration)] = minutes;
    save();
    render();
  }
  if (e.target.dataset.check) {
    plan.checks[e.target.dataset.check] = e.target.checked;
    save();
  }
});
$("#modal-close").onclick = $("#modal-cancel").onclick = () =>
  $("#modal").close();
$("#handover-button").onclick = handover;
$("#export-button").onclick = backup;
$("#import-file").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10e6) throw Error("Plan file exceeds 10 MB.");
    const imported = cleanConnections(
      validatePlan(planSchema.parse(JSON.parse(await file.text()))),
    );
    imported.sourceWorkbook ??= source;
    openModal(
      "Restore a race plan",
      `<p>Restore ${esc(imported.name)} with ${imported.drivers.length} drivers and ${imported.stints.length} stints? Your current plan downloads as a backup first.</p>`,
      async () => {
        backup();
        plan = imported;
        await save();
      },
      "Restore plan",
    );
  } catch (err) {
    notify(err.message);
  }
  e.target.value = "";
};
setInterval(() => {
  $("#clock").textContent = DateTime.utc().toFormat("HH:mm:ss") + " UTC";
}, 1000);
async function init() {
  try {
    const response = await fetch(workbookUrl);
    if (!response.ok) throw Error("Workbook snapshot could not be loaded.");
    source = await response.json();
    const b = planStore().load();
    revision = b.revision;
    if (!b.plan && ["localhost", "127.0.0.1"].includes(location.hostname)) {
      const recovery = localStorage.getItem("stintwall-recovery");
      if (recovery)
        b.plan = validatePlan(planSchema.parse(JSON.parse(recovery)));
    }
    plan = b.plan
      ? cleanConnections(validatePlan(planSchema.parse(b.plan)))
      : workbookPlan(source);
    plan.sourceWorkbook ??= source;
    plan.manualDurations ??= workbookPlan(source).manualDurations;
    plan.config.workbookMath = true;
    plan.config.availabilityMinutes ??= 30;
    plan.config.addTireTime ??= true;
    if ((plan.config.periods || []).length < 8) {
      const importedPeriods = workbookPlan(source).config.periods;
      plan.config.periods ??= importedPeriods;
      while (plan.config.periods.length < 8)
        plan.config.periods.push({
          ...importedPeriods[plan.config.periods.length],
          enabled: false,
        });
    }
    for (const stint of plan.stints) {
      if (
        !("damageOverride" in stint) &&
        stint.id.startsWith("source-stint-") &&
        stint.damage === 0
      )
        stint.damageOverride = null;
    }
    plan.strategy.registering ??= "";
    plan.strategy.practice ??= "";
    plan.config.periods ??= [
      { name: "Night", hour: 0, factor: plan.config.nightFactor },
      { name: "Morning", hour: 6, factor: 1 },
      { name: "Evening", hour: 21, factor: plan.config.nightFactor },
    ];
    if (revision === 0) await save();
    else $("#save-status").textContent = "✓ Saved browser plan loaded";
    render();
  } catch (e) {
    let recovery;
    try {
      recovery = localStorage.getItem("stintwall-recovery");
    } catch {}
    try {
      plan = recovery
        ? validatePlan(planSchema.parse(JSON.parse(recovery)))
        : source
          ? workbookPlan(source)
          : generate(defaultPlan());
    } catch {
      plan = generate(defaultPlan());
    }
    notify(e.message);
    $("#save-status").textContent = "Recovery mode · download a backup";
    render();
  }
}
init();
