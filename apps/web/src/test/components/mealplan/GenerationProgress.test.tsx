import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenerationProgress } from "@/components/mealplan/GenerationProgress";

describe("GenerationProgress", () => {
  it("announces meal-denominated progress via exactly one role=status live region", () => {
    render(
      <GenerationProgress
        progressDone={18}
        progressTotal={28}
        onCancel={vi.fn()}
        isCancelling={false}
      />
    );
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent("18 of 28 meals ready");
    expect(statuses[0]).toHaveAttribute("aria-live", "polite");
  });

  it("shows a generic message before any progress totals are known", () => {
    render(
      <GenerationProgress
        progressDone={0}
        progressTotal={0}
        onCancel={vi.fn()}
        isCancelling={false}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(/getting started/i);
  });

  it("Cancel is always visible and invokes onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <GenerationProgress
        progressDone={1}
        progressTotal={4}
        onCancel={onCancel}
        isCancelling={false}
      />
    );
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables the cancel button and relabels it while cancelling", () => {
    render(
      <GenerationProgress progressDone={1} progressTotal={4} onCancel={vi.fn()} isCancelling />
    );
    expect(screen.getByRole("button", { name: /cancelling/i })).toBeDisabled();
  });
});
