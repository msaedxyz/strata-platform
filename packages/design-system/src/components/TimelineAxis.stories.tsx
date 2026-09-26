import type { Meta, StoryObj } from "@storybook/react-vite";
import { TimelineAxis } from "./TimelineAxis";

const rows = [
  {
    id: "p1",
    label: "Project Alpha expansion",
    ranges: [{ id: "w1", start: "2027-01-15", end: "2027-06-30", label: "Mining contract", forecast: true }],
    markers: [{ id: "m1", date: "2026-11-01", label: "Feasibility study due" }],
  },
  { id: "p2", label: "Solar plant Bravo", ranges: [{ id: "w2", start: "2026-12-01", end: "2027-03-31", label: "EPC tender", tone: "warning" as const }] },
  { id: "p3", label: "Rail spur Charlie", ranges: [{ id: "w3", start: "2027-09-01", end: "2028-04-30", label: "Haulage", forecast: true, tone: "positive" as const }] },
];

const meta = {
  title: "TimelineAxis",
  component: TimelineAxis,
  args: { start: "2026-10", months: 24, rows, today: "2026-09-26", label: "Procurement calendar" },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TimelineAxis>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { today: "2026-10-12" } };
export const Selectable: Story = { args: { onRangeSelect: () => undefined } };
export const TwelveMonths: Story = { args: { months: 12 } };
export const Loading: Story = { args: { loading: true } };
export const Empty: Story = { args: { rows: [] } };
export const Error: Story = { args: { error: "The forecast did not load." } };
