import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleEvidence } from "./evidence.fixtures";
import { EvidenceProvider, ProvenanceControl } from "./Provenance";

const meta = {
  title: "ProvenanceControl",
  component: ProvenanceControl,
  args: { evidenceIds: ["ev_01", "ev_02"], evidence: sampleEvidence, label: "Construction start" },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProvenanceControl>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SingleSource: Story = { args: { evidenceIds: ["ev_02"], evidence: [sampleEvidence[1]!] } };
export const Open: Story = { args: { defaultOpen: true } };
export const Loading: Story = {
  args: { evidence: undefined, defaultOpen: true },
  decorators: [(Story) => <EvidenceProvider loader={() => new Promise(() => undefined)}>{Story()}</EvidenceProvider>],
};
export const Error: Story = {
  args: { evidence: undefined, defaultOpen: true },
  decorators: [
    (Story) => <EvidenceProvider loader={() => Promise.reject(new globalThis.Error("The API returned 503."))}>{Story()}</EvidenceProvider>,
  ],
};
export const Empty: Story = { args: { evidence: [], defaultOpen: true } };
