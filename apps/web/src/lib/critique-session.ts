const DISMISSED_PREFIX = "bs.critique.dismissed.";

export function loadCritiqueDismissed(jobId: string): Set<string> {
  if (typeof window === "undefined" || !jobId) return new Set();
  try {
    const raw = window.localStorage.getItem(`${DISMISSED_PREFIX}${jobId}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function saveCritiqueDismissed(jobId: string, dismissed: Set<string>) {
  if (typeof window === "undefined" || !jobId) return;
  try {
    window.localStorage.setItem(
      `${DISMISSED_PREFIX}${jobId}`,
      JSON.stringify([...dismissed]),
    );
  } catch {
    // Ignore quota / private-mode failures.
  }
}
