import type { Meta, StoryObj } from "@storybook/react-vite";
import { TickerStrip } from "./TickerStrip";

const items = [
  { id: "1", tag: "T0", tone: "negative" as const, text: "Road closure reported on the T3 at Kasumbalesa", time: "09:12" },
  { id: "2", tag: "T1", tone: "warning" as const, text: "Environmental assessment filed for a new copper project in North-Western Province", time: "08:47" },
  { id: "3", tag: "T1", tone: "warning" as const, text: "Power supply cut to smelter announced for maintenance", time: "08:30" },
  { id: "4", tag: "T2", tone: "neutral" as const, text: "Fuel import licence list updated by the regulator", time: "07:55" },
];
const counts = [
  { label: "T0", value: 1, tone: "negative" as const },
  { label: "T1", value: 12, tone: "warning" as const },
  { label: "T2", value: 48 },
];

const meta = {
  title: "TickerStrip",
  component: TickerStrip,
  args: { items, counts },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TickerStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Paused: Story = { args: { paused: true } };
export const Fast: Story = { args: { speed: 120 } };
export const Empty: Story = { args: { items: [], counts: [] } };
export const Loading: Story = { args: { loading: true } };
export const Error: Story = { args: { error: "Live updates stopped. The connection will retry." } };
