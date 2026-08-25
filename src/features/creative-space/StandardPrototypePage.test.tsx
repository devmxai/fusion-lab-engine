import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StandardPrototypePage from "./StandardPrototypePage";

describe("Standard image prototype", () => {
  it("keeps the initial English experience concise and makes image generation discoverable", () => {
    render(<StandardPrototypePage />);
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "A quiet city at sunrise" } });
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
    expect(screen.queryByLabelText("Style")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));
    expect(screen.getByLabelText("Style")).toBeInTheDocument();
  });

  it("localizes the copy without mirroring the fixed workspace layout", () => {
    render(<StandardPrototypePage />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to Arabic" }));
    expect(screen.getByRole("button", { name: "توليد" })).toBeInTheDocument();
    expect(screen.queryByText("Generate")).not.toBeInTheDocument();
    expect(document.querySelector("main")?.getAttribute("dir")).toBe("ltr");
  });
});
