import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, StatusBadge } from "./Badge";

const meta = {
  title: "Badge",
  component: Badge,
  args: { children: "Tier 1", tone: "neutral" },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Tones: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "var(--space-3)" }}>
      <Badge tone="neutral">Neutral</Badge>
      <Badge tone="positive">Positive</Badge>
      <Badge tone="negative">Negative</Badge>
      <Badge tone="warning">Warning</Badge>
      <Badge tone="accent">Tier 0</Badge>
      <Badge tone="accent" appearance="solid">
        Solid
      </Badge>
    </div>
  ),
};
export const Unconfirmed: Story = { render: () => <StatusBadge status="unconfirmed" /> };
export const Reported: Story = { render: () => <StatusBadge status="reported" /> };
export const Confirmed: Story = { render: () => <StatusBadge status="confirmed" /> };
export const Dismissed: Story = { render: () => <StatusBadge status="dismissed" /> };
export const PendingApproval: Story = { render: () => <StatusBadge status="pending_approval" /> };
export const AllStatuses: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "var(--space-3)" }}>
      <StatusBadge status="unconfirmed" />
      <StatusBadge status="reported" />
      <StatusBadge status="confirmed" />
      <StatusBadge status="dismissed" />
      <StatusBadge status="pending_approval" />
    </div>
  ),
};
