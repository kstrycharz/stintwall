// No race-plan data is sent to GitHub or any server in the static application.
export function browserPlanStore(storage, namespace = "stintwall") {
  const key = `${namespace}:plan:v1`;
  return {
    key,
    load() {
      const raw = storage.getItem(key);
      if (!raw) return { revision: 0, plan: null };
      const value = JSON.parse(raw);
      if (
        !Number.isInteger(value.revision) ||
        value.revision < 1 ||
        !value.plan
      )
        throw Error(
          "The saved browser plan is unreadable. Restore a JSON backup.",
        );
      return value;
    },
    save(plan, revision) {
      const current = this.load();
      if (current.revision !== revision)
        throw Error(
          "Another tab saved a newer plan. Export your changes before reloading.",
        );
      const value = { revision: revision + 1, plan };
      storage.setItem(key, JSON.stringify(value));
      return value.revision;
    },
  };
}
