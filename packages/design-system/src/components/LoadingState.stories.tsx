import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoadingState } from "./States";

const meta = {
  title: "LoadingState",
  component: LoadingState,
  args: { label: "Loading signals" },
} satisfies Meta<typeof LoadingState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Skeleton: Story = { args: { rows: 5 } };
