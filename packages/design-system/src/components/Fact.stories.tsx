import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleEvidence } from "./evidence.fixtures";
import { Fact } from "./Provenance";

const meta = {
  title: "Fact",
  component: Fact,
  args: { evidenceIds: ["ev_01"], evidence: [sampleEvidence[0]!], label: "Project stage", children: "Environmental assessment" },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Fact>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const MultipleSources: Story = { args: { evidenceIds: ["ev_01", "ev_02"], evidence: sampleEvidence, children: "Q2 2027" } };
export const Open: Story = { args: { defaultOpen: true } };
