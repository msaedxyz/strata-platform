import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge, type Status } from "./Badge";
import { type Column, DataTable } from "./DataTable";
import { noop } from "./fixtures";

interface Row {
  id: string;
  site: string;
  siteClass: string;
  province: string;
  status: Status;
  score: number;
}

const rows: Row[] = [
  { id: "1", site: "Site Alpha", siteClass: "Mine", province: "North-Western", status: "confirmed", score: 82 },
  { id: "2", site: "Site Bravo", siteClass: "Exploration", province: "Copperbelt", status: "reported", score: 64 },
  { id: "3", site: "Site Charlie", siteClass: "Power", province: "Southern", status: "unconfirmed", score: 71 },
  { id: "4", site: "Site Delta", siteClass: "Transport", province: "Central", status: "pending_approval", score: 45 },
  { id: "5", site: "Site Echo", siteClass: "Farm", province: "Eastern", status: "dismissed", score: 12 },
];

const columns: Column<Row>[] = [
  { id: "site", header: "Site", value: (r) => r.site, width: 160 },
  { id: "class", header: "Class", value: (r) => r.siteClass },
  { id: "province", header: "Province", value: (r) => r.province },
  { id: "status", header: "Status", value: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
  { id: "score", header: "Score", value: (r) => r.score, numeric: true },
];

const meta = {
  title: "DataTable",
  component: DataTable<Row>,
  args: { columns, rows, getRowId: (r: Row) => r.id, label: "Sites", onRowClick: noop },
  decorators: [
    (Story) => (
      <div style={{ height: "var(--size-overlay-sm)", background: "var(--color-bg-surface-1)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DataTable<Row>>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Comfortable: Story = { args: { defaultDensity: "comfortable" } };
export const Sorted: Story = { args: { defaultSort: { columnId: "score", direction: "desc" } } };
export const Filtered: Story = { args: { defaultShowFilters: true } };
export const Selected: Story = { args: { selectedRowId: "2" } };
export const Loading: Story = { args: { loading: true } };
export const Empty: Story = { args: { rows: [] } };
export const Error: Story = { args: { error: "The site list did not load.", onRetry: noop } };
