import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommandPalette, type Command } from "./CommandPalette";
import { noop } from "./fixtures";

const commands: Command[] = [
  { id: "ws-origination", label: "Go to Origination", group: "Workspaces", icon: "target", shortcut: "g 1", run: noop },
  { id: "ws-relationships", label: "Go to Relationships", group: "Workspaces", icon: "users", shortcut: "g 2", run: noop },
  { id: "ws-monitoring", label: "Go to Monitoring", group: "Workspaces", icon: "activity", shortcut: "g 3", run: noop },
  { id: "ws-review", label: "Go to Review", group: "Workspaces", icon: "review", shortcut: "g 4", run: noop },
  { id: "add-panel", label: "Add panel", group: "Layout", icon: "add", run: noop },
  { id: "reset-layout", label: "Reset layout", group: "Layout", icon: "reset", run: noop },
  { id: "shortcuts", label: "Show keyboard shortcuts", group: "Help", icon: "keyboard", shortcut: "?", run: noop },
];

const meta = {
  title: "CommandPalette",
  component: CommandPalette,
  args: { open: true, onClose: noop, commands },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CommandPalette>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Filtered: Story = { args: { initialQuery: "layout" } };
export const Empty: Story = { args: { initialQuery: "zzz" } };
export const Loading: Story = { args: { initialQuery: "kan", loading: true } };
export const Error: Story = { args: { initialQuery: "kan", error: "Search is not available. Try again later." } };
