// The icon set. PROVISIONAL: lucide-react (ISC licence) stands in for the Infora icon set until the
// audit records the Infora icons (docs/01 "The icon set and its source"). Change the icons in this file only.
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  Crosshair,
  Ellipsis,
  ExternalLink,
  FileSearch,
  GripVertical,
  Inbox,
  Info,
  Keyboard,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Radio,
  RotateCcw,
  Search,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { cx } from "./lib/utils";

export type IconComponent = LucideIcon;

export const icons = {
  activity: Activity,
  alert: TriangleAlert,
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  sort: ArrowUpDown,
  calendar: Calendar,
  check: Check,
  chevronDown: ChevronDown,
  error: CircleAlert,
  review: ClipboardCheck,
  target: Crosshair,
  more: Ellipsis,
  externalLink: ExternalLink,
  evidence: FileSearch,
  grip: GripVertical,
  empty: Inbox,
  info: Info,
  keyboard: Keyboard,
  layout: LayoutGrid,
  logout: LogOut,
  maximise: Maximize2,
  restore: Minimize2,
  collapse: Minus,
  add: Plus,
  live: Radio,
  reset: RotateCcw,
  search: Search,
  users: Users,
  close: X,
} satisfies Record<string, IconComponent>;

export type IconName = keyof typeof icons;

export interface IconProps {
  name: IconName;
  size?: "sm" | "md";
  /** Give a label only when the icon is the only content of a control. Otherwise the icon is hidden from assistive technology. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = "md", label, className }: IconProps) {
  const Component = icons[name];
  return (
    <Component
      className={cx("sds-icon", size === "sm" && "sds-icon--sm", className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable="false"
    />
  );
}
