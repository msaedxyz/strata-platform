import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { Toast, ToastProvider, useToast } from "./Toast";

const meta = {
  title: "Toast",
  component: Toast,
  args: { title: "Approved", description: "The governance service wrote 2 events.", tone: "positive", onDismiss: () => undefined },
} satisfies Meta<typeof Toast>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { tone: "neutral", title: "Layout reset", description: undefined } };
export const Positive: Story = {};
export const Warning: Story = { args: { tone: "warning", title: "Live updates paused", description: "The connection will retry." } };
export const Error: Story = { args: { tone: "negative", title: "Not approved", description: "You cannot approve your own proposal." } };

function Trigger() {
  const toast = useToast();
  return <Button onClick={() => toast.show({ title: "Approved", tone: "positive" })}>Approve</Button>;
}

export const WithProvider: Story = {
  render: () => (
    <ToastProvider>
      <Trigger />
    </ToastProvider>
  ),
};
