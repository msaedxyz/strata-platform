import type { Meta, StoryObj } from "@storybook/react-vite";
import { userItems } from "./fixtures";
import { UserMenu } from "./Shell";

const meta = {
  title: "UserMenu",
  component: UserMenu,
  args: { name: "Ada Analyst", email: "ada@example.com", role: "Analyst", items: userItems },
  decorators: [
    (Story) => (
      <div style={{ display: "flex", justifyContent: "flex-end", minHeight: "var(--size-overlay-menu)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UserMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Open: Story = { args: { defaultOpen: true } };
export const Viewer: Story = { args: { name: "Victor Viewer", role: "Viewer" } };
