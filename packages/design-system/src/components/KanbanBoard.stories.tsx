import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import stagesYaml from "../../../../config/stages.yaml?raw";
import { type KanbanCard, type KanbanColumn, KanbanBoard } from "./KanbanBoard";

/** Read the deal stages from config/stages.yaml. Each stage is one flow mapping line. */
function parseStages(text: string): KanbanColumn[] {
  const out: KanbanColumn[] = [];
  for (const line of text.split("\n")) {
    const code = /code:\s*([\w-]+)/.exec(line)?.[1];
    const name = /name:\s*"([^"]+)"/.exec(line)?.[1];
    if (code && name) out.push({ id: code, title: name, terminal: /terminal:\s*true/.test(line) });
  }
  return out;
}

const columns = parseStages(stagesYaml);
const cards: KanbanCard[] = [
  { id: "d1", columnId: "signal", title: "Fuel supply, Site Alpha", subtitle: "Mine · North-Western" },
  { id: "d2", columnId: "qualified", title: "Haulage, Site Bravo", subtitle: "Transport · Copperbelt" },
  { id: "d3", columnId: "contact_found", title: "Generator fuel, Site Charlie", subtitle: "Power · Southern", status: "pending_approval" },
  { id: "d4", columnId: "approach", title: "Tender, Site Delta", subtitle: "Industrial · Lusaka" },
];

const meta = {
  title: "KanbanBoard",
  component: KanbanBoard,
  args: { columns, cards, label: "Deal stages", onMove: () => undefined },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: "var(--size-overlay-sm)", padding: "var(--space-4)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KanbanBoard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Interactive: Story = {
  render: function Render(args) {
    const [list, setList] = useState(args.cards);
    return (
      <KanbanBoard
        {...args}
        cards={list}
        onMove={(id, to) => setList((l) => l.map((c) => (c.id === id ? { ...c, columnId: to, status: "pending_approval" } : c)))}
      />
    );
  },
};
export const ReadOnly: Story = { args: { canMove: false } };
export const Empty: Story = { args: { cards: [] } };
export const Loading: Story = { args: { loading: true } };
export const Error: Story = { args: { error: "The deals did not load." } };
