"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type LandingChapter = {
  id: string;
  label: string;
  marker: string;
};

type Props = {
  chapters: LandingChapter[];
  scrollHint?: string;
  children: ReactNode;
};

const TOTAL_PAGES = 52;

export function LandingEffects({ chapters, scrollHint, children }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState(chapters[0]?.id ?? "");
  const [pageNum, setPageNum] = useState(1);
  const [showHint, setShowHint] = useState(true);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const sectionEls = Array.from(
      root.querySelectorAll<HTMLElement>("[data-chapter]")
    );

    let frame = 0;

    const updateScroll = () => {
      frame = 0;
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop;
      const maxScroll = doc.scrollHeight - doc.clientHeight;
      const p = maxScroll > 0 ? scrollTop / maxScroll : 0;

      setProgress(p);
      setPageNum(Math.max(1, Math.round(p * (TOTAL_PAGES - 1)) + 1));
      setShowHint(p < 0.04 && scrollTop < 80);

      doc.style.setProperty("--landing-scroll", String(p));
      doc.style.setProperty("--landing-scroll-y", `${scrollTop}px`);

      if (!reducedMotion) {
        const heroContent = root.querySelector<HTMLElement>(".hero-content");
        const heroSection = root.querySelector<HTMLElement>(".hero");
        if (heroContent && heroSection) {
          const heroTop = heroSection.getBoundingClientRect().top;
          const heroHeight = heroSection.offsetHeight || 1;
          const heroProgress = Math.min(
            1,
            Math.max(0, -heroTop / (heroHeight * 0.85))
          );
          heroContent.style.setProperty(
            "--hero-scroll",
            String(heroProgress)
          );
        }
      }
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateScroll);
    };

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            el.classList.add("is-visible");
          }
        });
      },
      { threshold: 0.1, rootMargin: "-6% 0px -6% 0px" }
    );

    const activeObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target as HTMLElement | undefined;
        const id = top?.dataset.chapter;
        if (id) setActiveId(id);
      },
      { threshold: [0.15, 0.35, 0.55], rootMargin: "-18% 0px -50% 0px" }
    );

    sectionEls.forEach((el) => {
      revealObserver.observe(el);
      activeObserver.observe(el);
      if (reducedMotion) el.classList.add("is-visible");
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    updateScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      revealObserver.disconnect();
      activeObserver.disconnect();
      document.documentElement.style.removeProperty("--landing-scroll");
      document.documentElement.style.removeProperty("--landing-scroll-y");
    };
  }, [chapters]);

  const scrollToChapter = useCallback((id: string) => {
    const el = rootRef.current?.querySelector(`[data-chapter="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const bookmarkTop = `${Math.min(96, Math.max(4, progress * 100))}%`;

  return (
    <div ref={rootRef} className="landing-experience">
      <div className="landing-manuscript-veil" aria-hidden="true">
        <div className="landing-manuscript-gutter" />
        <div className="landing-ink-wash" />
      </div>

      <div className="landing-reading-chrome" aria-hidden="true">
        <nav className="reading-spine" aria-hidden="true">
          <div className="reading-spine-rail">
            <span
              className="reading-spine-fill"
              style={{ transform: `scaleY(${progress})` }}
            />
          </div>
          <ol className="reading-spine-chapters">
            {chapters.map((chapter) => (
              <li
                key={chapter.id}
                data-active={activeId === chapter.id ? "true" : "false"}
              >
                <button
                  type="button"
                  className="reading-spine-btn"
                  title={chapter.label}
                  onClick={() => scrollToChapter(chapter.id)}
                >
                  <span className="reading-spine-marker">{chapter.marker}</span>
                  <span className="reading-spine-label">{chapter.label}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="reading-bookmark">
          <span
            className="reading-bookmark-tab"
            style={{ top: bookmarkTop }}
          />
        </div>

        <div className="reading-page-indicator">
          <span className="reading-page-kicker">manuscript</span>
          <span className="reading-page-num">
            p. {String(pageNum).padStart(2, "0")}
          </span>
        </div>
      </div>

      {scrollHint && showHint ? (
        <div className="landing-scroll-hint" aria-hidden="true">
          <span>{scrollHint}</span>
          <span className="landing-scroll-hint-chevron" />
        </div>
      ) : null}

      {children}
    </div>
  );
}
