import { defaultPlan, colors, validatePlan } from "./engine.js";
export function workbookPlan(source) {
  const p = defaultPlan();
  const sheet = (name) =>
    source.sheets.find((s) => s.name === name)?.cells || {};
  const o = sheet("Overview"),
    r = sheet("Roster"),
    a = sheet("Driver Availability"),
    s = sheet("Schedule");
  const value = (cells, ref, fallback = "") => cells[ref]?.value ?? fallback;
  const number = (cells, ref, fallback) =>
    typeof value(cells, ref) === "number" ? value(cells, ref) : fallback;
  const iso = (serial) =>
    new Date(Math.round((serial - 25569) * 86400000)).toISOString();
  const start = number(o, "E5", 0) + number(o, "E10", 0);
  p.name = "Sassy Enduro · workbook example";
  p.track = "Set your circuit";
  Object.assign(p.config, {
    workbookMath: true,
    addTireTime: Boolean(value(o, "E17", 1)),
    availabilityMinutes: number(sheet("Config"), "I2", 30),
    start: iso(start),
    hours: number(o, "E4", 1) * 24,
    sessionStart: iso(number(o, "E5", start)),
    greenOffset: number(o, "E10", 0) * 1440,
    tank: number(o, "E16", 62.5),
    reserve: 0,
    lap: number(o, "H4", 203 / 86400) * 86400,
    burn: number(o, "I4", 5.4),
    saveLap: number(o, "H5", 205.03 / 86400) * 86400,
    saveBurn: number(o, "I5", 5.35),
    pit: number(o, "E15", 70 / 86400) * 86400,
    tires: number(o, "E18", 30 / 86400) * 86400,
    simStartHour: (number(o, "E8", start) % 1) * 24,
    minRest: 0,
    periods: Array.from({ length: 8 }, (_, i) => ({
      name: value(o, `G${9 + i}`),
      hour: number(o, `I${9 + i}`, 0) * 24,
      factor: number(o, `K${9 + i}`, 1),
      enabled: i < 5,
    })),
  });
  for (const key of ["lap", "saveLap", "pit", "tires", "simStartHour"])
    p.config[key] = Math.round(p.config[key] * 1000) / 1000;
  p.drivers = [];
  for (let row = 4; row <= 103; row++) {
    const name = value(r, `B${row}`);
    if (!name) continue;
    const i = p.drivers.length;
    const col = (n) => {
      let text = "";
      while (n) {
        n--;
        text = String.fromCharCode(65 + (n % 26)) + text;
        n = Math.floor(n / 26);
      }
      return text;
    };
    p.drivers.push({
      id: `source-driver-${row}`,
      name: String(name),
      color: source.charts?.[0]?.colors[i] || colors[i % colors.length],
      offset: number(r, `F${row}`, 0),
      rating: number(r, `G${row}`, 0),
      sourceId: value(r, `I${row}`),
      pace: number(o, `O${9 + i}`, 1),
      maxStints: number(r, `H${row}`, 3),
      availability: Array.from(
        {
          length: Math.max(
            71,
            Math.ceil((p.config.hours * 60) / p.config.availabilityMinutes),
          ),
        },
        (_, slot) =>
          String(value(a, `${col(12 + i)}${slot + 5}`, "Open")).toLowerCase(),
      ),
    });
  }
  const key = (name) => String(name).toLowerCase().replace(/\s/g, "");
  for (let row = 5; row <= 104; row++) {
    const name = value(s, `Z${row}`),
      mode = value(s, `C${row}`);
    if (!name || !mode) continue;
    const driver = p.drivers.find((d) => key(d.name) === key(name));
    const actual = s[`I${row}`],
      actualLaps = s[`W${row}`];
    p.stints.push({
      id: `source-stint-${row}`,
      driverId: driver?.id || "",
      mode: String(mode).startsWith("fs") ? "save" : "standard",
      tires: !String(mode).includes("no tires") && Boolean(value(o, "E17", 1)),
      damage: number(s, `U${row}`, 0) * 86400,
      damageOverride:
        s[`U${row}`] && "formula" in s[`U${row}`]
          ? null
          : number(s, `U${row}`, 0) * 86400,
      actualInLap:
        s[`Y${row}`] &&
        !("formula" in s[`Y${row}`]) &&
        Number.isInteger(s[`Y${row}`].value)
          ? s[`Y${row}`].value
          : null,
      actualEnd:
        actual && !("formula" in actual) && typeof actual.value === "number"
          ? iso(Math.floor(number(s, `F${row}`, start)) + actual.value)
          : null,
      actualLaps:
        actualLaps &&
        !("formula" in actualLaps) &&
        Number.isInteger(actualLaps.value)
          ? actualLaps.value
          : null,
      highlight: Boolean(value(s, `B${row}`, false)),
    });
  }
  const strategy = sheet("Strategy");
  [
    "qualifier",
    "registering",
    "goal",
    "retirement",
    "comms",
    "setup",
    "practice",
  ].forEach(
    (k, i) => (p.strategy[k] = String(value(strategy, `C${i + 2}`, ""))),
  );
  p.sourceWorkbook = source;
  p.manualDurations = [33, 34, 35, 36].map(
    (row) => number(o, `H${row}`, 0) * 1440,
  );
  p.sourceNote =
    "Imported example dates are from 2018. Set your event dates before using the plan.";
  return validatePlan(p);
}
