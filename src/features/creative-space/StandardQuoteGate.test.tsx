import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StandardQuoteGate } from "./StandardQuoteGate";

const quote = { id: "quote-1", customerCredits: 6, expiresAt: "2099-01-01T00:00:00.000Z", configuration: { recipeId: "image.create", settings: { resolution: "1K", aspectRatio: "9:16" }, bindingCount: 0, bindingRoles: [] } } as any;

describe("StandardQuoteGate", () => {
  it("chains the exact quote and one idempotent reservation behind one customer action", async () => {
    const requestQuote = vi.fn().mockResolvedValue(quote);
    const confirmQuote = vi.fn().mockResolvedValue({ quote, operation: {}, localOnly: false });
    const onReserved = vi.fn();
    render(<StandardQuoteGate locale="en" canQuote requestQuote={requestQuote} confirmQuote={confirmQuote} onReserved={onReserved} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(requestQuote).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(confirmQuote).toHaveBeenCalledWith(quote, expect.any(String)));
    expect(onReserved).toHaveBeenCalledTimes(1);
    expect(screen.getByText("6 credits reserved securely.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generation started" })).toBeDisabled();
  });

  it("shows a typed quote or reservation error without reporting a reservation", async () => {
    const confirmQuote = vi.fn().mockRejectedValue(new Error("Insufficient credits. No generation was started."));
    const onReserved = vi.fn();
    render(<StandardQuoteGate locale="en" canQuote requestQuote={vi.fn().mockResolvedValue(quote)} confirmQuote={confirmQuote} onReserved={onReserved} formatError={() => "Insufficient credits. No generation was started."} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Insufficient credits. No generation was started.");
    expect(onReserved).not.toHaveBeenCalled();
  });
});
