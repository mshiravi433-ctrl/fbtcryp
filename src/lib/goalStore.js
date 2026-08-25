export const GOAL_STORAGE_KEY = 'fbt-wealth-goal-v1';

export function loadGoal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GOAL_STORAGE_KEY) || 'null');
    if (!parsed || Number(parsed.targetUsd) <= 0 || Number(parsed.deadlineMs) <= 0) return null;
    return { ...parsed, id: parsed.id || `g_${parsed.createdAt || 'legacy'}` };
  } catch { return null; }
}

export function saveGoal(goal) {
  try {
    if (!goal) localStorage.removeItem(GOAL_STORAGE_KEY);
    else localStorage.setItem(GOAL_STORAGE_KEY, JSON.stringify(goal));
    return true;
  } catch { return false; }
}
