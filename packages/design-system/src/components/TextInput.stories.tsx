import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextInput } from "./Form";

const meta = {
  title: "TextInput",
  component: TextInput,
  args: { label: "Site name", placeholder: "Kansanshi" },
} satisfies Meta<typeof TextInput>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Filled: Story = { args: { defaultValue: "Kansanshi mine" } };
export const WithHint: Story = { args: { hint: "Use the name from the licence register" } };
export const Hover: Story = { args: { "data-force-state": "hover" } as never };
export const Focus: Story = { args: { "data-force-state": "focus" } as never };
export const Disabled: Story = { args: { disabled: true, defaultValue: "Kansanshi mine" } };
export const Loading: Story = { args: { loading: true, defaultValue: "Kansan" } };
export const Error: Story = { args: { error: "Give a site name", defaultValue: "" } };
