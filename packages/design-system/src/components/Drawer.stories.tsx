import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";
import { Drawer } from "./Overlay";
import { LoadingState } from "./States";

const meta = {
  title: "Drawer",
  component: Drawer,
  args: {
    open: true,
    onClose: () => undefined,
    title: "Kansanshi mine",
    children: (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <Badge tone="positive">Producing</Badge>
        <p>Operator: First Quantum Minerals</p>
      </div>
    ),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Drawer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Left: Story = { args: { side: "left" } };
export const Loading: Story = { args: { children: <LoadingState label="Loading site" rows={6} /> } };
