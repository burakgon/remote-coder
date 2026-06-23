import { useEffect, useRef, useState } from "react";
import { Surface } from "../ui/Surface";
import { Button } from "../ui/Button";
import type { QuestionPayload } from "../types/server";

export interface QuestionPromptProps {
  question: QuestionPayload;
  onAnswer: (answers: Record<string, string | string[]>) => void;
  onCancel: () => void;
}

/**
 * The "awaiting you" moment for an AskUserQuestion. Renders each question (header + prompt) with
 * its options; single-select picks one label, multi-select toggles a set. Submit returns the
 * answers map (question text -> chosen label | label[]); Skip cancels (the server denies the tool).
 */
export function QuestionPrompt({ question, onAnswer, onCancel }: QuestionPromptProps) {
  // selections[questionIndex] = a Set of chosen labels (single-select keeps at most one).
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});

  // a11y: when the prompt appears, move focus to it so a keyboard / screen-reader user lands on the
  // request immediately (Claude is waiting on the remote machine). The region is the focus target;
  // the iris color is paired with the "Awaiting you" TEXT so color is never the sole signal.
  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    regionRef.current?.focus();
  }, [question.requestId]);

  function toggle(qi: number, label: string, multi: boolean) {
    setSelections((prev) => {
      const current = new Set(prev[qi] ?? []);
      if (multi) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      return { ...prev, [qi]: current };
    });
  }

  function submit() {
    const answers: Record<string, string | string[]> = {};
    question.questions.forEach((q, qi) => {
      const chosen = [...(selections[qi] ?? [])];
      if (chosen.length === 0) return;
      answers[q.question] = q.multiSelect ? chosen : chosen[0]!;
    });
    onAnswer(answers);
  }

  const allAnswered = question.questions.every((_, qi) => (selections[qi]?.size ?? 0) > 0);

  return (
    <Surface level={2} as="article">
      <div
        ref={regionRef}
        role="region"
        aria-label="Question"
        tabIndex={-1}
        style={{ borderLeft: "3px solid var(--iris)", padding: "var(--sp-4)", display: "grid", gap: "var(--sp-4)" }}
      >
        <div style={{ color: "var(--iris)", fontFamily: "var(--font-display)" }}>Awaiting you — question</div>
        {question.questions.map((q, qi) => (
          <div key={qi} style={{ display: "grid", gap: "var(--sp-2)" }}>
            {q.header && (
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: "var(--fs-xs)",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {q.header}
              </div>
            )}
            <div>{q.question}</div>
            <div role="group" style={{ display: "grid", gap: "var(--sp-2)" }}>
              {q.options.map((opt, oi) => {
                const selected = selections[qi]?.has(opt.label) ?? false;
                // NOTE: the shared `Button` (packages/web/src/ui/Button.tsx) has CLOSED props (no
                // `style`, no `aria-pressed`, no rest spread), so option toggles are plain styled
                // <button>s. The Submit/Skip controls below use only Button's real props, so they
                // stay <Button>. The global :focus-visible ring (styles/global.css) keeps a bare
                // <button> keyboard-accessible without a custom class.
                return (
                  <button
                    key={`${qi}-${oi}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(qi, opt.label, q.multiSelect)}
                    style={{
                      display: "grid",
                      gap: "2px",
                      justifyItems: "start",
                      textAlign: "left",
                      minHeight: "var(--tap-min)",
                      padding: "var(--sp-3)",
                      borderRadius: "var(--radius-sm)",
                      border: `1px solid ${selected ? "var(--iris)" : "var(--border)"}`,
                      background: selected ? "var(--iris)" : "transparent",
                      color: selected ? "var(--on-accent)" : "var(--text)",
                      font: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <span>{opt.label}</span>
                    {opt.description && (
                      <span
                        style={{ color: selected ? "var(--on-accent)" : "var(--text-muted)", fontSize: "var(--fs-xs)" }}
                      >
                        {opt.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
          <Button variant="primary" onClick={submit} disabled={!allAnswered} aria-label="Submit answer">
            Submit
          </Button>
          <Button variant="ghost" onClick={onCancel} aria-label="Skip question">
            Skip
          </Button>
        </div>
      </div>
    </Surface>
  );
}
