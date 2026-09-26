import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs } from "./Tabs";

const items = [
  { id: "evidence", label: "Evidence", count: 3, content: "Three quotes support this fact." },
  { id: "timeline", label: "Timeline", content: "Events for this site." },
  { id: "contacts", label: "Contacts", content: "Buyer roles and contacts." },
  { id: "history", label: "History", disabled: true, content: "Not available" },
];

const meta = {
  title: "Tabs",
  component: Tabs,
  args: { items, label: "Site details" },
} satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SecondSelected: Story = { args: { defaultValue: "timeline" } };
export const Focus: Story = {
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
  },
};
