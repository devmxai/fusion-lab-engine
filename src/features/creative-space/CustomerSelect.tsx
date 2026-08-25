import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export type CustomerSelectOption = Readonly<{ value: string; label: string; disabled?: boolean; visual?: ReactNode }>;

/** A shared, dark, accessible listbox used by all customer Standard settings. */
export function CustomerSelect({
  ariaLabel,
  compact = false,
  disabled = false,
  icon,
  label,
  onValueChange,
  options,
  value,
}: Readonly<{
  ariaLabel: string;
  /** Compact value-only control for the small Standard settings row. */
  compact?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  label?: string;
  onValueChange: (value: string) => void;
  options: readonly CustomerSelectOption[];
  value: string;
}>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? null;

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, []);

  return (
    <div ref={root} className={`relative ${compact ? "min-w-0" : ""}`}>
      {label && !compact && <span className="standard-field-label">{label}</span>}
      <button
        type="button"
        aria-label={ariaLabel}
        aria-controls={id}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className={compact
          ? `standard-compact-control flex w-full items-center justify-between gap-1.5 px-2.5 text-left text-[12px] font-bold outline-none transition disabled:cursor-not-allowed disabled:opacity-45 ${open ? "is-open" : ""}`
          : `standard-control flex w-full items-center justify-between px-3 text-left text-[12px] font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-45 ${open ? "is-open" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {icon && <span className="shrink-0 text-white/65">{icon}</span>}
          <span className="min-w-0">
            {compact && label && <span className="standard-compact-label">{label}</span>}
            <span className="block truncate">{selected?.visual ?? selected?.label ?? value}</span>
          </span>
        </span>
        <ChevronDown className={`${compact ? "h-3.5 w-3.5 text-white/45" : "h-4 w-4"} shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          id={id}
          role="listbox"
          aria-label={ariaLabel}
          className={`standard-popover standard-scroll-menu absolute z-40 mt-1.5 max-h-60 w-full overflow-y-auto p-1 ${compact ? "min-w-36" : ""}`}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                className="standard-option flex min-h-9 w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="flex min-w-0 items-center gap-2">{option.visual ?? option.label}</span>
                {active && <Check className="h-4 w-4 text-[#5dff72]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
