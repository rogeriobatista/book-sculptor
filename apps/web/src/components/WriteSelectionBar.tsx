"use client";

type Props = {
  hasSelection: boolean;
  canEdit: boolean;
  canUseAi: boolean;
  labels: {
    rewrite: string;
    comment: string;
    clear: string;
    hint: string;
  };
  onRewrite: () => void;
  onComment: () => void;
  onClear: () => void;
};

export function WriteSelectionBar({
  hasSelection,
  canEdit,
  canUseAi,
  labels,
  onRewrite,
  onComment,
  onClear,
}: Props) {
  if (!hasSelection) return null;

  return (
    <div className="write-selection-bar" role="toolbar" aria-label={labels.hint}>
      <span className="write-selection-bar__hint muted">{labels.hint}</span>
      <div className="write-selection-bar__actions">
        {canUseAi && canEdit ? (
          <button type="button" className="btn btn-ghost btn-compact" onClick={onRewrite}>
            {labels.rewrite}
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" className="btn btn-ghost btn-compact" onClick={onComment}>
            {labels.comment}
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost btn-compact" onClick={onClear}>
          {labels.clear}
        </button>
      </div>
    </div>
  );
}
