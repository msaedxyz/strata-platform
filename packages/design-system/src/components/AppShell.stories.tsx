import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchInput } from "./Form";
import { navItems, noop, userItems } from "./fixtures";
import { AppShell, NavRail, TopBar, UserMenu } from "./Shell";
import { EmptyState } from "./States";
import { TickerStrip } from "./TickerStrip";

const meta = {
  title: "AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
  args: {
    nav: <NavRail items={navItems} activeId="monitoring" onSelect={noop} brand="STRATA" />,
    topBar: (
      <TopBar
        title="Monitoring"
        search={<SearchInput placeholder="Search or type a command" shortcutHint="/" readOnly />}
        actions={<UserMenu name="Ada Analyst" role="Analyst" items={userItems} />}
      />
    ),
    ticker: <TickerStrip items={[{ id: "1", tag: "T1", tone: "warning", text: "Sample signal" }]} paused />,
    children: <EmptyState title="Workspace" description="Panels go here." />,
  },
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithoutTicker: Story = { args: { ticker: undefined } };
export const Loading: Story = { args: { loading: true } };
