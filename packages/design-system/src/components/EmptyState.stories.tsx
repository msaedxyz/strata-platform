import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { EmptyState } from "./States";

const meta = {
  title: "EmptyState",
  component: EmptyState,
  args: { title: "No signals yet", description: "New items appear here when the collectors find them." },
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithAction: Story = { args: { action: <Button size="sm">Add panel</Button> } };
export const Module: Story = { args: { title: "Priority list", description: "Milestone M6 fills this panel.", icon: "layout" } };
