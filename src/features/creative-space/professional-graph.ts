import type { CreativeSpaceProject, SpaceAsset, SpaceBinding, SpaceOperation } from "./domain";

export type ProfessionalPortDirection = "INPUT" | "OUTPUT";
export type ProfessionalPortSemantic = SpaceBinding["role"] | "OUTPUT";

export type ProfessionalGraphPort = Readonly<{
  id: string;
  direction: ProfessionalPortDirection;
  semantic: ProfessionalPortSemantic;
  connectedEntityId: string | null;
}>;

export type ProfessionalAssetNode = Readonly<{
  kind: "ASSET";
  id: string;
  assetId: string;
  mediaKind: SpaceAsset["kind"];
  ports: readonly ProfessionalGraphPort[];
}>;

export type ProfessionalOperationNode = Readonly<{
  kind: "OPERATION";
  id: string;
  operationId: string;
  recipeId: string;
  state: SpaceOperation["state"];
  customerCredits: number;
  ports: readonly ProfessionalGraphPort[];
}>;

export type ProfessionalGraphNode = ProfessionalAssetNode | ProfessionalOperationNode;

export type ProfessionalGraphEdge = Readonly<{
  id: string;
  semantic: ProfessionalPortSemantic;
  source: Readonly<{ nodeId: string; portId: string }>;
  target: Readonly<{ nodeId: string; portId: string }>;
}>;

export type ProfessionalGraphProjection = Readonly<{
  nodes: readonly ProfessionalGraphNode[];
  edges: readonly ProfessionalGraphEdge[];
}>;

export const PROFESSIONAL_GRAPH_BUDGET = Object.freeze({
  maxNodes: 250,
  maxEdges: 500,
  maxTimelineClips: 120,
  maxProjectionMilliseconds: 150,
});

export type ProfessionalGraphBudgetAssessment = Readonly<{
  nodeCount: number;
  edgeCount: number;
  timelineClipCount: number;
  projectionMilliseconds: number;
  withinBudget: boolean;
  reasons: readonly ("NODE_BUDGET_EXCEEDED" | "EDGE_BUDGET_EXCEEDED" | "TIMELINE_BUDGET_EXCEEDED" | "PROJECTION_BUDGET_EXCEEDED")[];
}>;

const assetNodeId = (assetId: string) => `asset:${assetId}`;
const operationNodeId = (operationId: string) => `operation:${operationId}`;
const assetOutputPortId = (assetId: string) => `asset:${assetId}:output`;
const assetInputPortId = (assetId: string) => `asset:${assetId}:input`;
const operationInputPortId = (binding: SpaceBinding) => `operation:${binding.operationId}:input:${binding.role}:${binding.ordinal}`;
const operationOutputPortId = (operationId: string) => `operation:${operationId}:output`;

/**
 * A read-only Professional projection of the canonical project domain.
 * It intentionally exposes semantic graph data only: there is no raw provider
 * node, route ID, quote mutation or dispatch command in this model.
 */
export function projectToProfessionalGraph(project: CreativeSpaceProject): ProfessionalGraphProjection {
  const bindingsByOperation = new Map<string, SpaceBinding[]>();
  for (const binding of Object.values(project.bindings)) {
    const current = bindingsByOperation.get(binding.operationId) ?? [];
    current.push(binding);
    bindingsByOperation.set(binding.operationId, current);
  }

  const outputByOperation = new Map<string, SpaceAsset>();
  for (const asset of Object.values(project.assets)) {
    if (asset.origin === "GENERATED" && asset.operationId) outputByOperation.set(asset.operationId, asset);
  }

  const assets: ProfessionalAssetNode[] = Object.values(project.assets)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((asset) => ({
      kind: "ASSET",
      id: assetNodeId(asset.id),
      assetId: asset.id,
      mediaKind: asset.kind,
      ports: [
        { id: assetInputPortId(asset.id), direction: "INPUT", semantic: "OUTPUT", connectedEntityId: asset.operationId ?? null },
        { id: assetOutputPortId(asset.id), direction: "OUTPUT", semantic: "OUTPUT", connectedEntityId: null },
      ],
    }));

  const operations: ProfessionalOperationNode[] = Object.values(project.operations)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((operation) => {
      const inputs = (bindingsByOperation.get(operation.id) ?? [])
        .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
        .map((binding) => ({
          id: operationInputPortId(binding), direction: "INPUT" as const, semantic: binding.role,
          connectedEntityId: binding.assetId,
        }));
      const output = outputByOperation.get(operation.id);
      return {
        kind: "OPERATION",
        id: operationNodeId(operation.id),
        operationId: operation.id,
        recipeId: operation.recipeId,
        state: operation.state,
        customerCredits: operation.customerCredits,
        ports: [...inputs, {
          id: operationOutputPortId(operation.id), direction: "OUTPUT" as const, semantic: "OUTPUT" as const,
          connectedEntityId: output?.id ?? null,
        }],
      };
    });

  const inputEdges = Object.values(project.bindings)
    .filter((binding) => project.assets[binding.assetId] && project.operations[binding.operationId])
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((binding): ProfessionalGraphEdge => ({
      id: binding.id,
      semantic: binding.role,
      source: { nodeId: assetNodeId(binding.assetId), portId: assetOutputPortId(binding.assetId) },
      target: { nodeId: operationNodeId(binding.operationId), portId: operationInputPortId(binding) },
    }));
  const outputEdges = Object.values(project.assets)
    .filter((asset) => asset.origin === "GENERATED" && asset.operationId && project.operations[asset.operationId])
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((asset): ProfessionalGraphEdge => ({
      id: `lineage:${asset.operationId}:${asset.id}`,
      semantic: "OUTPUT",
      source: { nodeId: operationNodeId(asset.operationId!), portId: operationOutputPortId(asset.operationId!) },
      target: { nodeId: assetNodeId(asset.id), portId: assetInputPortId(asset.id) },
    }));

  return { nodes: [...assets, ...operations], edges: [...inputEdges, ...outputEdges] };
}

/** Assesses only the read-only projection; it never changes project data or execution authority. */
export function assessProfessionalGraphBudget(
  projection: ProfessionalGraphProjection,
  input: { timelineClipCount: number; projectionMilliseconds: number },
): ProfessionalGraphBudgetAssessment {
  const reasons: ProfessionalGraphBudgetAssessment["reasons"][number][] = [];
  if (projection.nodes.length > PROFESSIONAL_GRAPH_BUDGET.maxNodes) reasons.push("NODE_BUDGET_EXCEEDED");
  if (projection.edges.length > PROFESSIONAL_GRAPH_BUDGET.maxEdges) reasons.push("EDGE_BUDGET_EXCEEDED");
  if (input.timelineClipCount > PROFESSIONAL_GRAPH_BUDGET.maxTimelineClips) reasons.push("TIMELINE_BUDGET_EXCEEDED");
  if (!Number.isFinite(input.projectionMilliseconds) || input.projectionMilliseconds > PROFESSIONAL_GRAPH_BUDGET.maxProjectionMilliseconds) reasons.push("PROJECTION_BUDGET_EXCEEDED");
  return {
    nodeCount: projection.nodes.length,
    edgeCount: projection.edges.length,
    timelineClipCount: input.timelineClipCount,
    projectionMilliseconds: input.projectionMilliseconds,
    withinBudget: reasons.length === 0,
    reasons,
  };
}
