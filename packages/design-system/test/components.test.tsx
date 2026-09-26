// Behaviour tests for the design system components.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Button,
  CommandPalette,
  type Column,
  DataTable,
  EvidenceProvider,
  Fact,
  KanbanBoard,
  Menu,
  Modal,
  NavRail,
  StatusBadge,
  STATUS_STYLE,
  Tabs,
  TickerStrip,
  ToastProvider,
  useToast,
  VirtualList,
} from "../src";
import { sampleEvidence } from "../src/components/evidence.fixtures";

interface Row {
  id: string;
  name: string;
  score: number;
}
const rows: Row[] = [
  { id: "a", name: "Bravo", score: 2 },
  { id: "b", name: "Alpha", score: 10 },
  { id: "c", name: "Charlie", score: 5 },
];
const columns: Column<Row>[] = [
  { id: "name", header: "Name", value: (r) => r.name },
  { id: "score", header: "Score", value: (r) => r.score, numeric: true },
];
const names = () => screen.getAllByRole("row").filter((r) => r.closest("tbody")).map((r) => within(r).getAllByRole("cell")[0]!.textContent);

describe("StatusBadge (docs/07 rule 4)", () => {
  it("shows unconfirmed and reported items with the same visual style", () => {
    render(
      <>
        <StatusBadge status="unconfirmed" />
        <StatusBadge status="reported" />
      </>,
    );
    const [u, r] = [screen.getByText("Unconfirmed"), screen.getByText("Reported")];
    const visual = (el: HTMLElement) => [...el.classList].filter((c) => c !== "sds-status-badge").sort().join(" ");
    expect(visual(u)).toBe(visual(r));
    expect(STATUS_STYLE.unconfirmed.tone).toBe(STATUS_STYLE.reported.tone);
  });

  it("uses one label for each status", () => {
    render(<StatusBadge status="pending_approval" />);
    expect(screen.getByText("Pending approval")).toBeInTheDocument();
  });
});

describe("DataTable", () => {
  it("sorts ascending, descending and back to the original order", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label="Test" />);
    expect(names()).toEqual(["Bravo", "Alpha", "Charlie"]);
    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(names()).toEqual(["Charlie", "Bravo", "Alpha"]);
    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(names()).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("sorts numbers as numbers", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label="Test" />);
    await user.click(screen.getByRole("button", { name: /Score/ }));
    expect(names()).toEqual(["Bravo", "Charlie", "Alpha"]);
  });

  it("filters by column", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label="Test" />);
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    await user.type(screen.getByRole("textbox", { name: "Filter Name" }), "ha");
    expect(names()).toEqual(["Alpha", "Charlie"]);
    expect(screen.getByText("2 of 3 rows")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Filter Name" }), "zzz");
    expect(screen.getByText("No rows match the filters")).toBeInTheDocument();
  });

  it("resizes a column with the keyboard and with the pointer", () => {
    const onResize = vi.fn();
    render(<DataTable columns={columns.map((c) => ({ ...c, width: 100 }))} rows={rows} getRowId={(r) => r.id} label="Test" onColumnResize={onResize} />);
    const handle = screen.getByRole("separator", { name: "Resize column Name" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith("name", 116);
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 150, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith("name", 166);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith("name", 150);
  });

  it("keeps a minimum column width", () => {
    const onResize = vi.fn();
    render(<DataTable columns={[{ ...columns[0]!, width: 50, minWidth: 40 }]} rows={rows} getRowId={(r) => r.id} label="Test" onColumnResize={onResize} />);
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith("name", 40);
  });

  it("changes density between compact and comfortable", async () => {
    const user = userEvent.setup();
    const { container } = render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label="Test" />);
    expect(container.querySelector(".sds-table--compact")).not.toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Density" }), "comfortable");
    expect(container.querySelector(".sds-table--comfortable")).not.toBeNull();
  });

  it("moves between rows with the arrow keys and opens a row with Enter", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label="Test" onRowClick={onRowClick} />);
    const first = screen.getAllByRole("row")[1]!;
    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getAllByRole("row")[2]);
    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("shows the loading, empty and error states", () => {
    const { rerender } = render(<DataTable columns={columns} rows={[]} getRowId={(r) => r.id} label="Test" loading />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    rerender(<DataTable columns={columns} rows={[]} getRowId={(r) => r.id} label="Test" />);
    expect(screen.getByText("No rows")).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={[]} getRowId={(r) => r.id} label="Test" error="Broken" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Broken");
  });
});

describe("CommandPalette", () => {
  const run = vi.fn();
  const commands = [
    { id: "a", label: "Go to Origination", run },
    { id: "b", label: "Go to Review", run },
    { id: "c", label: "Reset layout", run },
  ];

  it("filters commands, moves with the arrow keys and runs with Enter", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commands} />);
    const input = screen.getByRole("combobox", { name: "Command input" });
    expect(input).toHaveFocus();
    await user.type(input, "go to");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commands} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Modal", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <Modal open={open} onClose={() => setOpen(false)} title="Dialog" footer={<Button>Save</Button>}>
          <input aria-label="Field" />
        </Modal>
      </>
    );
  }

  it("traps focus, closes with Escape and gives focus back to the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Dialog" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe("Menu", () => {
  it("opens with the arrow key, moves with the arrow keys and closes with Escape", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Menu
        label="Panel menu"
        items={[
          { id: "a", label: "First", onSelect },
          { id: "b", label: "Second", onSelect },
        ]}
      />,
    );
    screen.getByRole("button", { name: "Panel menu" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Panel menu" })).toHaveFocus();
  });
});

describe("NavRail", () => {
  it("moves focus with the arrow keys and marks the active item", async () => {
    const user = userEvent.setup();
    const items = [
      { id: "a", label: "One", icon: "target" as const },
      { id: "b", label: "Two", icon: "users" as const },
    ];
    render(<NavRail items={items} activeId="a" onSelect={() => undefined} />);
    const one = screen.getByRole("button", { name: /One/ });
    expect(one).toHaveAttribute("aria-current", "page");
    one.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: /Two/ })).toHaveFocus();
  });
});

describe("Tabs", () => {
  it("moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        label="T"
        items={[
          { id: "a", label: "A", content: "Panel A" },
          { id: "b", label: "B", content: "Panel B" },
        ]}
      />,
    );
    screen.getByRole("tab", { name: "A" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel B");
  });
});

describe("KanbanBoard (docs/07 rule 3)", () => {
  const columnsK = [
    { id: "signal", title: "Signal" },
    { id: "qualified", title: "Qualified" },
  ];
  const cards = [{ id: "d1", columnId: "signal", title: "Deal 1" }];

  it("moves a card with the keyboard and calls onMove", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<KanbanBoard columns={columnsK} cards={cards} onMove={onMove} label="Deals" />);
    screen.getByRole("article", { name: /Deal 1/ }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowRight}");
    await user.keyboard(" ");
    expect(onMove).toHaveBeenCalledWith("d1", "qualified");
  });

  it("moves a card with drag and drop", () => {
    const onMove = vi.fn();
    render(<KanbanBoard columns={columnsK} cards={cards} onMove={onMove} label="Deals" />);
    const card = screen.getByRole("article", { name: /Deal 1/ });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(card, { dataTransfer });
    const target = screen.getByRole("region", { name: /Qualified/ });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(onMove).toHaveBeenCalledWith("d1", "qualified");
  });

  it("shows the pending approval status on a card", () => {
    render(<KanbanBoard columns={columnsK} cards={[{ ...cards[0]!, status: "pending_approval" }]} label="Deals" />);
    expect(screen.getByText("Pending approval")).toBeInTheDocument();
  });

  it("has no drag when the role cannot move cards", () => {
    render(<KanbanBoard columns={columnsK} cards={cards} onMove={() => undefined} canMove={false} label="Deals" />);
    expect(screen.getByRole("article", { name: /Deal 1/ })).toHaveAttribute("draggable", "false");
  });
});

describe("TickerStrip", () => {
  it("shows the empty text when there are no items", () => {
    render(<TickerStrip items={[]} />);
    expect(screen.getByText("No signals")).toBeInTheDocument();
  });

  it("shows the counts by tier and the items", () => {
    render(<TickerStrip items={[{ id: "1", text: "Item one" }]} counts={[{ label: "T0", value: 3 }]} paused />);
    expect(screen.getByRole("list", { name: "Counts by tier" })).toHaveTextContent("T03");
    expect(screen.getByText("Item one")).toBeInTheDocument();
  });

  it("does not move with reduced motion", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...original(q), matches: q.includes("reduce") })) as typeof window.matchMedia;
    const { container } = render(<TickerStrip items={[{ id: "1", text: "Item one" }]} />);
    expect(container.querySelector(".sds-ticker--static")).not.toBeNull();
    expect(container.querySelector(".sds-ticker__track--moving")).toBeNull();
    window.matchMedia = original;
  });
});

describe("Fact and ProvenanceControl (docs/07 rules 1 and 2)", () => {
  it("opens the evidence with the span highlighted and a link to the source", async () => {
    const user = userEvent.setup();
    render(
      <Fact evidenceIds={["ev_01"]} evidence={[sampleEvidence[0]!]} label="Stage">
        Assessment
      </Fact>,
    );
    await user.click(screen.getByRole("button", { name: /Show evidence for Stage/ }));
    const dialog = screen.getByRole("dialog", { name: "Evidence: Stage" });
    expect(within(dialog).getByText(sampleEvidence[0]!.quote).tagName).toBe("MARK");
    expect(within(dialog).getByRole("link", { name: /Open source/ })).toHaveAttribute("href", sampleEvidence[0]!.sourceUrl);
  });

  it("loads the evidence through the provider", async () => {
    const user = userEvent.setup();
    const loader = vi.fn().mockResolvedValue(sampleEvidence);
    render(
      <EvidenceProvider loader={loader}>
        <Fact evidenceIds={["ev_01", "ev_02"]}>Q2 2027</Fact>
      </EvidenceProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Show evidence/ }));
    expect(loader).toHaveBeenCalledWith(["ev_01", "ev_02"]);
    expect(await screen.findAllByRole("link", { name: /Open source/ })).toHaveLength(2);
  });

  it("refuses a fact without evidence at run time too", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Fact evidenceIds={[] as unknown as ["x"]}>No evidence</Fact>)).toThrow(/at least one evidence id/);
    spy.mockRestore();
  });
});

describe("Toast", () => {
  it("shows a message with the same action word, then closes it", async () => {
    vi.useFakeTimers();
    function Trigger() {
      const toast = useToast();
      return <button onClick={() => toast.show({ title: "Approved", tone: "positive" })}>Approve</button>;
    }
    render(
      <ToastProvider duration={1000}>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText("Approved")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText("Approved")).toBeNull();
    vi.useRealTimers();
  });
});

/** jsdom has no layout. Give each element a fixed size so that the virtualizer can calculate the view. */
function withLayout(height: number, run: () => void) {
  const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => height });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 800 });
  try {
    run();
  } finally {
    if (h) Object.defineProperty(HTMLElement.prototype, "offsetHeight", h);
    if (w) Object.defineProperty(HTMLElement.prototype, "offsetWidth", w);
  }
}

describe("DataTable virtualize (docs/07 criteria 6 and 7)", () => {
  const many: Row[] = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}`, score: i }));
  it("renders only a part of 500 rows, with spacer rows and the full row count", () => {
    withLayout(240, () => {
      render(<DataTable columns={columns} rows={many} getRowId={(r) => r.id} label="Many" virtualize overscan={2} />);
    });
    const bodyRows = screen.getAllByRole("row").filter((r) => r.closest("tbody") && !r.classList.contains("sds-table__spacer"));
    expect(bodyRows.length).toBeGreaterThan(0);
    expect(bodyRows.length).toBeLessThan(100);
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "500");
    expect(screen.getByText("500 rows")).toBeInTheDocument();
  });

  it("renders every row without virtualize", () => {
    render(<DataTable columns={columns} rows={many.slice(0, 50)} getRowId={(r) => r.id} label="Few" />);
    expect(screen.getAllByRole("row").filter((r) => r.closest("tbody"))).toHaveLength(50);
  });
});

describe("VirtualList", () => {
  const items = Array.from({ length: 10000 }, (_, i) => ({ id: `i${i}`, title: `Item ${i}` }));
  it("renders a small part of 10 000 items and asks for more near the end", () => {
    const onEnd = vi.fn();
    withLayout(300, () => {
      render(<VirtualList items={items} getKey={(i) => i.id} renderItem={(i) => <p>{i.title}</p>} label="Items" estimateSize={30} onEndReached={onEnd} />);
    });
    const rendered = screen.getAllByRole("listitem");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("calls onEndReached once when the list is short", () => {
    const onEnd = vi.fn();
    withLayout(300, () => {
      render(<VirtualList items={items.slice(0, 5)} getKey={(i) => i.id} renderItem={(i) => <p>{i.title}</p>} label="Items" estimateSize={30} onEndReached={onEnd} />);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("shows the empty and error states", () => {
    const { rerender } = render(<VirtualList items={[]} getKey={() => "x"} renderItem={() => null} label="Items" emptyTitle="No signals" />);
    expect(screen.getByText("No signals")).toBeInTheDocument();
    rerender(<VirtualList items={[]} getKey={() => "x"} renderItem={() => null} label="Items" error="Failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
  });
});
