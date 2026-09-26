import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./Form";

const options = [
  { value: "mine", label: "Mine" },
  { value: "exploration", label: "Exploration" },
  { value: "power", label: "Power" },
  { value: "transport", label: "Transport" },
];

const meta = {
  title: "Select",
  component: Select,
  args: { label: "Site class", options, defaultValue: "mine" },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Placeholder: Story = { args: { placeholder: "All site classes", defaultValue: "" } };
export const Hover: Story = { args: { "data-force-state": "hover" } as never };
export const Focus: Story = { args: { "data-force-state": "focus" } as never };
export const Disabled: Story = { args: { disabled: true } };
export const Error: Story = { args: { error: "Choose a site class", placeholder: "Choose", defaultValue: "" } };
