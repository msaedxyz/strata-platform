// Brief editor: the versions of the Monitoring Brief, the YAML of a version, the differences between two versions,
// a new version and activation (GET /api/briefs, GET /api/briefs/{version}, GET /api/briefs/diff, POST /api/briefs,
// POST /api/briefs/{version}/activate). Admin only. Not live.
import { Badge, Button, Checkbox, type Column, DataTable, Select, Tabs, TextArea, TextInput } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/http";
import type { BriefChange, BriefDiff, BriefList, BriefSummary, BriefVersion } from "../api/types";
import { activateBrief, createBrief } from "../api/writes";
import { useCan } from "../auth/RequireRole";
import { useResource } from "../data/resource";
import { ACTIONS, useAction } from "./common/actions";
import { useApi } from "./common/api";
import { formatDateTime, shortValue } from "./common/format";
import { ModuleRoot, resourceState } from "./common/ui";

const changeTone = { added: "positive", removed: "negative", changed: "warning" } as const;

const diffColumns: Column<BriefChange & { i: number }>[] = [
  { id: "path", header: "Path", value: (c) => c.path, width: 280 },
  { id: "op", header: "Change", value: (c) => c.op, cell: (c) => <Badge tone={changeTone[c.op]}>{c.op}</Badge> },
  { id: "from", header: "From", value: (c) => shortValue(c.removed?.length ? c.removed : c.from) },
  { id: "to", header: "To", value: (c) => shortValue(c.added?.length ? c.added : c.to) },
];

/** The validation errors of POST /api/briefs (HTTP 422 {"detail": {"errors": [...]}}) as text. */
function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const errors = (err.detail as { errors?: unknown[] } | undefined)?.errors;
    if (Array.isArray(errors) && errors.length) return errors.map((e) => shortValue(e, 200)).join("\n");
    return err.message;
  }
  return err instanceof Error ? err.message : "The version was not created.";
}

export function BriefEditorModule(_: PanelProps) {
  const { reads, http } = useApi();
  const isAdmin = useCan("admin");
  const { run, busy } = useAction();
  const list = useResource<BriefList>("briefs", reads.briefs);
  const versions = useMemo(() => list.data?.versions ?? [], [list.data]);
  const latest = versions[0]?.version;
  const [tab, setTab] = useState("versions");
  const [base, setBase] = useState<number | null>(null);
  const [yaml, setYaml] = useState("");
  const [note, setNote] = useState("");
  const [activate, setActivate] = useState(false);
  const [yamlError, setYamlError] = useState<string | undefined>(undefined);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);

  const baseVersion = base ?? list.data?.active_version ?? latest ?? null;
  const baseDoc = useResource<BriefVersion>(baseVersion !== null ? `brief:${baseVersion}` : null, () => reads.brief(baseVersion!));
  useEffect(() => {
    if (baseDoc.data) setYaml(baseDoc.data.yaml);
  }, [baseDoc.data]);

  const diffFrom = from ?? versions[1]?.version ?? null;
  const diffTo = to ?? latest ?? null;
  const diff = useResource<BriefDiff>(diffFrom !== null && diffTo !== null && diffFrom !== diffTo ? `brief-diff:${diffFrom}:${diffTo}` : null, () => reads.briefDiff(diffFrom!, diffTo!));

  const versionOptions = versions.map((v) => ({ value: String(v.version), label: `Version ${v.version}${v.active ? " (active)" : ""}` }));

  const doActivate = async (v: BriefSummary) => {
    const ok = await run("activate", () => activateBrief(http, v.version), { busyKey: `activate:${v.version}`, description: `Brief version ${v.version}` });
    if (ok) void list.reload();
  };

  const doCreate = async () => {
    setYamlError(undefined);
    if (!yaml.trim()) {
      setYamlError("Give the brief as YAML.");
      return;
    }
    let failure: string | undefined;
    const ok = await run("createVersion", async () => {
      try {
        return await createBrief(http, { yaml, change_note: note || undefined, activate });
      } catch (e) {
        failure = errorText(e);
        throw e;
      }
    });
    if (ok) {
      setNote("");
      setActivate(false);
      setBase(null);
      await list.reload();
      setTab("versions");
    } else setYamlError(failure);
  };

  const versionColumns: Column<BriefSummary>[] = [
    { id: "version", header: "Version", value: (v) => v.version, numeric: true, width: 80 },
    { id: "name", header: "Name", value: (v) => v.name },
    { id: "created", header: "Created", value: (v) => v.created_at, cell: (v) => formatDateTime(v.created_at) },
    { id: "by", header: "By", value: (v) => v.created_by },
    { id: "note", header: "Change note", value: (v) => v.change_note ?? "" },
    {
      id: "active",
      header: "State",
      value: (v) => (v.active ? 1 : 0),
      cell: (v) =>
        v.active ? (
          <Badge tone="positive">Active</Badge>
        ) : isAdmin ? (
          <Button size="sm" loading={busy === `activate:${v.version}`} onClick={() => void doActivate(v)}>
            {ACTIONS.activate.button}
          </Button>
        ) : (
          ""
        ),
      sortable: false,
    },
  ];

  const s = resourceState(list, { label: "brief versions", empty: versions.length === 0, emptyTitle: "No brief versions" });
  return (
    <ModuleRoot id="brief-editor" state={s.state}>
      {s.node ?? (
        <Tabs
          label="Brief editor"
          className="strata-tabs"
          value={tab}
          onChange={setTab}
          items={[
            {
              id: "versions",
              label: "Versions",
              count: versions.length,
              content: <DataTable label="Brief versions" columns={versionColumns} rows={versions} getRowId={(v) => v.id} toolbar={false} />,
            },
            {
              id: "edit",
              label: "Edit",
              content: (
                <div className="strata-stack">
                  <div className="strata-module__toolbar strata-module__toolbar--bare">
                    <Select label="Start from" value={baseVersion !== null ? String(baseVersion) : ""} options={versionOptions} onChange={(e) => setBase(Number(e.target.value))} />
                    <TextInput label="Change note" value={note} onChange={(e) => setNote(e.target.value)} />
                    <Checkbox label="Activate the new version" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
                    {isAdmin && (
                      <Button variant="primary" loading={busy === "createVersion"} onClick={() => void doCreate()}>
                        {ACTIONS.createVersion.button}
                      </Button>
                    )}
                  </div>
                  <TextArea label="Brief (YAML)" code rows={24} value={yaml} onChange={(e) => setYaml(e.target.value)} error={yamlError} loading={baseDoc.loading} spellCheck={false} />
                </div>
              ),
            },
            {
              id: "diff",
              label: "Differences",
              content: (
                <div className="strata-stack">
                  <div className="strata-module__toolbar strata-module__toolbar--bare">
                    <Select label="From" value={diffFrom !== null ? String(diffFrom) : ""} options={versionOptions} onChange={(e) => setFrom(Number(e.target.value))} />
                    <Select label="To" value={diffTo !== null ? String(diffTo) : ""} options={versionOptions} onChange={(e) => setTo(Number(e.target.value))} />
                  </div>
                  <DataTable
                    label="Differences between the versions"
                    columns={diffColumns}
                    rows={(diff.data?.changes ?? []).map((c, i) => ({ ...c, i }))}
                    getRowId={(c) => String(c.i)}
                    loading={diff.loading}
                    error={diff.error}
                    emptyTitle={diffFrom === diffTo ? "Choose two different versions" : "No differences"}
                  />
                </div>
              ),
            },
          ]}
        />
      )}
    </ModuleRoot>
  );
}
