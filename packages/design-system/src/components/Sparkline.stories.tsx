import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sparkline } from "./Charts";

const meta = {
  title: "Sparkline",
  component: Sparkline,
  args: { values: [3, 5, 4, 8, 6, 9, 12, 10, 14, 13, 17, 15, 19, 21], label: "Signals per day, last 14 days" },
} satisfies Meta<typeof Sparkline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Positive: Story = { args: { tone: "positive" } };
export const Negative: Story = { args: { tone: "negative", values: [20, 18, 19, 14, 12, 9, 6] } };
export const Flat: Story = { args: { values: [5, 5, 5, 5] } };
export const Empty: Story = { args: { values: [] } };
