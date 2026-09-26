import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./Form";

const meta = {
  title: "Checkbox",
  component: Checkbox,
  args: { label: "Tier 0 only" },
} satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Checked: Story = { args: { defaultChecked: true } };
export const Indeterminate: Story = { args: { indeterminate: true } };
export const Focus: Story = { args: { autoFocus: true } };
export const Disabled: Story = { args: { disabled: true } };
export const DisabledChecked: Story = { args: { disabled: true, defaultChecked: true } };
export const Error: Story = { args: { error: "Accept the source licence" } };
