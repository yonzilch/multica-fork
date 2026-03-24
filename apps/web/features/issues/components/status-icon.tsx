import type { IssueStatus } from "@multica/types";
import { STATUS_CONFIG } from "@/features/issues/config";

// ---------------------------------------------------------------------------
// Circle geometry constants (viewBox 0 0 16 16, center 8,8, radius 6)
// ---------------------------------------------------------------------------

const CX = 8;
const CY = 8;
const R = 6;

// ---------------------------------------------------------------------------
// Per-status SVG renderers — Linear-style icons
// ---------------------------------------------------------------------------

/** 16 small dots arranged in a ring */
function BacklogIcon() {
  const count = 16;
  const dotR = 0.65;
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={i}
            cx={CX + R * Math.cos(angle)}
            cy={CY + R * Math.sin(angle)}
            r={dotR}
            fill="currentColor"
          />
        );
      })}
    </g>
  );
}

/** Empty circle, solid outline */
function TodoIcon() {
  return (
    <circle
      cx={CX}
      cy={CY}
      r={R}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  );
}

/** Circle outline + right half filled (D-shape) */
function InProgressIcon() {
  return (
    <>
      <circle
        cx={CX}
        cy={CY}
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d={`M${CX},${CY - R} A${R},${R} 0 0,1 ${CX},${CY + R} Z`}
        fill="currentColor"
      />
    </>
  );
}

/** Circle outline + 75% pie fill (bottom-left quarter empty) */
function InReviewIcon() {
  return (
    <>
      <circle
        cx={CX}
        cy={CY}
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d={`M${CX},${CY} L${CX},${CY - R} A${R},${R} 0 1,1 ${CX - R},${CY} Z`}
        fill="currentColor"
      />
    </>
  );
}

/** Solid filled circle + white checkmark */
function DoneIcon() {
  return (
    <>
      <circle cx={CX} cy={CY} r={R} fill="currentColor" />
      <path
        d="M5.5 8.2 L7.2 9.8 L10.5 6.2"
        fill="none"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

/** Circle outline + X inside */
function CancelledIcon() {
  return (
    <>
      <circle
        cx={CX}
        cy={CY}
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M5.75 5.75 L10.25 10.25 M10.25 5.75 L5.75 10.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Renderer map
// ---------------------------------------------------------------------------

const STATUS_RENDERERS: Record<IssueStatus, () => React.ReactNode> = {
  backlog: BacklogIcon,
  todo: TodoIcon,
  in_progress: InProgressIcon,
  in_review: InReviewIcon,
  done: DoneIcon,
  blocked: CancelledIcon, // fallback if backend sends blocked
  cancelled: CancelledIcon,
};

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function StatusIcon({
  status,
  className = "h-4 w-4",
}: {
  status: IssueStatus;
  className?: string;
}) {
  const cfg = STATUS_CONFIG[status];
  const Renderer = STATUS_RENDERERS[status];

  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={`${className} ${cfg.iconColor} shrink-0`}
    >
      <Renderer />
    </svg>
  );
}
