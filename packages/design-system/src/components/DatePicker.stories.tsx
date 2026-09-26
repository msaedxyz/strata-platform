import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DatePicker } from "./Form";

const meta = {
  title: "DatePicker",
  component: DatePicker,
  args: { label: "As of", value: "2026-09-26" },
} satisfies Meta<typeof DatePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render(args) {
    const [value, setValue] = useState(args.value ?? "");
    return <DatePicker {...args} value={value} onChange={setValue} />;
  },
};
export const Empty: Story = { args: { value: "" } };
export const WithRange: Story = { args: { min: "2026-01-01", max: "2027-12-31", hint: "Between January 2026 and December 2027" } };
export const Hover: Story = { args: { "data-force-state": "hover" } as never };
export const Focus: Story = { args: { "data-force-state": "focus" } as never };
export const Disabled: Story = { args: { disabled: true } };
export const Error: Story = { args: { error: "The date is after the end of the window" } };
