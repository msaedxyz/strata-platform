import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Badge } from "./Badge";
import { noop } from "./fixtures";
import { PanelFrame } from "./PanelFrame";
import { EmptyState } from "./States";

const meta = {
  title: "PanelFrame",
  component: PanelFrame,
  args: {
    title: "Signal feed",
    icon: "activity",
    meta: <Badge tone="positive">Live</Badge>,
    onCollapse: noop,
    onMaximise: noop,
    onClose: noop,
    dragHandle: true,
    menuItems: [
      { id: "reset", label: "Reset panel size", icon: "reset", onSelect: noop },
      { id: "close", label: "Close panel", icon: "close", onSelect: noop },
    ],
    children: <p style={{ margin: 0 }}>Panel content</p>,
  },
  decorators: [
    (Story) => (
      <div style={{ height: "var(--size-overlay-sm)", maxWidth: "var(--size-overlay-md)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PanelFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Collapsed: Story = { args: { collapsed: true } };
export const Maximised: Story = { args: { maximised: true } };
export const Loading: Story = { args: { loading: true } };
export const Empty: Story = { args: { children: <EmptyState title="No signals yet" /> } };
export const Error: Story = { args: { error: "The feed did not load.", onRetry: noop } };
export const Focus: Story = {
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('[data-panel-action="maximise"]')?.focus();
  },
};
export const Interactive: Story = {
  render: function Render(args) {
    const [collapsed, setCollapsed] = useState(false);
    const [maximised, setMaximised] = useState(false);
    return (
      <PanelFrame
        {...args}
        collapsed={collapsed}
        maximised={maximised}
        onCollapse={() => setCollapsed((c) => !c)}
        onMaximise={() => setMaximised((m) => !m)}
      />
    );
  },
};
