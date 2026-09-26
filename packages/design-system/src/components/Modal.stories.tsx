import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./Button";
import { TextInput } from "./Form";
import { Modal } from "./Overlay";

const meta = {
  title: "Modal",
  component: Modal,
  args: {
    open: true,
    onClose: () => undefined,
    title: "Reject proposal",
    children: <TextInput label="Reason" placeholder="Give the reason" />,
    footer: (
      <>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Reject</Button>
      </>
    ),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Modal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Small: Story = { args: { size: "sm", title: "Log out", children: "End the session?", footer: <Button variant="primary">Log out</Button> } };
export const Interactive: Story = {
  args: { open: false },
  render: function Render(args) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open modal</Button>
        <Modal {...args} open={open} onClose={() => setOpen(false)} />
      </>
    );
  },
};
