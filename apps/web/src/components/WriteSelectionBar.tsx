"use client";

type Action = {
  id: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
  hidden?: boolean;
};

type Props = {
  hasSelection: boolean;
  labels: {
    hint: string;
    clear: string;
  };
  actions: Action[];
  onClear: () => void;
};

export function WriteSelectionBar({
  hasSelection,
  labels,
  actions,
  onClear,
}: Props) {
  if (!hasSelection) return null;
  const visible = actions.filter((item) => !item.hidden);

  return (
    <div className="write-selection-bar" role="toolbar" aria-label={labels.hint}>
      <span className="write-selection-bar__hint muted">{labels.hint}</span>
      <div className="write-selection-bar__actions">
        {visible.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.primary ? "btn btn-primary btn-compact" : "btn btn-ghost btn-compact"}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-compact" onClick={onClear}>
          {labels.clear}
        </button>
      </div>
    </div>
  );
}
