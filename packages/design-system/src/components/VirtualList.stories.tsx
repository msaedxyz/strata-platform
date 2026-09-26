import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeedItem } from "./FeedItem";
import { noop } from "./fixtures";
import { VirtualList } from "./VirtualList";

interface Item {
  id: string;
  title: string;
  tier: number;
}

const items: Item[] = Array.from({ length: 10000 }, (_, i) => ({
  id: `sig-${i}`,
  title: `Signal ${i + 1}: exploration licence granted in North-Western Province`,
  tier: i % 3,
}));

const meta = {
  title: "VirtualList",
  component: VirtualList<Item>,
  args: {
    items,
    getKey: (it: Item) => it.id,
    renderItem: (it: Item) => <FeedItem title={it.title} source="ZEMA" time="09:14" tier={{ label: `T${it.tier}`, tone: it.tier === 0 ? "accent" : "neutral" }} tabIndex={0} />,
    label: "Signals",
    estimateSize: 64,
    onEndReached: noop,
  },
  decorators: [
    (Story) => (
      <div style={{ height: "var(--size-overlay-sm)", background: "var(--color-bg-surface-1)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VirtualList<Item>>;
export default meta;
type Story = StoryObj<typeof meta>;

/** 10 000 items. Only the items in view are in the document. */
export const Default: Story = {};
export const LoadingMore: Story = { args: { loadingMore: true } };
export const Loading: Story = { args: { loading: true } };
export const Empty: Story = { args: { items: [], emptyTitle: "No signals", emptyDescription: "No signal matches the filters." } };
export const Error: Story = { args: { error: "The signals did not load.", onRetry: noop } };
