import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  publishedOfferFamilyKey,
  publishedOfferSupportsRecipe,
  type PublishedMediaKind,
  type PublishedOffer,
} from "./published-offers-client";
import { customerModelFamilyPresentation, customerModelPresentation, customerModelProductFamilyKey, customerModelVersionKey, CustomerModelMark } from "./model-presentation";
import { CustomerSelect } from "./CustomerSelect";
import { standardCopy } from "./standard-i18n";
import type { UiFuxLocale } from "./product-decisions";

type Props = Readonly<{
  locale: UiFuxLocale;
  offers: readonly PublishedOffer[];
  mediaType?: PublishedMediaKind;
  /**
   * When omitted the picker shows every released model in the media area.
   * This is used by Standard before the customer chooses a supported method.
   * Passing a recipe keeps the picker constrained to that executable route.
   */
  recipeId?: string | null;
  selectedOfferId: string | null;
  onSelect: (offer: PublishedOffer) => void;
}>;

type ModelFamily = Readonly<{
  key: string;
  name: string;
  brand: ReturnType<typeof customerModelPresentation>["brand"];
  offers: readonly PublishedOffer[];
}>;

type ModelVersion = Readonly<{
  offer: PublishedOffer;
  key: string;
  label: string;
}>;

/** A presentational picker. Its options are strictly released customer offers. */
export function PublishedModelPicker({
  locale,
  offers,
  mediaType = "image",
  recipeId = "image.create",
  selectedOfferId,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const text = standardCopy(locale);
  const eligible = useMemo(
    () =>
      offers.filter(
        (offer) =>
          offer.capability.mediaType === mediaType &&
          (recipeId === null || publishedOfferSupportsRecipe(offer, recipeId)),
      ),
    [mediaType, offers, recipeId],
  );
  const visible = useMemo(
    () => {
      const grouped = new Map<string, ModelFamily>();
      eligible.forEach((offer) => {
        const presentation = customerModelFamilyPresentation(offer);
        const key = customerModelProductFamilyKey(offer);
        const existing = grouped.get(key);
        grouped.set(key, {
          key,
          name: presentation.familyName,
          brand: presentation.brand,
          offers: [...(existing?.offers ?? []), offer],
        });
      });
      return [...grouped.values()];
    },
    [eligible],
  );
  const selected =
    eligible.find((offer) => offer.offerId === selectedOfferId) ?? null;
  const selectedPresentation = selected ? customerModelPresentation(selected) : null;
  const selectedFamily = selected ? customerModelFamilyPresentation(selected) : null;
  const selectedFamilyKey = selected ? customerModelProductFamilyKey(selected) : null;
  const selectedVersions = useMemo<readonly ModelVersion[]>(() => {
    if (!selectedFamilyKey) return [];
    const versions = new Map<string, ModelVersion>();
    eligible.filter((offer) => customerModelProductFamilyKey(offer) === selectedFamilyKey)
      .forEach((offer) => {
        const item = customerModelFamilyPresentation(offer);
        if (item.version === null) return null;
        const label = [item.version, item.edition].filter(Boolean).join(" ");
        const key = customerModelVersionKey(offer);
        // Keep the already-selected executable route when the version has
        // several methods. The method picker chooses the sibling route later.
        const existing = versions.get(key);
        if (!existing || offer.offerId === selectedOfferId) versions.set(key, { offer, key, label });
      });
    return [...versions.values()].sort((left, right) => right.label.localeCompare(left.label, undefined, { numeric: true }));
  }, [eligible, selectedFamilyKey, selectedOfferId]);
  const label = selectedFamily?.familyName ?? (locale === "en" ? "Select model" : "اختر النموذج");
  const pickerLabel = locale === "en" ? "Select model" : "اختر النموذج";
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, []);
  if (!eligible.length)
    return (
      <div
        role="status"
        className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100"
      >
        {locale === "en"
          ? `No published ${mediaType} models are available.`
          : "لا توجد نماذج منشورة متاحة لهذا النوع."}
      </div>
    );
  return (
    <div ref={root} className="relative">
      <span className="standard-field-label">{pickerLabel}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`standard-control flex w-full items-center justify-between px-3 text-[12px] font-semibold text-left outline-none transition ${open ? "is-open" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedPresentation && <CustomerModelMark presentation={selectedPresentation} className="h-7 w-7 rounded-md" />}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={text.model}
          className="standard-popover absolute z-30 mt-1.5 w-full p-1"
        >
          <div role="listbox" className="standard-scroll-menu max-h-72 overflow-y-auto">
            {visible.map((family) => {
              const selectedInFamily = family.offers.some((offer) => offer.offerId === selectedOfferId);
              const presentation = { name: family.name, brand: family.brand };
              return (
              <button
                key={family.key}
                type="button"
                role="option"
                aria-selected={selectedInFamily}
                  onClick={() => {
                  onSelect(family.offers.find((offer) => offer.offerId === selectedOfferId) ?? family.offers[0]!);
                  setOpen(false);
                }}
                className="standard-option flex min-h-11 w-full items-center gap-2 rounded-lg p-2.5 text-left text-[12px] transition"
              >
                <CustomerModelMark presentation={presentation} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">
                    {presentation.name}
                  </span>
                </span>
                {selectedInFamily && (
                  <Check className="h-4 w-4 shrink-0 text-[#5dff72]" />
                )}
              </button>
              );
            })}
            {!visible.length && (
              <p className="p-4 text-center text-xs text-white/50">
                {locale === "en"
                  ? "No matching published model."
                  : "لا يوجد نموذج منشور مطابق."}
              </p>
            )}
          </div>
        </div>
      )}
      {selectedVersions.length > 0 && (
        <div className="mt-2.5">
          <CustomerSelect
            ariaLabel={locale === "en" ? "Version" : "الإصدار"}
            label={locale === "en" ? "Version" : "الإصدار"}
            disabled={selectedVersions.length === 1}
            value={selected ? customerModelVersionKey(selected) : ""}
            options={selectedVersions.map(({ key, label }) => ({ value: key, label: `v${label}` }))}
            onValueChange={(versionKey) => {
              const next = selectedVersions.find((item) => item.key === versionKey)?.offer;
              if (next) onSelect(next);
            }}
          />
        </div>
      )}
    </div>
  );
}
