import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./Button";

const meta = {
  title: "IconButton",
  component: IconButton,
  args: { label: "Close panel", icon: "close" },
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Small: Story = { args: { size: "sm" } };
export const Pressed: Story = { args: { pressed: true, icon: "maximise", label: "Maximise panel" } };
export const Hover: Story = { args: { "data-force-state": "hover" } as never };
export const Focus: Story = { args: { "data-force-state": "focus" } as never };
export const Active: Story = { args: { "data-force-state": "active" } as never };
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true } };
