/**
 * ProviderIcon — renders the real, full-color brand logo for each model provider.
 * Uses SimpleIcons CDN (brand-colored) for well-known brands, bundled image
 * assets for brands not on SimpleIcons (e.g. Grok), and inline monograms as
 * a last resort.
 */
import { useState } from "react";
import grokLogo from "@/assets/providers/grok.png";

type IconConfig =
  | { kind: "simple"; slug: string; bg: string }
  | { kind: "asset"; src: string; bg: string; pad?: number }
  | { kind: "monogram"; label: string; bg: string; fg: string };

// SimpleIcons returns the official brand color when no color override is set.
// White circular background ensures every colored logo stays crisp on dark UI.
const WHITE = "#ffffff";

const PROVIDER_ICONS: Record<string, IconConfig> = {
  // xAI = Grok. Official mark is not on SimpleIcons → ship the real logo asset.
  "xAI":        { kind: "asset",    src: grokLogo,        bg: WHITE, pad: 0.78 },
  "OpenAI":     { kind: "simple",   slug: "openai",       bg: WHITE },
  "Google":     { kind: "simple",   slug: "google",       bg: WHITE },
  "Bytedance":  { kind: "simple",   slug: "bytedance",    bg: WHITE },
  "Alibaba":    { kind: "simple",   slug: "alibabacloud", bg: WHITE },
  // Kling AI is built by Kuaishou — Kuaishou's official logo is on SimpleIcons.
  "Kling":      { kind: "simple",   slug: "kuaishou",     bg: WHITE },
  // Brands not on SimpleIcons — full-color monogram in the brand's official color.
  "Flux":       { kind: "monogram", label: "F", bg: "#FFD400", fg: "#000000" }, // Black Forest Labs yellow
  "Recraft":    { kind: "monogram", label: "R", bg: "#FF3D00", fg: "#ffffff" },
  "Topaz":      { kind: "monogram", label: "T", bg: "#FFC107", fg: "#000000" },
  "KIE.AI":     { kind: "monogram", label: "K", bg: "#6E56CF", fg: "#ffffff" },
  "Infinitalk": { kind: "monogram", label: "∞", bg: "#0EA5A4", fg: "#ffffff" },
};

interface Props {
  provider: string;
  size?: number;
  className?: string;
}

export const ProviderIcon = ({ provider, size = 28, className = "" }: Props) => {
  const cfg = PROVIDER_ICONS[provider] ?? {
    kind: "monogram" as const,
    label: provider[0] ?? "?",
    bg: "#2a2a2a",
    fg: "#ffffff",
  };
  const [errored, setErrored] = useState(false);

  const base =
    "shrink-0 rounded-full flex items-center justify-center overflow-hidden";
  const style = { width: size, height: size, background: cfg.bg };

  if (cfg.kind === "simple" && !errored) {
    return (
      <span className={`${base} ${className}`} style={style} aria-label={provider}>
        <img
          src={`https://cdn.simpleicons.org/${cfg.slug}`}
          alt={provider}
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          loading="lazy"
          onError={() => setErrored(true)}
          style={{ objectFit: "contain" }}
        />
      </span>
    );
  }

  if (cfg.kind === "asset") {
    const inner = Math.round(size * (cfg.pad ?? 0.7));
    return (
      <span className={`${base} ${className}`} style={style} aria-label={provider}>
        <img
          src={cfg.src}
          alt={provider}
          width={inner}
          height={inner}
          loading="lazy"
          style={{ objectFit: "contain" }}
        />
      </span>
    );
  }

  const label = cfg.kind === "monogram" ? cfg.label : provider[0] ?? "?";
  const fg = cfg.kind === "monogram" ? cfg.fg : "#ffffff";
  return (
    <span
      className={`${base} font-extrabold ${className}`}
      style={{ ...style, color: fg, fontSize: Math.round(size * 0.45) }}
      aria-label={provider}
    >
      {label}
    </span>
  );
};

export default ProviderIcon;
