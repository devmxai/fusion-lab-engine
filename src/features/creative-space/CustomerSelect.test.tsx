import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomerSelect } from "./CustomerSelect";

describe("CustomerSelect", () => {
  it("uses a dark custom listbox instead of a native select", () => {
    const onValueChange = vi.fn();
    render(
      <CustomerSelect
        ariaLabel="Resolution"
        value="1K"
        options={[{ value: "1K", label: "1K" }, { value: "2K", label: "2K" }]}
        onValueChange={onValueChange}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resolution" }));
    fireEvent.click(screen.getByRole("option", { name: "2K" }));
    expect(onValueChange).toHaveBeenCalledWith("2K");
  });
});
