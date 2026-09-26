// Type test for docs/07 rule 2: a fact without evidence does not compile.
// `pnpm typecheck` (tsc) checks this file. Each @ts-expect-error line must be a type error,
// otherwise tsc reports "Unused '@ts-expect-error' directive" and the typecheck fails.
import { Fact, type EvidenceIds } from "./Provenance";

export const withEvidence = <Fact evidenceIds={["ev_01"]}>Producing</Fact>;
export const withTwo = <Fact evidenceIds={["ev_01", "ev_02"]}>Producing</Fact>;

// @ts-expect-error an empty evidence list is not a non-empty tuple
export const emptyEvidence = <Fact evidenceIds={[]}>Producing</Fact>;

// @ts-expect-error the evidenceIds prop is required
export const noEvidence = <Fact>Producing</Fact>;

const plainArray: string[] = ["ev_01"];
// @ts-expect-error a plain string array can be empty, so it is not accepted
export const fromArray = <Fact evidenceIds={plainArray}>Producing</Fact>;

// @ts-expect-error evidence ids are strings
export const wrongType = <Fact evidenceIds={[1]}>Producing</Fact>;

export const tuple: EvidenceIds = ["ev_01"];
// @ts-expect-error the EvidenceIds type itself rejects an empty tuple
export const emptyTuple: EvidenceIds = [];
