import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SearchInput } from "./Form";

const meta = {
  title: "SearchInput",
  component: SearchInput,
  args: { placeholder: "Search or type a command", shortcutHint: "/" },
} satisfies Meta<typeof SearchInput>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithValue: Story = {
  render: function Render(args) {
    const [value, setValue] = useState("Lumwana");
    return <SearchInput {...args} value={value} onChange={(e) => setValue(e.target.value)} onClear={() => setValue("")} />;
  },
};
export const Hover: Story = { args: { "data-force-state": "hover" } as never };
export const Focus: Story = { args: { "data-force-state": "focus" } as never };
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true, defaultValue: "Lumw" } };
