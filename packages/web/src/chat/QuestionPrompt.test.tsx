import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionPrompt } from "./QuestionPrompt";
import type { QuestionPayload } from "../types/server";

function single(): QuestionPayload {
  return {
    requestId: "rq",
    toolInput: { questions: [{ question: "Which language?", header: "Language", multiSelect: false, options: [{ label: "TypeScript", description: "TS" }, { label: "Python", description: "Py" }] }] },
    questions: [{ question: "Which language?", header: "Language", multiSelect: false, options: [{ label: "TypeScript", description: "TS" }, { label: "Python", description: "Py" }] }],
  };
}

describe("QuestionPrompt", () => {
  test("renders the question, header, and every option with its description", () => {
    render(<QuestionPrompt question={single()} onAnswer={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Which language?")).toBeInTheDocument();
    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText("Py")).toBeInTheDocument();
  });

  test("single-select: choosing an option and submitting answers { question: label }", async () => {
    const onAnswer = vi.fn();
    render(<QuestionPrompt question={single()} onAnswer={onAnswer} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Python/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Submit/ }));
    expect(onAnswer).toHaveBeenCalledWith({ "Which language?": "Python" });
  });

  test("Skip/Cancel calls onCancel and never onAnswer", async () => {
    const onAnswer = vi.fn();
    const onCancel = vi.fn();
    render(<QuestionPrompt question={single()} onAnswer={onAnswer} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(onCancel).toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  test("single-select: picking a second option replaces the first", async () => {
    const onAnswer = vi.fn();
    render(<QuestionPrompt question={single()} onAnswer={onAnswer} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /TypeScript/ }));
    await userEvent.click(screen.getByRole("button", { name: /Python/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Submit/ }));
    expect(onAnswer).toHaveBeenCalledWith({ "Which language?": "Python" });
  });

  test("multi-select: toggling options submits a label array", async () => {
    const q = single();
    q.questions[0]!.multiSelect = true;
    (q.toolInput as { questions: { multiSelect: boolean }[] }).questions[0]!.multiSelect = true;
    const onAnswer = vi.fn();
    render(<QuestionPrompt question={q} onAnswer={onAnswer} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /TypeScript/ }));
    await userEvent.click(screen.getByRole("button", { name: /Python/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Submit/ }));
    expect(onAnswer).toHaveBeenCalledWith({ "Which language?": ["TypeScript", "Python"] });
  });

  test("announces an awaiting region, moves focus to it, and option buttons are plain toggles with aria-pressed", async () => {
    render(<QuestionPrompt question={single()} onAnswer={() => {}} onCancel={() => {}} />);
    const region = screen.getByRole("region", { name: /question/i });
    expect(region).toHaveFocus();
    // The iris color is paired with the "Awaiting you" TEXT (color is never the sole signal).
    expect(screen.getByText(/awaiting you/i)).toBeInTheDocument();
    const option = screen.getByRole("button", { name: /TypeScript/ });
    expect(option).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(option);
    expect(option).toHaveAttribute("aria-pressed", "true");
  });

  test("Submit is disabled until every question is answered", async () => {
    render(<QuestionPrompt question={single()} onAnswer={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /^Submit/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Python/ }));
    expect(screen.getByRole("button", { name: /^Submit/ })).toBeEnabled();
  });
});
