import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";

const meta = {
  title: "Button",
  component: Button,
  args: { children: "Approve", variant: "secondary" },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Primary: Story = { args: { variant: "primary" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Danger: Story = { args: { variant: "danger", children: "Reject" } };
export const WithIcon: Story = { args: { icon: "add", children: "Add panel" } };
export const Hover: Story = { args: { "data-force-state": "hover" } as never };
export const Focus: Story = { args: { "data-force-state": "focus" } as never };
export const Active: Story = { args: { "data-force-state": "active" } as never };
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true } };
