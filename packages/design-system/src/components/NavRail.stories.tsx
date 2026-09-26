import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { navItems, noop } from "./fixtures";
import { NavRail } from "./Shell";

const meta = {
  title: "NavRail",
  component: NavRail,
  args: { items: navItems, activeId: "origination", onSelect: noop, brand: "STRATA" },
  decorators: [
    (Story) => (
      <div style={{ width: "var(--size-nav-rail)", height: "var(--size-overlay-sm)", background: "var(--color-bg-surface-1)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NavRail>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Interactive: Story = {
  render: function Render(args) {
    const [active, setActive] = useState(args.activeId);
    return <NavRail {...args} activeId={active} onSelect={setActive} />;
  },
};
export const Focus: Story = {
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>(".sds-nav__item--active")?.focus();
  },
};
