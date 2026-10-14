export const uid = () => crypto.randomUUID();
export const colors = [
  "#51d6c7",
  "#bd9cff",
  "#ffbb69",
  "#7aaaff",
  "#f18cab",
  "#d4df72",
];
export function defaultPlan() {
  return {
    schema: 1,
    name: "24H ENDURANCE",
    track: "Your race circuit",
    carNumber: "23",
    config: {
      start: new Date(Math.ceil(Date.now() / 3600000) * 3600000).toISOString(),
      hours: 24,
      tank: 62.5,
      reserve: 2,
      lap: 203,
      burn: 5.4,
      saveLap: 205.03,
      saveBurn: 5.35,
      pit: 70,
      tires: 30,
      simStartHour: 14.5,
      nightFactor: 1,
      fairShare: 0.25,
      minRest: 120,
      availabilityMinutes: 30,
      addTireTime: true,
    },
    drivers: ["Driver 1", "Driver 2", "Driver 3", "Driver 4"].map(
      (name, i) => ({
        id: "driver-" + i,
        name,
        color: colors[i],
        offset: 0,
        pace: 1,
        maxStints: 3,
        streamId: "",
        availability: Array(48).fill("open"),
      }),
    ),
    stints: [],
    notes: [],
    checks: {},
    strategy: {
      goal: "Bring the car home. Keep stops predictable.",
      qualifier: "",
      comms: "",
      setup: "",
      retirement: "",
      registering: "",
      practice: "",
    },
  };
}
export function validatePlan(p) {
  if (
    p?.schema !== 1 ||
    !Array.isArray(p.drivers) ||
    !p.drivers.length ||
    p.drivers.length > 30 ||
    !Array.isArray(p.stints) ||
    p.stints.length > 1000
  )
    throw Error("Invalid race plan structure.");
  const c = p.config;
  if (!c || !Number.isFinite(Date.parse(c.start)))
    throw Error("Enter a valid race start.");
  for (const k of ["hours", "tank", "lap", "burn", "saveLap", "saveBurn"])
    if (!Number.isFinite(c[k]) || c[k] <= 0)
      throw Error(`${k} must be greater than zero.`);
  for (const k of ["reserve", "pit", "tires", "minRest"])
    if (!Number.isFinite(c[k]) || c[k] < 0)
      throw Error(`${k} cannot be negative.`);
  if (
    c.hours > 72 ||
    c.reserve >= c.tank ||
    Math.floor((c.tank - c.reserve) / Math.max(c.burn, c.saveBurn)) < 1
  )
    throw Error(
      "Fuel capacity must support at least one lap; race duration must be at most 72 hours.",
    );
  if (
    !Number.isFinite(c.nightFactor) ||
    c.nightFactor <= 0 ||
    !Number.isFinite(c.simStartHour) ||
    c.simStartHour < 0 ||
    c.simStartHour >= 24 ||
    !Number.isFinite(c.fairShare) ||
    c.fairShare < 0 ||
    c.fairShare > 1
  )
    throw Error("Invalid pace, time-of-day, or fair-share factor.");
  const ids = new Set();
  if (
    c.availabilityMinutes != null &&
    (!Number.isInteger(c.availabilityMinutes) ||
      c.availabilityMinutes < 1 ||
      c.availabilityMinutes > 120)
  )
    throw Error("Availability interval must be 1–120 minutes.");
  if (
    c.periods &&
    (!Array.isArray(c.periods) ||
      c.periods.some(
        (v) =>
          !Number.isFinite(v.hour) ||
          v.hour < 0 ||
          v.hour >= 24 ||
          !Number.isFinite(v.factor) ||
          v.factor <= 0,
      ))
  )
    throw Error(
      "Time-of-day periods need a valid hour and positive pace factor.",
    );
  for (const d of p.drivers) {
    if (
      !d.id ||
      ids.has(d.id) ||
      typeof d.name !== "string" ||
      !d.name.trim() ||
      !Number.isFinite(d.pace) ||
      d.pace <= 0 ||
      !Number.isFinite(d.offset) ||
      Math.abs(d.offset) > 14 ||
      !Number.isInteger(d.maxStints) ||
      d.maxStints < 1 ||
      !Array.isArray(d.availability) ||
      d.availability.some(
        (v) => !["open", "tentative", "blocked", "unassigned"].includes(v),
      )
    )
      throw Error("Invalid driver or availability.");
    ids.add(d.id);
  }
  const stintIds = new Set();
  for (const s of p.stints) {
    if (
      !s.id ||
      stintIds.has(s.id) ||
      !["standard", "save"].includes(s.mode) ||
      typeof s.tires !== "boolean" ||
      !Number.isFinite(s.damage) ||
      s.damage < 0 ||
      (s.driverId && !ids.has(s.driverId))
    )
      throw Error("Invalid stint.");
    stintIds.add(s.id);
    if (
      s.damageOverride != null &&
      (!Number.isFinite(s.damageOverride) || s.damageOverride < 0)
    )
      throw Error("Damage modifier cannot be negative.");
    if (
      s.actualInLap != null &&
      (!Number.isInteger(s.actualInLap) || s.actualInLap < 0)
    )
      throw Error("Actual in-lap must be a nonnegative integer.");
    if (s.actualEnd && !Number.isFinite(Date.parse(s.actualEnd)))
      throw Error("Invalid actual finish.");
    if (
      s.actualLaps != null &&
      (!Number.isInteger(s.actualLaps) || s.actualLaps < 0)
    )
      throw Error("Invalid actual laps.");
  }
  return p;
}
export function availability(driver, start, end, raceStart, interval = 30) {
  if (!driver) return "unassigned";
  const block = interval * 60000;
  const first = Math.max(0, Math.floor((start - raceStart) / block));
  const last = Math.max(first, Math.ceil((end - raceStart) / block) - 1);
  let status = "open";
  for (let i = first; i <= last; i++) {
    const v = driver.availability[i] || "open";
    if (v === "blocked") return v;
    if (v === "unassigned") return v;
    if (v === "tentative") status = v;
  }
  return status;
}
export function calculate(p) {
  const c = p.config,
    start = Date.parse(c.start),
    finish = start + c.hours * 3600000;
  let cursor = start,
    lapTotal = 0,
    previous = null,
    consecutive = 0;
  let damage = 0;
  const lastEnd = {},
    totals = Object.fromEntries(
      p.drivers.map((d) => [
        d.id,
        { laps: 0, actual: 0, seconds: 0, stints: 0 },
      ]),
    );
  const rows = p.stints.map((s, i) => {
    damage = "damageOverride" in s ? (s.damageOverride ?? damage) : s.damage;
    const d = p.drivers.find((d) => d.id === s.driverId),
      saving = s.mode === "save",
      burn = saving ? c.saveBurn : c.burn;
    const hour = (c.simStartHour + (cursor - start) / 3600000) % 24,
      night = hour < 6 || hour >= 21;
    const periods = [
      ...(c.periods || []).filter((v) => v.enabled !== false),
    ].sort((a, b) => a.hour - b.hour);
    const period =
      periods.filter((v) => v.hour <= hour).at(-1) || periods.at(-1);
    const pace =
      (saving ? c.saveLap : c.lap) *
        (d?.pace || 1) *
        (period ? period.factor : night ? c.nightFactor : 1) +
      damage;
    const fullLaps = Math.floor((c.tank - c.reserve) / burn),
      factor =
        (d?.pace || 1) * (period ? period.factor : night ? c.nightFactor : 1),
      service =
        c.pit +
        (s.tires && c.addTireTime !== false
          ? c.tires * (c.workbookMath ? factor : 1)
          : 0);
    const remaining = Math.max(0, (finish - cursor) / 1000),
      final = remaining <= fullLaps * pace + service;
    const laps =
      remaining === 0
        ? 0
        : final
          ? c.workbookMath
            ? remaining / (c.lap + damage)
            : Math.min(fullLaps, Math.ceil(remaining / pace))
          : fullLaps;
    const duration = Math.min(remaining, fullLaps * pace + service);
    const plannedService = final
      ? Math.max(0, remaining - fullLaps * pace)
      : service;
    const plannedEnd = cursor + duration * 1000;
    const actualEnd = s.actualEnd ? Date.parse(s.actualEnd) : null;
    const end = actualEnd ?? plannedEnd;
    const status = availability(
        d,
        cursor,
        end,
        start,
        c.availabilityMinutes || 30,
      ),
      warnings = [];
    if (!d) warnings.push("Unassigned");
    if (status === "blocked") warnings.push("Unavailable");
    if (status === "tentative") warnings.push("Tentative");
    if (status === "unassigned" && d) warnings.push("Availability unassigned");
    consecutive = s.driverId === previous ? consecutive + 1 : 1;
    if (d && consecutive > d.maxStints) warnings.push("Stint limit");
    if (
      d &&
      lastEnd[d.id] != null &&
      previous !== d.id &&
      (cursor - lastEnd[d.id]) / 60000 < c.minRest
    )
      warnings.push("Short rest");
    if (actualEnd != null && actualEnd <= cursor)
      warnings.push("Actual end precedes start");
    const actualLaps =
      s.actualInLap != null ? s.actualInLap - lapTotal : s.actualLaps;
    if (actualLaps != null && actualLaps < 0)
      warnings.push("In-lap precedes previous in-lap");
    const row = {
      ...s,
      index: i + 1,
      driver: d,
      start: cursor,
      end,
      plannedEnd,
      laps,
      damage,
      actualLaps,
      idealInLap: lapTotal + laps,
      inLap: s.actualInLap ?? lapTotal + (actualLaps ?? laps),
      lapDelta: (actualLaps ?? laps) - laps,
      driverFactor: d?.pace || 1,
      timeFactor: period ? period.factor : night ? c.nightFactor : 1,
      consecutive,
      simStartHour: hour,
      simEndHour: (c.simStartHour + (end - start) / 3600000) % 24,
      fuel: Math.min(c.tank, laps * burn + c.reserve),
      pace,
      service: plannedService,
      status,
      warnings,
      final,
      surplus: cursor >= finish,
      delta: actualEnd == null ? null : (end - plannedEnd) / 1000,
      lapStart: lapTotal,
      night,
    };
    if (!row.surplus) {
      lapTotal += actualLaps ?? laps;
      if (d) {
        const t = totals[d.id];
        t.laps += laps;
        t.actual += actualLaps ?? 0;
        t.seconds += Math.max(0, (end - cursor) / 1000);
        t.stints++;
        lastEnd[d.id] = end;
      }
    }
    previous = s.driverId;
    cursor = end;
    return row;
  });
  return {
    rows,
    totals,
    start,
    finish,
    lapTotal,
    fairLaps: Math.ceil((lapTotal / p.drivers.length) * c.fairShare),
    idealLapTotal: rows
      .filter((r) => !r.surplus)
      .reduce((n, r) => n + r.laps, 0),
    timeDelta: rows
      .filter((r) => !r.surplus)
      .reduce((n, r) => n + (r.delta || 0), 0),
    averageRating: (() => {
      const rated = p.drivers.filter((d) => d.rating > 0);
      return rated.length
        ? rated.reduce((n, d) => n + d.rating, 0) / rated.length
        : null;
    })(),
    coverage: Math.max(0, (cursor - start) / 3600000),
    uncovered: Math.max(0, (finish - cursor) / 1000),
    warnings: rows
      .filter((r) => !r.surplus)
      .reduce((n, r) => n + r.warnings.length, 0),
  };
}
export function generate(p) {
  validatePlan(p);
  p.stints = [];
  let n = 0;
  while (n < 500) {
    const model = calculate(p);
    if (!model.uncovered) break;
    const from = model.rows.at(-1)?.end ?? model.start;
    const duration =
      Math.floor((p.config.tank - p.config.reserve) / p.config.burn) *
        p.config.lap +
      p.config.pit +
      p.config.tires;
    const candidates = p.drivers
      .map((d) => {
        const prev = model.rows.at(-1),
          last = [...model.rows].reverse().find((r) => r.driverId === d.id);
        let run = 0;
        for (const r of [...model.rows].reverse()) {
          if (r.driverId !== d.id) break;
          run++;
        }
        const status = availability(
          d,
          from,
          Math.min(model.finish, from + duration * d.pace * 1000),
          model.start,
          p.config.availabilityMinutes || 30,
        );
        return {
          d,
          score:
            (status === "blocked" ? 1e9 : status === "tentative" ? 1e7 : 0) +
            (run >= d.maxStints ? 1e8 : 0) +
            (last &&
            prev?.driverId !== d.id &&
            (from - last.end) / 60000 < p.config.minRest
              ? 1e6
              : 0) +
            model.totals[d.id].seconds,
        };
      })
      .sort((a, b) => a.score - b.score);
    p.stints.push({
      id: uid(),
      driverId: candidates[0].d.id,
      mode: "standard",
      tires: true,
      damage: 0,
      damageOverride: null,
      actualEnd: null,
      actualLaps: null,
    });
    n++;
  }
  return p;
}
export function fuelProjection(fuel, burn, lap, remaining, reserve = 0) {
  if (
    ![fuel, burn, lap, remaining, reserve].every(Number.isFinite) ||
    fuel < 0 ||
    burn <= 0 ||
    lap <= 0 ||
    remaining < 0
  )
    return null;
  const safeLaps = Math.max(0, (fuel - reserve) / burn),
    finishLaps = Math.ceil(remaining / lap) + 1;
  return {
    safeLaps,
    seconds: safeLaps * lap,
    finishLaps,
    needed: Math.max(0, finishLaps * burn + reserve - fuel),
  };
}
