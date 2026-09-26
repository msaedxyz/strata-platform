import type { Meta, StoryObj } from "@storybook/react-vite";
import { MapView } from "./MapView";

const markers = [
  { id: "a", lng: 25.86, lat: -12.2, label: "Site Alpha", tone: "positive" as const },
  { id: "b", lng: 28.2, lat: -12.8, label: "Site Bravo", tone: "warning" as const },
  { id: "c", lng: 28.3, lat: -15.4, label: "Site Charlie" },
];

const meta = {
  title: "MapView",
  component: MapView,
  args: { center: [27.8, -13.1], zoom: 5, markers, label: "Deal map" },
  decorators: [
    (Story) => (
      <div style={{ height: "var(--size-overlay-sm)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MapView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No style URL: the empty style. No tiles load. */
export const Default: Story = {};
export const Selected: Story = { args: { selectedMarkerId: "b" } };
export const Loading: Story = { args: { loading: true } };
export const Error: Story = { args: { error: "The map style did not load." } };
