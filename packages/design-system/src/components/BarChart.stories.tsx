import type { Meta, StoryObj } from "@storybook/react-vite";
import { BarChart } from "./Charts";

const data = [
  { label: "Mining", value: 42 },
  { label: "Power", value: 17, tone: "warning" as const },
  { label: "Transport", value: 28 },
  { label: "Agriculture", value: 9, tone: "neutral" as const },
];

const meta = {
  title: "BarChart",
  component: BarChart,
  args: { data, label: "Signals by sector" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: "var(--size-overlay-sm)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BarChart>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Percent: Story = { args: { max: 100, format: (v: number) => `${v}%` } };
export const Loading: Story = { args: { loading: true } };
export const Empty: Story = { args: { data: [] } };
export const Error: Story = { args: { error: "The telemetry did not load." } };
