import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./Button";
import { Tooltip } from "./Tooltip";

const meta = {
  title: "Tooltip",
  component: Tooltip,
  args: { content: "Maximise panel", children: <IconButton label="Maximise panel" icon="maximise" title="" /> },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Open: Story = { args: { defaultOpen: true } };
export const Bottom: Story = { args: { defaultOpen: true, placement: "bottom" } };
