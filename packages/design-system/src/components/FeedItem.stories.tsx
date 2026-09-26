import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { sampleEvidence } from "./evidence.fixtures";
import { FeedItem } from "./FeedItem";
import { LoadingState } from "./States";

const meta = {
  title: "FeedItem",
  component: FeedItem,
  args: {
    title: "Environmental assessment filed for plant expansion",
    source: "Example News",
    time: "09:12",
    dateTime: "2026-09-26T09:12:00Z",
    tier: { label: "T1", tone: "warning" },
    summary: "The operator filed the assessment. A decision is expected next year.",
    tags: ["Mining", "North-Western"],
    evidenceIds: ["ev_01"],
    evidence: [sampleEvidence[0]!],
    tabIndex: 0,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: "var(--size-overlay-drawer)", background: "var(--color-bg-surface-1)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FeedItem>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Hover: Story = { args: { "data-force-state": "hover" } as never };
export const Focus: Story = { args: { "data-force-state": "focus" } as never };
export const Selected: Story = { args: { selected: true } };
export const Fresh: Story = { args: { fresh: true } };
export const Unconfirmed: Story = { args: { tier: { label: "T0", tone: "negative" }, status: "unconfirmed" } };
export const Reported: Story = { args: { status: "reported" } };
export const WithActions: Story = {
  args: {
    tier: { label: "T0", tone: "negative" },
    status: "unconfirmed",
    actions: (
      <>
        <Button size="sm">Acknowledge</Button>
        <Button size="sm" variant="primary">
          Confirm
        </Button>
        <Button size="sm" variant="ghost">
          Dismiss
        </Button>
      </>
    ),
  },
};
export const Loading: Story = { render: () => <LoadingState rows={3} label="Loading item" /> };
