import { Bot } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";

interface ActorAvatarProps {
  actorType: string;
  actorId: string;
  size?: number;
  getName?: (type: string, id: string) => string;
  getInitials?: (type: string, id: string) => string;
  className?: string;
}

function ActorAvatar({
  actorType,
  actorId,
  size = 20,
  getName,
  getInitials,
  className,
}: ActorAvatarProps) {
  const name = getName?.(actorType, actorId);
  const initials = getInitials?.(actorType, actorId);
  const isAgent = actorType === "agent";

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium",
        isAgent ? "bg-info/10 text-info" : "bg-muted text-muted-foreground",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      title={name}
    >
      {isAgent ? (
        <Bot style={{ width: size * 0.55, height: size * 0.55 }} />
      ) : (
        initials
      )}
    </div>
  );
}

export { ActorAvatar, type ActorAvatarProps };
