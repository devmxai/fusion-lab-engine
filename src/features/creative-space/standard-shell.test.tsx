import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  StandardMediaTabs,
  StandardShell,
  StandardStatePanel,
} from "./standard-shell";

describe("Standard shell primitives", () => {
  it("keeps the physical workspace layout stable while Arabic direction stays inside content", () => {
    const onSpaceClick = vi.fn();
    render(
      <StandardShell
        locale="ar"
        projectName="مشروع"
        onLocaleChange={vi.fn()}
        onSpaceClick={onSpaceClick}
        composer={<div>Composer</div>}
      >
        <div>Results</div>
      </StandardShell>,
    );
    expect(document.querySelector("main")?.getAttribute("dir")).toBe("ltr");
    expect(document.querySelector("main")?.className).toContain("lg:flex-col");
    expect(document.querySelector("aside")?.getAttribute("dir")).toBe("rtl");
    expect(document.querySelector(".standard-results")?.className).toContain("lg:overflow-y-auto");
    expect(screen.getByText("Composer")).toBeInTheDocument();
    expect(screen.getByText("Results")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "فتح Space" }));
    expect(onSpaceClick).toHaveBeenCalledOnce();
  });
  it("exposes a keyboard-operable media tab list and independent state panels", () => {
    const onChange = vi.fn();
    render(
      <>
        <StandardMediaTabs
          locale="en"
          active="image"
          onChange={onChange}
          enabled={["image", "video"]}
        />
        <StandardStatePanel locale="en" state="error" onRetry={onChange} />
      </>,
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Image" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith("video");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
