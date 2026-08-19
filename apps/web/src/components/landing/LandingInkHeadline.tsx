"use client";

type Props = {
  text: string;
  className?: string;
};

export function LandingInkHeadline({ text, className = "" }: Props) {
  const words = text.split(/\s+/).filter(Boolean);

  return (
    <h1 className={`hero-headline hero-headline-ink ${className}`.trim()}>
      {words.map((word, index) => (
        <span
          key={`${word}-${index}`}
          className="hero-headline-word"
          style={{ animationDelay: `${140 + index * 85}ms` }}
        >
          {word}
        </span>
      ))}
    </h1>
  );
}
