"use client";

import { useState, useCallback } from "react";
import { Check } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@multica/ui/components/ui/popover";

// ---------------------------------------------------------------------------
// PropertyPicker — generic Popover shell with optional search
// ---------------------------------------------------------------------------

export function PropertyPicker({
  open,
  onOpenChange,
  trigger,
  width = "w-48",
  align = "end",
  searchable = false,
  searchPlaceholder = "Filter...",
  onSearchChange,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger: React.ReactNode;
  width?: string;
  align?: "start" | "center" | "end";
  searchable?: boolean;
  searchPlaceholder?: string;
  onSearchChange?: (query: string) => void;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");

  const handleOpenChange = useCallback(
    (v: boolean) => {
      onOpenChange(v);
      if (!v) {
        setQuery("");
        onSearchChange?.("");
      }
    },
    [onOpenChange, onSearchChange],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className="flex items-center gap-1.5 cursor-pointer rounded px-1 -mx-1 hover:bg-accent/30 transition-colors">
        {trigger}
      </PopoverTrigger>
      <PopoverContent align={align} className={`${width} gap-0 p-0`}>
        {searchable && (
          <div className="px-2 py-1.5 border-b">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                onSearchChange?.(e.target.value);
              }}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-[13px] placeholder:text-muted-foreground outline-none"
            />
          </div>
        )}
        <div className="p-1 max-h-60 overflow-y-auto">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// PickerItem — single selectable row
// ---------------------------------------------------------------------------

export function PickerItem({
  selected,
  onClick,
  hoverClassName,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  hoverClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${hoverClassName ?? "hover:bg-accent"} transition-colors`}
    >
      <span className="flex flex-1 items-center gap-2">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PickerSection — group header
// ---------------------------------------------------------------------------

export function PickerSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PickerEmpty — no results state
// ---------------------------------------------------------------------------

export function PickerEmpty() {
  return (
    <div className="px-2 py-3 text-center text-[13px] text-muted-foreground">
      No results
    </div>
  );
}
