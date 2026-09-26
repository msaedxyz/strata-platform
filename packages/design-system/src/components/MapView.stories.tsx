import type { Meta, StoryObj } from "@storybook/react-vite";
import type { FeatureCollection } from "geojson";
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

/** A schematic box and its neighbour. The app gives real country outlines from a public domain dataset. */
const boundaries: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: 1,
      properties: { name: "Area A" },
      geometry: { type: "Polygon", coordinates: [[[22, -18], [33.7, -18], [33.7, -8.2], [22, -8.2], [22, -18]]] },
    },
    {
      type: "Feature",
      id: 2,
      properties: { name: "Area B" },
      geometry: { type: "Polygon", coordinates: [[[33.7, -18], [36, -18], [36, -9], [33.7, -9], [33.7, -18]]] },
    },
  ],
};

/** A boundary base layer with one area filled. No tiles load. */
export const WithBoundaries: Story = { args: { boundaries, highlightId: 1, bounds: [[21, -19], [37, -7]] } };
export const Error: Story = { args: { error: "The map style did not load." } };
