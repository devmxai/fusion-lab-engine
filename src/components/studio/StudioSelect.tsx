import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronDown, Lock } from "lucide-react";

export interface SelectItem {
  value: string;
  label: string;
  locked?: boolean;
  lockLabel?: string;
}

interface StudioSelectProps {
  label: string;
  displayValue: string;
  selected: string;
  items: SelectItem[];
  onSelect: (value: string) => void;
}

export function StudioSelect({ label, displayValue, selected, items, onSelect }: StudioSelectProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const triggerBtn = (
    <button
      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border bg-primary/10 border-primary/50 transition-all duration-200"
    >
      <span className="text-xs font-bold truncate max-w-[110px] text-primary">{displayValue}</span>
      <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );

  const itemsList = (
    <div className="p-1.5 space-y-0.5">
      {items.map((item) => (
        <button
          key={item.value}
          disabled={item.locked}
          onClick={() => {
            if (!item.locked) {
              onSelect(item.value);
              setOpen(false);
            }
          }}
          className={`w-full px-3.5 py-2.5 rounded-lg text-right text-sm font-semibold transition-colors flex items-center justify-between gap-2 ${
            item.locked
              ? "opacity-50 cursor-not-allowed text-muted-foreground"
              : selected === item.value
              ? "bg-primary/10 text-primary"
              : "text-foreground hover:bg-secondary/50"
          }`}
        >
          <span>{item.label}</span>
          {item.locked && item.lockLabel && (
            <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">
              <Lock className="w-2.5 h-2.5" />
              {item.lockLabel}
            </span>
          )}
        </button>
      ))}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{triggerBtn}</DrawerTrigger>
        <DrawerContent>
          <div className="px-4 py-3 pb-8" dir="ltr">
            <p className="text-sm font-bold text-foreground mb-3 text-right">{label}</p>
            {itemsList}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{triggerBtn}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-auto min-w-[120px] p-0 bg-card/95 backdrop-blur-xl border-primary/30 z-[220]"
        dir="ltr"
      >
        {itemsList}
      </PopoverContent>
    </Popover>
  );
}
