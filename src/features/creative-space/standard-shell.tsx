import { type KeyboardEvent, type ReactNode, useId } from "react";
import {
  AlertCircle,
  ChevronDown,
  Globe2,
  ImageIcon,
  Loader2,
  Music2,
  UserRound,
  Video,
  WalletCards,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { standardCopy, standardDirection } from "./standard-i18n";
import type { UiFuxLocale } from "./product-decisions";

export type StandardMediaTab = "image" | "video" | "audio";

export function StandardShell({
  locale,
  projectName,
  onLocaleChange,
  onSpaceClick,
  availableCredits,
  onProfileClick,
  composer,
  children,
}: {
  locale: UiFuxLocale;
  projectName: string;
  onLocaleChange: () => void;
  onSpaceClick?: () => void;
  availableCredits?: number | null;
  onProfileClick?: () => void;
  composer: ReactNode;
  children: ReactNode;
}) {
  const text = standardCopy(locale);
  const credits =
    availableCredits === null || availableCredits === undefined
      ? "—"
      : new Intl.NumberFormat(locale === "ar" ? "ar-IQ" : "en-US").format(
          availableCredits,
        );
  // Locale direction belongs to readable content, never to the workspace grid.
  // This keeps the left composer and the results canvas physically stable.
  return (
    <main
      lang={locale}
      dir="ltr"
      className="standard-shell min-h-screen w-full overflow-x-hidden overscroll-y-auto bg-[#090b0f] text-white lg:flex lg:h-dvh lg:min-h-0 lg:flex-col lg:overflow-x-hidden lg:overflow-y-hidden"
    >
      <header className="standard-topbar relative z-30 flex h-[68px] shrink-0 items-center justify-between border-b border-white/[0.07] px-5 sm:px-7 lg:sticky lg:top-0">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-7 w-7 place-items-center overflow-hidden rounded-lg border border-white/[0.1] bg-[#15181d]">
            <img src="/logo-icon.png" alt="" className="h-5 w-5 object-contain" />
            <span className="sr-only">FusionLab</span>
          </div>
          <button
            type="button"
            onClick={onLocaleChange}
            aria-label={
              locale === "en" ? "Switch to Arabic" : "التبديل إلى الإنجليزية"
            }
            className="grid h-7 w-7 place-items-center rounded-lg text-white/65 transition hover:bg-white/[0.06] hover:text-white"
          >
            <Globe2 className="h-[18px] w-[18px]" />
          </button>
          <span className="hidden max-w-48 truncate text-xs font-medium text-white/40 xl:inline">
            {projectName}
          </span>
        </div>
        <div
          className="absolute left-1/2 hidden -translate-x-1/2 rounded-xl border border-white/[0.08] bg-black/30 p-1 sm:flex"
          aria-label="Workspace mode"
        >
          <span
            className="rounded-lg border border-[#5dff72]/55 bg-[#1fae45]/30 px-5 py-1.5 text-[12px] font-semibold text-[#eaffed] shadow-[0_2px_12px_rgba(31,174,69,.28)]"
            aria-current="page"
          >
            {text.standard}
          </span>
          <button
            type="button"
            onClick={onSpaceClick}
            className="rounded-lg px-5 py-1.5 text-[12px] font-semibold text-white/45 transition hover:bg-white/[0.05] hover:text-white"
            aria-label={locale === "en" ? "Open Space" : "فتح Space"}
          >
            {text.space}
          </button>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="hidden items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-2.5 py-1.5 text-[11px] font-medium text-white/75 sm:flex">
            <WalletCards className="h-3.5 w-3.5 text-white/70" />
            <span dir="ltr">
              {credits} {text.credits}
            </span>
          </div>
          <button
            type="button"
            onClick={onProfileClick}
            aria-label={locale === "en" ? "Open profile" : "فتح الملف الشخصي"}
            className="grid h-7 w-7 place-items-center rounded-full border border-white/[0.14] bg-white/[0.05] text-white/75 transition hover:border-white/40 hover:text-white"
          >
            <UserRound className="h-4 w-4" />
          </button>
          <ChevronDown
            className="h-3.5 w-3.5 text-white/45"
            aria-hidden="true"
          />
        </div>
      </header>
      <div className="standard-shell-grid grid min-h-[calc(100dvh-68px)] min-w-0 gap-5 overflow-x-hidden p-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[clamp(320px,25vw,420px)_minmax(0,1fr)] lg:gap-6 lg:overflow-hidden lg:overscroll-none lg:px-5 lg:py-6">
        <aside
          dir={standardDirection(locale)}
          className="standard-composer hidden min-h-0 min-w-0 self-start lg:block lg:h-full lg:self-stretch"
        >
          {composer}
        </aside>
        <section
          dir={standardDirection(locale)}
          className="standard-results min-h-0 min-w-0 overflow-x-hidden lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:overscroll-x-none lg:pr-1"
        >
          {children}
        </section>
      </div>
      <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={
                locale === "en" ? "Open composer" : "فتح لوحة الإنشاء"
              }
              className="standard-primary-action w-full px-4 py-3 text-sm shadow-xl"
            >
              {text.create}
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="max-h-[88dvh] overflow-y-auto rounded-t-3xl border-white/10 bg-[#0d1015] p-4"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{text.create}</SheetTitle>
              <SheetDescription>{text.loading}</SheetDescription>
            </SheetHeader>
            {composer}
          </SheetContent>
        </Sheet>
      </div>
    </main>
  );
}

export function StandardMediaTabs({
  locale,
  active,
  onChange,
  enabled = ["image"],
}: {
  locale: UiFuxLocale;
  active: StandardMediaTab;
  onChange: (tab: StandardMediaTab) => void;
  enabled?: readonly StandardMediaTab[];
}) {
  const text = standardCopy(locale);
  const id = useId();
  const tabs: readonly StandardMediaTab[] = ["image", "video", "audio"];
  const focusRelative = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: StandardMediaTab,
  ) => {
    const current = tabs.indexOf(tab);
    const key = event.key;
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? tabs.length - 1
          : key === "ArrowRight"
            ? (current + 1) % tabs.length
            : key === "ArrowLeft"
              ? (current + tabs.length - 1) % tabs.length
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const nextTab = tabs[next];
    if (enabled.includes(nextTab)) onChange(nextTab);
    document.getElementById(`${id}-${nextTab}`)?.focus();
  };
  const icons = { image: ImageIcon, video: Video, audio: Music2 } as const;
  const labels: Record<StandardMediaTab, string> = {
    image: text.image,
    video: text.video,
    audio: text.audio,
  };
  return (
    <div
      role="tablist"
      aria-label={text.create}
      className="grid grid-cols-3 rounded-xl border border-white/[0.1] bg-[#0a0c10] p-1"
    >
      {tabs.map((tab) => {
        const Icon = icons[tab];
        return (
          <button
            key={tab}
            id={`${id}-${tab}`}
            type="button"
            role="tab"
            aria-selected={active === tab}
            disabled={!enabled.includes(tab)}
            onKeyDown={(event) => focusRelative(event, tab)}
            onClick={() => onChange(tab)}
            title={!enabled.includes(tab) ? (locale === "en" ? "Not available yet" : "غير متاح حالياً") : undefined}
            className="inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold text-white/45 transition hover:bg-[#1fae45]/[0.12] hover:text-[#dbffe1] aria-selected:border aria-selected:border-[#5dff72]/60 aria-selected:bg-[#1fae45]/[0.28] aria-selected:text-[#eaffed] aria-selected:shadow-[0_2px_12px_rgba(31,174,69,.28)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="truncate">{labels[tab]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function StandardStatePanel({
  state,
  locale,
  onRetry,
}: {
  state: "loading" | "empty" | "error";
  locale: UiFuxLocale;
  onRetry?: () => void;
}) {
  const text = standardCopy(locale);
  if (state === "loading")
    return (
      <div
        role="status"
        className="grid min-h-60 place-items-center rounded-2xl border border-white/10 bg-white/[0.02] text-sm text-white/55"
      >
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {text.loading}
        </span>
      </div>
    );
  if (state === "empty")
    return (
      <div className="grid min-h-60 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-sm text-white/55">
        {text.empty}
      </div>
    );
  return (
    <div
      role="alert"
      className="grid min-h-60 place-items-center rounded-2xl border border-red-400/25 bg-red-400/5 p-6 text-center"
    >
      <div>
        <AlertCircle className="mx-auto h-5 w-5 text-red-300" />
        <p className="mt-2 text-sm font-semibold">{text.error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold"
          >
            {text.retry}
          </button>
        )}
      </div>
    </div>
  );
}
