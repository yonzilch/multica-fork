"use client";

import { useState } from "react";
import type { IssuePriority, UpdateIssueRequest } from "@multica/types";
import { PRIORITY_ORDER, PRIORITY_CONFIG } from "@/features/issues/config";
import { PriorityIcon } from "../priority-icon";
import { PropertyPicker, PickerItem } from "./property-picker";

export function PriorityPicker({
  priority,
  onUpdate,
}: {
  priority: IssuePriority;
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
}) {
  const [open, setOpen] = useState(false);
  const cfg = PRIORITY_CONFIG[priority];

  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      width="w-44"
      trigger={
        <>
          <PriorityIcon priority={priority} />
          <span>{cfg.label}</span>
        </>
      }
    >
      {PRIORITY_ORDER.map((p) => {
        const c = PRIORITY_CONFIG[p];
        return (
          <PickerItem
            key={p}
            selected={p === priority}
            onClick={() => {
              onUpdate({ priority: p });
              setOpen(false);
            }}
          >
            <PriorityIcon priority={p} />
            <span>{c.label}</span>
          </PickerItem>
        );
      })}
    </PropertyPicker>
  );
}
