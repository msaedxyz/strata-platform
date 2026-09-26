import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextArea } from "./Form";

const yaml = "version: 2\nname: Monitoring Brief\nsources:\n  - id: zema_notices\n    schedule: daily\n";

const meta = {
  title: "TextArea",
  component: TextArea,
  args: { label: "Reason", placeholder: "Why do you reject this proposal?", rows: 3 },
} satisfies Meta<typeof TextArea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Filled: Story = { args: { defaultValue: "The source names a different site." } };
export const Code: Story = { args: { label: "Brief (YAML)", code: true, rows: 6, defaultValue: yaml } };
export const Hover: Story = { args: { "data-force-state": "hover" } as never };
export const Focus: Story = { args: { "data-force-state": "focus" } as never };
export const Disabled: Story = { args: { disabled: true, defaultValue: "The source names a different site." } };
export const Loading: Story = { args: { loading: true, defaultValue: "Saving" } };
export const Error: Story = { args: { error: "Give a reason", defaultValue: "" } };
