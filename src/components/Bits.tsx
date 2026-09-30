/**
 * The five pieces of shared chrome the Living Table uses (Busy, ErrorNote,
 * GameHeader, CostBadge, Panel), copied from Conjure Games'
 * src/components/Bits.tsx when the game moved into its own repo. Only these
 * five and the two things they draw with (Chip, BackGlyph) came across: the
 * hub's other controls pull in its motion, skin and audio systems, which this
 * app does not have.
 *
 * Their class names are unchanged (`.busy`, `.game-head`, `.panel`, `.cg-*`) so
 * the copied stylesheets paint them exactly as the hub did.
 */
import type { CSSProperties, ReactNode } from "react";

export type ChipTone = "free" | "cost" | "live" | "danger" | "achv";

export function Chip({
  tone,
  children,
  className,
  title,
}: {
  tone: ChipTone;
  children: ReactNode;
  className?: string;
  title?: string;
}): JSX.Element {
  return (
    <span className={`cg-chip cg-chip--${tone}${className ? ` ${className}` : ""}`} {...(title ? { title } : {})}>
      {children}
    </span>
  );
}

/** Price, on the button, before the click. Never absent from a paid action. */
export function CostBadge({ n, variant = "chip" }: { n: number; variant?: "chip" | "corner" }): JSX.Element {
  const title = `Costs ${n} credit${n === 1 ? "" : "s"} from your ConjureOS balance`;
  if (variant === "corner") {
    return (
      <span className="cost cg-plate cg-cost-disc" title={title} aria-label={title}>
        {n}
      </span>
    );
  }
  return (
    <Chip tone="cost" className="cost" title={title}>
      ✦{n}
    </Chip>
  );
}

export function Busy({ label, sub }: { label: string; sub?: string }): JSX.Element {
  return (
    <div className="busy cg-busy">
      <div className="spinner cg-spin" role="status" aria-live="polite" aria-label={label} />
      <p className="cui-subheading">{label}</p>
      {sub && <p className="cui-muted">{sub}</p>}
    </div>
  );
}

export function ErrorNote({ message, onBack }: { message: string; onBack: () => void }): JSX.Element {
  return (
    <div className="busy cg-busy">
      <p className="cui-subheading">That didn&rsquo;t work.</p>
      <p className="cui-muted err">{message}</p>
      <button type="button" className="cui-button cui-button--secondary" onClick={onBack}>
        Back to the games
      </button>
    </div>
  );
}

export function GameHeader({
  title,
  subtitle,
  badge,
  hud,
  onExit,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  hud?: ReactNode;
  onExit: () => void;
}): JSX.Element {
  return (
    <header className="game-head">
      <button type="button" className="cui-button cui-button--ghost back" aria-label="Back to the games" onClick={onExit}>
        <BackGlyph />
      </button>
      <div className="game-head-text">
        <h2 className="cui-heading">{title}</h2>
        {subtitle && <p className="cui-muted">{subtitle}</p>}
      </div>
      {badge && <span className="cui-pill cui-pill--success">{badge}</span>}
      {hud}
    </header>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={`panel cg-raise${className ? ` ${className}` : ""}`}>{children}</div>;
}

const glyph: CSSProperties = { display: "block" };

export function BackGlyph(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false" style={glyph}>
      <path d="M11 3.5 5.5 9l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
