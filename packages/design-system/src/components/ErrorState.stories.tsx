import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorState } from "./States";

const meta = {
  title: "ErrorState",
  component: ErrorState,
  args: { description: "The API did not answer. Check the connection." },
} satisfies Meta<typeof ErrorState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithRetry: Story = { args: { onRetry: () => undefined } };
