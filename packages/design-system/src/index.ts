// @strata/design-system: the Infora design tokens and components.
import "./styles/index.css";

export { tokens, tokenValues, tokenList, tokenMeta, type TokenPath } from "./tokens";
export { Icon, icons, type IconName, type IconProps } from "./icons";
export { cx, nextListIndex, overlayOpen, useEscape, useFocusTrap, useReducedMotion, type ForcedState } from "./lib/utils";
export { componentInventory, storyExportName, type ComponentState } from "./inventory";

export { AppShell, NavRail, TopBar, UserMenu, type AppShellProps, type NavItem, type NavRailProps, type TopBarProps, type UserMenuProps } from "./components/Shell";
export { CommandPalette, filterCommands, type Command, type CommandPaletteProps } from "./components/CommandPalette";
export { Menu, type MenuItem, type MenuProps } from "./components/Menu";
export { TickerStrip, type TickerItem, type TickerCount, type TickerStripProps } from "./components/TickerStrip";
export { PanelFrame, PanelHeader, type PanelFrameProps, type PanelHeaderProps } from "./components/PanelFrame";
export { FeedItem, type FeedItemProps } from "./components/FeedItem";
export { DataTable, type Column, type DataTableProps, type Density, type SortState, type SortDirection } from "./components/DataTable";
export { Badge, StatusBadge, STATUS_STYLE, type BadgeProps, type BadgeTone, type Status, type StatusBadgeProps } from "./components/Badge";
export { Toast, ToastProvider, useToast, type ToastData, type ToastProps, type ToastTone } from "./components/Toast";
export { Modal, Drawer, type ModalProps, type DrawerProps } from "./components/Overlay";
export { Tabs, type TabItem, type TabsProps } from "./components/Tabs";
export { Button, IconButton, type ButtonProps, type ButtonVariant, type IconButtonProps } from "./components/Button";
export {
  TextInput,
  SearchInput,
  Select,
  Checkbox,
  DatePicker,
  type TextInputProps,
  type SearchInputProps,
  type SelectProps,
  type SelectOption,
  type CheckboxProps,
  type DatePickerProps,
} from "./components/Form";
export { Tooltip, type TooltipProps } from "./components/Tooltip";
export { EmptyState, ErrorState, LoadingState, type EmptyStateProps, type ErrorStateProps, type LoadingStateProps } from "./components/States";
export { Sparkline, BarChart, type SparklineProps, type BarChartProps, type BarDatum, type ChartTone } from "./components/Charts";
export { TimelineAxis, type TimelineAxisProps, type TimelineRow, type TimelineRange, type TimelineMarker } from "./components/TimelineAxis";
export { MapView, EMPTY_MAP_STYLE, type MapViewProps, type MapMarker, type MapMarkerTone } from "./components/MapView";
export { KanbanBoard, type KanbanBoardProps, type KanbanColumn, type KanbanCard } from "./components/KanbanBoard";
export {
  Fact,
  ProvenanceControl,
  EvidenceProvider,
  EvidenceQuote,
  type Evidence,
  type EvidenceIds,
  type EvidenceLoader,
  type FactProps,
  type ProvenanceControlProps,
} from "./components/Provenance";
