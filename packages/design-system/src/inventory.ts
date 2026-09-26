// The component inventory: each component and the states that its stories show.
// PROVISIONAL until audit/components.md exists. The visual test reads the audit list, not this one.
// A unit test checks that each state here has a story with the same name.

export type ComponentState =
  | "default"
  | "hover"
  | "focus"
  | "active"
  | "disabled"
  | "loading"
  | "empty"
  | "error"
  | "open"
  | "selected"
  | "collapsed"
  | "maximised"
  | "paused"
  | "unconfirmed"
  | "reported"
  | "confirmed"
  | "dismissed"
  | "pending-approval"
  | "checked"
  | "indeterminate"
  | "fresh";

export const componentInventory: Record<string, ComponentState[]> = {
  AppShell: ["default", "loading"],
  NavRail: ["default", "focus"],
  TopBar: ["default"],
  SearchInput: ["default", "hover", "focus", "disabled", "loading"],
  CommandPalette: ["default", "empty", "loading", "error"],
  UserMenu: ["default", "open"],
  Menu: ["default", "open"],
  TickerStrip: ["default", "paused", "empty", "loading", "error"],
  PanelFrame: ["default", "focus", "collapsed", "maximised", "loading", "empty", "error"],
  FeedItem: ["default", "hover", "focus", "selected", "fresh", "unconfirmed", "reported", "loading"],
  DataTable: ["default", "selected", "loading", "empty", "error"],
  Badge: ["default", "unconfirmed", "reported", "confirmed", "dismissed", "pending-approval"],
  Toast: ["default", "error"],
  Modal: ["default"],
  Drawer: ["default", "loading"],
  Tabs: ["default", "focus"],
  Button: ["default", "hover", "focus", "active", "disabled", "loading"],
  IconButton: ["default", "hover", "focus", "active", "disabled", "loading"],
  TextInput: ["default", "hover", "focus", "disabled", "loading", "error"],
  Select: ["default", "hover", "focus", "disabled", "error"],
  Checkbox: ["default", "checked", "indeterminate", "focus", "disabled", "error"],
  DatePicker: ["default", "empty", "hover", "focus", "disabled", "error"],
  Tooltip: ["default", "open"],
  EmptyState: ["default"],
  ErrorState: ["default"],
  LoadingState: ["default"],
  Sparkline: ["default", "empty"],
  BarChart: ["default", "loading", "empty", "error"],
  TimelineAxis: ["default", "loading", "empty", "error"],
  MapView: ["default", "selected", "loading", "error"],
  KanbanBoard: ["default", "empty", "loading", "error"],
  ProvenanceControl: ["default", "open", "loading", "empty", "error"],
  Fact: ["default", "open"],
};

/** The Storybook export name for a state, for example "pending-approval" gives "PendingApproval". */
export function storyExportName(state: string): string {
  return state
    .split(/[-_\s]+/)
    .map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : ""))
    .join("");
}
