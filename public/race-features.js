import { availability } from "./engine.js";
export function fuelStint(config, saving = false) {
  const pace = saving ? config.saveLap : config.lap;
  const burn = saving ? config.saveBurn : config.burn;
  const laps = Math.floor((config.tank - config.reserve) / burn);
  return {
    pace,
    burn,
    laps,
    lapWithPit: pace + config.pit / laps,
    trackSeconds: laps * pace,
    withPitSeconds: laps * pace + config.pit,
    fuel: laps * burn,
  };
}
export function fuelForDuration(config, seconds, saving = false) {
  const pace = saving ? config.saveLap : config.lap,
    burn = saving ? config.saveBurn : config.burn;
  const laps = seconds / pace,
    fuel = laps * burn + config.reserve;
  return { laps, fuel, withExtraLap: fuel + burn, fits: fuel <= config.tank };
}
export function raceSummary(plan, model) {
  const standard = fuelStint(plan.config),
    saving = fuelStint(plan.config, true);
  const final = model.rows.find((r) => r.final && !r.surplus);
  const target = Math.ceil(
    (model.idealLapTotal / plan.drivers.length) * plan.config.fairShare,
  );
  return {
    standard,
    saving,
    final,
    idealFairLaps: target,
    idealFairStints: Math.ceil(target / standard.laps),
    projectedFairStints: Math.ceil(model.fairLaps / standard.laps),
    lapDelta: model.lapTotal - model.idealLapTotal,
    timeLost: (model.lapTotal - model.idealLapTotal) * standard.lapWithPit,
    actualOnTrack: plan.config.hours * 3600 - model.timeDelta,
    totalRecorded: model.rows
      .filter((r) => !r.surplus)
      .reduce((n, r) => n + (r.actualLaps ?? 0), 0),
    finalStandard: final
      ? fuelForDuration(
          plan.config,
          Math.max(0, (model.finish - final.start) / 1000),
        )
      : null,
    finalSaving: final
      ? fuelForDuration(
          plan.config,
          Math.max(0, (model.finish - final.start) / 1000),
          true,
        )
      : null,
  };
}
export function availabilitySlots(plan, model, includeSurplus = false) {
  const minutes = plan.config.availabilityMinutes || 30,
    block = minutes * 60000;
  const count = includeSurplus
    ? Math.max(
        Math.ceil((plan.config.hours * 60) / minutes),
        ...plan.drivers.map((d) => d.availability.length),
      )
    : Math.ceil((plan.config.hours * 60) / minutes);
  return Array.from({ length: count }, (_, index) => {
    const start = model.start + index * block,
      end = start + block;
    const stints = model.rows.filter(
      (r) => !r.surplus && r.start < end && r.end > start,
    );
    return {
      index,
      start,
      end,
      surplus: start >= model.finish,
      stints: stints.map((r) => r.index),
      drivers: plan.drivers.map((d) => ({
        id: d.id,
        localStart: start + d.offset * 3600000,
        status: availability(d, start, end, model.start, minutes),
      })),
    };
  });
}
export function resampleAvailability(plan, minutes) {
  const previous = plan.config.availabilityMinutes || 30;
  if (previous === minutes) return;
  plan.drivers.forEach((d) => {
    const old = { ...d, availability: [...d.availability] };
    const length = Math.max(
      Math.ceil((plan.config.hours * 60) / minutes),
      Math.ceil((old.availability.length * previous) / minutes),
    );
    d.availability = Array.from({ length }, (_, i) =>
      availability(
        old,
        i * minutes * 60000,
        (i + 1) * minutes * 60000,
        0,
        previous,
      ),
    );
  });
  plan.config.availabilityMinutes = minutes;
}
