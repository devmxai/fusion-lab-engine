import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishedModelPicker } from "./PublishedModelPicker";
import { standardPrototypeImageOffer } from "./standard-prototype-fixture";

describe("PublishedModelPicker", () => {
  it("shows only published image.create offers and returns the exact selected offer", () => {
    const onSelect = vi.fn();
    const notImage = { ...standardPrototypeImageOffer, offerId: "video", capability: { ...standardPrototypeImageOffer.capability, mediaType: "video" as const } };
    render(<PublishedModelPicker locale="en" offers={[standardPrototypeImageOffer, notImage]} selectedOfferId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Select model" }));
    expect(screen.getByRole("option", { name: /GPT Image/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /video/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /GPT Image/i }));
    expect(onSelect).toHaveBeenCalledWith(standardPrototypeImageOffer);
  });

  it("uses the customer model name without exposing a provider or route", () => {
    render(
      <PublishedModelPicker
        locale="en"
        offers={[standardPrototypeImageOffer]}
        selectedOfferId={standardPrototypeImageOffer.offerId}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "GPT Image" })).toBeInTheDocument();
    expect(screen.queryByText(/kie/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/gpt-image-2/i)).not.toBeInTheDocument();
  });

  it("filters the picker by the selected customer intent", () => {
    const imageEdit = {
      ...standardPrototypeImageOffer,
      offerId: "prototype.gpt-image-2-edit",
      displayName: "GPT Image 2 Edit",
      capability: {
        ...standardPrototypeImageOffer.capability,
        controlSchema: {
          ...standardPrototypeImageOffer.capability.controlSchema,
          recipes: standardPrototypeImageOffer.capability.controlSchema.recipes.map((recipe) => ({
            ...recipe,
            recipeId: "image.edit",
            bindings: { ...recipe.bindings, min: 1, max: 1 },
          })),
        },
      },
    };
    render(
      <PublishedModelPicker
        locale="en"
        offers={[standardPrototypeImageOffer, imageEdit]}
        recipeId="image.edit"
        selectedOfferId={null}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select model" }));
    expect(screen.getByRole("option", { name: /GPT Image/i })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("groups released offers by customer family and lets the customer select an exact version", () => {
    const onSelect = vi.fn();
    const versionOne = {
      ...standardPrototypeImageOffer,
      offerId: "prototype.gpt-image-1",
      providerModelId: "gpt-image-1",
      displayName: "GPT Image 1",
      modelFamilyId: "family.gpt-image-1",
      identity: { ...standardPrototypeImageOffer.identity, familyId: "family.gpt-image-1", officialModelId: "gpt-image-1" },
    };
    render(<PublishedModelPicker locale="en" offers={[standardPrototypeImageOffer, versionOne]} selectedOfferId={standardPrototypeImageOffer.offerId} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "GPT Image" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Version" }));
    fireEvent.click(screen.getByRole("option", { name: "v1" }));
    expect(onSelect).toHaveBeenCalledWith(versionOne);
  });

  it("uses the reviewed product hierarchy when it is released, instead of guessing a customer name from the provider model id", () => {
    const reviewed = {
      ...standardPrototypeImageOffer,
      presentation: {
        schemaVersion: 1 as const,
        productFamily: { id: "family.image-studio", displayName: "Image Studio" },
        version: { id: "2", displayName: "2" },
        edition: { id: "pro", displayName: "Pro" },
        experienceCategories: ["IMAGE"] as const,
      },
    };
    const reviewedPreviousVersion = {
      ...reviewed,
      offerId: "prototype.image-studio-1",
      providerModelId: "opaque-provider-model-v1",
      presentation: {
        ...reviewed.presentation,
        version: { id: "1", displayName: "1" },
      },
    };
    render(<PublishedModelPicker locale="en" offers={[reviewed, reviewedPreviousVersion]} selectedOfferId={reviewed.offerId} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Image Studio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Version" })).toHaveTextContent("2 Pro");
  });

  it("uses the same family/version selector for released video offers without exposing the provider", () => {
    const onSelect = vi.fn();
    const video = {
      ...standardPrototypeImageOffer,
      offerId: "video.kling-3",
      displayName: "Kling 3.0",
      providerModelId: "kling/v3-image-to-video",
      modelFamilyId: "family.kling-3",
      identity: { ...standardPrototypeImageOffer.identity, familyId: "family.kling-3", officialModelId: "kling/v3-image-to-video" },
      capability: {
        ...standardPrototypeImageOffer.capability,
        mediaType: "video" as const,
        controlSchema: {
          ...standardPrototypeImageOffer.capability.controlSchema,
          recipes: standardPrototypeImageOffer.capability.controlSchema.recipes.map((recipe) => ({ ...recipe, recipeId: "video.image-to-video" })),
        },
      },
    };
    render(<PublishedModelPicker locale="en" offers={[standardPrototypeImageOffer, video]} mediaType="video" recipeId="video.image-to-video" selectedOfferId={video.offerId} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Kling" })).toBeInTheDocument();
    expect(screen.queryByText(/kie/i)).not.toBeInTheDocument();
  });

  it("keeps Kling 3.0 and Kling 3.0 Turbo as separate selectable versions", () => {
    const kling3 = {
      ...standardPrototypeImageOffer,
      offerId: "video.kling-3",
      displayName: "Kling 3.0",
      providerModelId: "kling-3.0/video",
      modelFamilyId: "family.kling",
      identity: { ...standardPrototypeImageOffer.identity, familyId: "family.kling", officialModelId: "kling-3.0/video" },
      capability: { ...standardPrototypeImageOffer.capability, mediaType: "video" as const, controlSchema: { ...standardPrototypeImageOffer.capability.controlSchema, recipes: standardPrototypeImageOffer.capability.controlSchema.recipes.map((recipe) => ({ ...recipe, recipeId: "video.image-to-video" })) } },
    };
    const turbo = {
      ...kling3,
      offerId: "video.kling-3-turbo",
      displayName: "Kling V3 Turbo",
      providerModelId: "kling/v3-turbo-image-to-video",
      identity: { ...kling3.identity, officialModelId: "kling/v3-turbo-image-to-video" },
    };
    render(<PublishedModelPicker locale="en" offers={[kling3, turbo]} mediaType="video" recipeId="video.image-to-video" selectedOfferId={kling3.offerId} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Version" })).toHaveTextContent("v3.0 Standard");
    fireEvent.click(screen.getByRole("button", { name: "Version" }));
    expect(screen.getByRole("option", { name: "v3.0 Standard" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "v3.0 Turbo" })).toBeInTheDocument();
  });

  it("can select a released video model before the customer chooses its executable method", () => {
    const textToVideo = {
      ...standardPrototypeImageOffer,
      offerId: "video.text-route",
      displayName: "Cinematic Video",
      providerModelId: "video/cinematic-text",
      modelFamilyId: "family.cinematic-video",
      identity: { ...standardPrototypeImageOffer.identity, familyId: "family.cinematic-video", officialModelId: "video/cinematic-text" },
      capability: {
        ...standardPrototypeImageOffer.capability,
        mediaType: "video" as const,
        controlSchema: {
          ...standardPrototypeImageOffer.capability.controlSchema,
          recipes: standardPrototypeImageOffer.capability.controlSchema.recipes.map((recipe) => ({ ...recipe, recipeId: "video.text-to-video" })),
        },
      },
    };
    render(<PublishedModelPicker locale="en" offers={[textToVideo]} mediaType="video" recipeId={null} selectedOfferId={textToVideo.offerId} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Cinematic Video" })).toBeInTheDocument();
  });

  it("does not duplicate a version when that product version has multiple executable routes", () => {
    const imageToVideo = {
      ...standardPrototypeImageOffer,
      offerId: "video.cinematic.image",
      providerModelId: "video/cinematic-image",
      modelFamilyId: "family.cinematic-video",
      identity: { ...standardPrototypeImageOffer.identity, familyId: "family.cinematic-video", officialModelId: "video/cinematic-image" },
      presentation: {
        schemaVersion: 1 as const,
        productFamily: { id: "cinematic", displayName: "Cinematic" },
        version: { id: "3", displayName: "3" },
        experienceCategories: ["VIDEO"] as const,
      },
      capability: {
        ...standardPrototypeImageOffer.capability,
        mediaType: "video" as const,
        controlSchema: { ...standardPrototypeImageOffer.capability.controlSchema, recipes: standardPrototypeImageOffer.capability.controlSchema.recipes.map((recipe) => ({ ...recipe, recipeId: "video.image-to-video" })) },
      },
    };
    const textToVideo = {
      ...imageToVideo,
      offerId: "video.cinematic.text",
      providerModelId: "video/cinematic-text",
      identity: { ...imageToVideo.identity, officialModelId: "video/cinematic-text" },
      capability: { ...imageToVideo.capability, controlSchema: { ...imageToVideo.capability.controlSchema, recipes: imageToVideo.capability.controlSchema.recipes.map((recipe) => ({ ...recipe, recipeId: "video.text-to-video" })) } },
    };
    render(<PublishedModelPicker locale="en" offers={[imageToVideo, textToVideo]} mediaType="video" recipeId={null} selectedOfferId={imageToVideo.offerId} onSelect={vi.fn()} />);
    // Both routes are the same released product version. Standard keeps the
    // explicit Model → Version hierarchy visible, but locks the single
    // version instead of presenting the routes as duplicate versions.
    expect(screen.getByRole("button", { name: "Version" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Version" })).toHaveTextContent("v3");
  });
});
