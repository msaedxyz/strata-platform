// Story fixtures. Neutral sample data, not facts from the canonical record.
import type { NavItem } from "./Shell";

export const navItems: NavItem[] = [
  { id: "origination", label: "Origination", icon: "target", shortcut: "g 1" },
  { id: "relationships", label: "Relations", icon: "users", shortcut: "g 2" },
  { id: "monitoring", label: "Monitoring", icon: "activity", shortcut: "g 3" },
  { id: "review", label: "Review", icon: "review", shortcut: "g 4" },
];

export const noop = () => undefined;

export const userItems = [
  { id: "shortcuts", label: "Keyboard shortcuts", icon: "keyboard" as const, shortcut: "?", onSelect: noop },
  { id: "logout", label: "Log out", icon: "logout" as const, onSelect: noop },
];
