import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";
import { SearchInput } from "./Form";
import { userItems } from "./fixtures";
import { TopBar, UserMenu } from "./Shell";

const meta = {
  title: "TopBar",
  component: TopBar,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Origination",
    search: <SearchInput placeholder="Search or type a command" shortcutHint="/" readOnly />,
    actions: (
      <>
        <Badge tone="positive">Live</Badge>
        <UserMenu name="Ada Analyst" role="Analyst" items={userItems} />
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ height: "var(--size-top-bar)", background: "var(--color-bg-surface-1)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TopBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Offline: Story = {
  args: {
    actions: (
      <>
        <Badge tone="negative">Offline</Badge>
        <UserMenu name="Ada Analyst" role="Analyst" items={userItems} />
      </>
    ),
  },
};
