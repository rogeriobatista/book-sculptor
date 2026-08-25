"use client";

import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  query: string;
  matchCount: number;
  activeIndex: number;
  labels: {
    placeholder: string;
    next: string;
    prev: string;
    close: string;
    none: string;
    of: string;
  };
  onQueryChange: (value: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
};

export function WriteFindBar({
  open,
  query,
  matchCount,
  activeIndex,
  labels,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="write-find-bar" role="search">
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={labels.placeholder}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        aria-label={labels.placeholder}
      />
      <span className="muted write-find-bar__meta">
        {query.trim()
          ? matchCount === 0
            ? labels.none
            : labels.of
                .replace("{current}", String(activeIndex + 1))
                .replace("{total}", String(matchCount))
          : ""}
      </span>
      <button type="button" className="btn btn-ghost btn-compact" onClick={onPrev} disabled={!matchCount}>
        {labels.prev}
      </button>
      <button type="button" className="btn btn-ghost btn-compact" onClick={onNext} disabled={!matchCount}>
        {labels.next}
      </button>
      <button type="button" className="btn btn-ghost btn-compact" onClick={onClose}>
        {labels.close}
      </button>
    </div>
  );
}
