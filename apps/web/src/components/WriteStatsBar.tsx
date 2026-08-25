"use client";

type Props = {
  wordCountLabel: string;
  sessionLabel: string;
  goal: number;
  wordCount: number;
  labels: {
    setGoal: string;
    goalProgress: string;
    goalReached: string;
  };
  onSetGoal: () => void;
};

export function WriteStatsBar({
  wordCountLabel,
  sessionLabel,
  goal,
  wordCount,
  labels,
  onSetGoal,
}: Props) {
  const progress = goal > 0 ? Math.min(100, Math.round((wordCount / goal) * 100)) : 0;
  const reached = goal > 0 && wordCount >= goal;

  return (
    <div className="write-stats-bar" aria-live="polite">
      <span className="write-stats-bar__item">{wordCountLabel}</span>
      <span className="write-stats-bar__item muted">{sessionLabel}</span>
      {goal > 0 ? (
        <button
          type="button"
          className="write-stats-bar__goal"
          data-reached={reached ? "true" : "false"}
          onClick={onSetGoal}
          title={labels.setGoal}
        >
          <span className="write-stats-bar__goal-track" aria-hidden>
            <span style={{ width: `${progress}%` }} />
          </span>
          <span>
            {reached
              ? labels.goalReached
              : labels.goalProgress
                  .replace("{count}", String(wordCount))
                  .replace("{goal}", String(goal))}
          </span>
        </button>
      ) : (
        <button type="button" className="btn btn-ghost btn-compact" onClick={onSetGoal}>
          {labels.setGoal}
        </button>
      )}
    </div>
  );
}
