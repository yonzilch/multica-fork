"use client";

import { useState } from "react";
import { Bot, UserMinus } from "lucide-react";
import type { IssueAssigneeType, UpdateIssueRequest } from "@multica/types";
import { useWorkspaceStore, useActorName } from "@/features/workspace";
import {
  PropertyPicker,
  PickerItem,
  PickerSection,
  PickerEmpty,
} from "./property-picker";

export function AssigneePicker({
  assigneeType,
  assigneeId,
  onUpdate,
}: {
  assigneeType: IssueAssigneeType | null;
  assigneeId: string | null;
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const members = useWorkspaceStore((s) => s.members);
  const agents = useWorkspaceStore((s) => s.agents);
  const { getActorName, getActorInitials } = useActorName();

  const query = filter.toLowerCase();
  const filteredMembers = members.filter((m) =>
    m.name.toLowerCase().includes(query),
  );
  const filteredAgents = agents.filter((a) =>
    a.name.toLowerCase().includes(query),
  );

  const isSelected = (type: string, id: string) =>
    assigneeType === type && assigneeId === id;

  const triggerLabel =
    assigneeType && assigneeId
      ? getActorName(assigneeType, assigneeId)
      : "Unassigned";

  return (
    <PropertyPicker
      open={open}
      onOpenChange={(v: boolean) => {
        setOpen(v);
        if (!v) setFilter("");
      }}
      width="w-52"
      searchable
      searchPlaceholder="Assign to..."
      onSearchChange={setFilter}
      trigger={
        assigneeType && assigneeId ? (
          <>
            <div
              className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium text-[8px] ${
                assigneeType === "agent"
                  ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                  : "bg-muted text-muted-foreground"
              }`}
              style={{ width: 18, height: 18 }}
            >
              {assigneeType === "agent" ? (
                <Bot style={{ width: 10, height: 10 }} />
              ) : (
                getActorInitials(assigneeType, assigneeId)
              )}
            </div>
            <span>{triggerLabel}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )
      }
    >
      {/* Unassigned option */}
      <PickerItem
        selected={!assigneeType && !assigneeId}
        onClick={() => {
          onUpdate({ assignee_type: null, assignee_id: null });
          setOpen(false);
        }}
      >
        <UserMinus className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Unassigned</span>
      </PickerItem>

      {/* Members */}
      {filteredMembers.length > 0 && (
        <PickerSection label="Members">
          {filteredMembers.map((m) => (
            <PickerItem
              key={m.user_id}
              selected={isSelected("member", m.user_id)}
              onClick={() => {
                onUpdate({
                  assignee_type: "member",
                  assignee_id: m.user_id,
                });
                setOpen(false);
              }}
            >
              <div className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-medium text-muted-foreground">
                {getActorInitials("member", m.user_id)}
              </div>
              <span>{m.name}</span>
            </PickerItem>
          ))}
        </PickerSection>
      )}

      {/* Agents */}
      {filteredAgents.length > 0 && (
        <PickerSection label="Agents">
          {filteredAgents.map((a) => (
            <PickerItem
              key={a.id}
              selected={isSelected("agent", a.id)}
              onClick={() => {
                onUpdate({
                  assignee_type: "agent",
                  assignee_id: a.id,
                });
                setOpen(false);
              }}
            >
              <div className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                <Bot style={{ width: 10, height: 10 }} />
              </div>
              <span>{a.name}</span>
            </PickerItem>
          ))}
        </PickerSection>
      )}

      {filteredMembers.length === 0 &&
        filteredAgents.length === 0 &&
        filter && <PickerEmpty />}
    </PropertyPicker>
  );
}
