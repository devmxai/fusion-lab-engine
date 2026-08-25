import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StandardImageGallery } from "./StandardImageGallery";

const asset = { id: "output:one", projectId: "project", kind: "IMAGE" as const, name: "Generated · GPT Image", mimeType: "image/png", bytes: 12, status: "READY" as const, origin: "GENERATED" as const, operationId: "operation", deliveryAssetId: "private-asset", createdAt: "2026-08-24T10:00:00.000Z" };

describe("StandardImageGallery", () => {
  it("renders canonical result cards with a compact accessible action menu", () => {
    const onView = vi.fn(); const onDownload = vi.fn();
    const onUseAsReference = vi.fn();
    render(<StandardImageGallery locale="en" assets={[asset]} onView={onView} onDownload={onDownload} canUseAsReference onUseAsReference={onUseAsReference} />);
    fireEvent.click(screen.getByRole("button", { name: `View: ${asset.name}` }));
    expect(onView).toHaveBeenCalledWith(asset);
    expect(screen.getByRole("button", { name: `Asset actions: ${asset.name}` })).toHaveAttribute("aria-haspopup", "menu");
  });

  it("places the real pending operation in the asset grid", () => {
    render(<StandardImageGallery locale="en" assets={[]} onView={vi.fn()} onDownload={vi.fn()} canUseAsReference={false} onUseAsReference={vi.fn()} pendingOperation={{ state: "RUNNING", reservedCredits: 6 }} />);
    expect(screen.getByText("Generation operation")).toBeInTheDocument();
    expect(screen.getByText("RUNNING")).toBeInTheDocument();
    expect(screen.getByText("6 credits reserved")).toBeInTheDocument();
  });

  it("reacquires a private preview for a visible persisted result without changing its canonical asset", async () => {
    const onResolvePreview = vi.fn().mockResolvedValue("blob:private-preview");
    render(
      <StandardImageGallery
        locale="en"
        assets={[asset]}
        onView={vi.fn()}
        onDownload={vi.fn()}
        canUseAsReference={false}
        onUseAsReference={vi.fn()}
        onResolvePreview={onResolvePreview}
      />,
    );
    await waitFor(() => expect(onResolvePreview).toHaveBeenCalledWith(asset));
    expect(await screen.findByRole("img", { name: asset.name })).toHaveAttribute("src", "blob:private-preview");
  });
});
