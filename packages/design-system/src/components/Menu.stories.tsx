import type { Meta, StoryObj } from "@storybook/react-vite";
import { noop } from "./fixtures";
import { Menu } from "./Menu";

const meta = {
  title: "Menu",
  component: Menu,
  args: {
    label: "Panel menu",
    items: [
      { id: "reset", label: "Reset panel size", icon: "reset", onSelect: noop },
      { id: "export", label: "Export", onSelect: noop, disabled: true },
      { id: "close", label: "Close panel", icon: "close", onSelect: noop, danger: true },
    ],
    align: "start",
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: "var(--size-overlay-menu)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Menu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Open: Story = { args: { defaultOpen: true } };
