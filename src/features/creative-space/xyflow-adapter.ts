import type { Edge, Node } from "@xyflow/react";
import type { CreativeSpaceProject, SpaceAsset, SpaceOperation, SpaceViewMode } from "./domain";
import { projectToProfessionalGraph, type ProfessionalGraphPort } from "./professional-graph";

export type SpaceAssetNodeData = Record<string, unknown> & {
  kind: "asset";
  canvasItemId: string;
  asset: SpaceAsset;
};

export type SpaceOperationNodeData = Record<string, unknown> & {
  kind: "operation";
  canvasItemId: string;
  operation: SpaceOperation;
};

export type ProfessionalAssetNodeData = SpaceAssetNodeData & { ports: readonly ProfessionalGraphPort[] };
export type ProfessionalOperationNodeData = SpaceOperationNodeData & { ports: readonly ProfessionalGraphPort[] };

export type SpaceAssetFlowNode = Node<SpaceAssetNodeData, "spaceAsset">;
export type SpaceOperationFlowNode = Node<SpaceOperationNodeData, "spaceOperation">;
export type ProfessionalAssetFlowNode = Node<ProfessionalAssetNodeData, "professionalAsset">;
export type ProfessionalOperationFlowNode = Node<ProfessionalOperationNodeData, "professionalOperation">;
export type SpaceFlowNode = SpaceAssetFlowNode | SpaceOperationFlowNode | ProfessionalAssetFlowNode | ProfessionalOperationFlowNode;
export type SpaceFlowEdge = Edge<Record<string, unknown>>;

export function projectToFlow(project: CreativeSpaceProject, viewMode: SpaceViewMode = "STANDARD"): { nodes: SpaceFlowNode[]; edges: SpaceFlowEdge[] } {
  if (viewMode === "PROFESSIONAL") return projectToProfessionalFlow(project);
  const nodeByEntity = new Map<string, string>();
  const nodes = Object.values(project.canvasItems)
    .sort((left, right) => left.zIndex - right.zIndex)
    .flatMap((item): SpaceFlowNode[] => {
      if (item.entityType === "ASSET") {
        const asset = project.assets[item.entityId];
        if (!asset) return [];
        nodeByEntity.set(asset.id, item.id);
        return [{ id: item.id, type: "spaceAsset", position: { ...item.position }, width: item.size.width, height: item.size.height, data: { kind: "asset", canvasItemId: item.id, asset }, zIndex: item.zIndex, dragHandle: ".space-card-drag-handle" }];
      }
      const operation = project.operations[item.entityId];
      if (!operation) return [];
      nodeByEntity.set(operation.id, item.id);
      return [{ id: item.id, type: "spaceOperation", position: { ...item.position }, width: item.size.width, height: item.size.height, data: { kind: "operation", canvasItemId: item.id, operation }, zIndex: item.zIndex, dragHandle: ".space-card-drag-handle" }];
    });

  const edges = Object.values(project.bindings).flatMap((binding): SpaceFlowEdge[] => {
    const source = nodeByEntity.get(binding.assetId);
    const targetItem = Object.values(project.canvasItems).find(
      (item) => item.entityType === "OPERATION" && item.entityId === binding.operationId,
    );
    if (!source || !targetItem) return [];
    return [{
      id: binding.id,
      source,
      target: targetItem.id,
      sourceHandle: "output",
      targetHandle: "input",
      type: "smoothstep",
      data: { role: binding.role, ordinal: binding.ordinal },
    }];
  });
  for (const asset of Object.values(project.assets)) {
    if (asset.origin !== "GENERATED" || !asset.operationId) continue;
    const source = nodeByEntity.get(asset.operationId);
    const target = nodeByEntity.get(asset.id);
    if (!source || !target) continue;
    edges.push({ id: `lineage:${asset.operationId}:${asset.id}`, source, target, sourceHandle: "output", targetHandle: "input", type: "smoothstep", animated: false, data: { role: "OUTPUT", ordinal: 0 } });
  }
  return { nodes, edges };
}

function projectToProfessionalFlow(project: CreativeSpaceProject): { nodes: SpaceFlowNode[]; edges: SpaceFlowEdge[] } {
  const projection = projectToProfessionalGraph(project);
  const assetPorts = new Map(projection.nodes.filter((node) => node.kind === "ASSET").map((node) => [node.assetId, node.ports]));
  const operationPorts = new Map(projection.nodes.filter((node) => node.kind === "OPERATION").map((node) => [node.operationId, node.ports]));
  const nodeByEntity = new Map<string, string>();
  const nodes = Object.values(project.canvasItems)
    .sort((left, right) => left.zIndex - right.zIndex)
    .flatMap((item): SpaceFlowNode[] => {
      if (item.entityType === "ASSET") {
        const asset = project.assets[item.entityId];
        const ports = assetPorts.get(item.entityId);
        if (!asset || !ports) return [];
        nodeByEntity.set(asset.id, item.id);
        return [{ id: item.id, type: "professionalAsset", position: { ...item.position }, width: item.size.width, height: item.size.height, data: { kind: "asset", canvasItemId: item.id, asset, ports }, zIndex: item.zIndex, dragHandle: ".space-card-drag-handle" }];
      }
      const operation = project.operations[item.entityId];
      const ports = operationPorts.get(item.entityId);
      if (!operation || !ports) return [];
      nodeByEntity.set(operation.id, item.id);
      return [{ id: item.id, type: "professionalOperation", position: { ...item.position }, width: item.size.width, height: item.size.height, data: { kind: "operation", canvasItemId: item.id, operation, ports }, zIndex: item.zIndex, dragHandle: ".space-card-drag-handle" }];
    });
  const resolveAssetOutput = (assetId: string) => `asset:${assetId}:output`;
  const resolveAssetInput = (assetId: string) => `asset:${assetId}:input`;
  const resolveOperationInput = (binding: { operationId: string; role: string; ordinal: number }) => `operation:${binding.operationId}:input:${binding.role}:${binding.ordinal}`;
  const resolveOperationOutput = (operationId: string) => `operation:${operationId}:output`;
  const inputEdges = Object.values(project.bindings).flatMap((binding): SpaceFlowEdge[] => {
    const source = nodeByEntity.get(binding.assetId);
    const target = nodeByEntity.get(binding.operationId);
    if (!source || !target) return [];
    return [{ id: binding.id, source, target, sourceHandle: resolveAssetOutput(binding.assetId), targetHandle: resolveOperationInput(binding), type: "smoothstep", label: binding.role, data: { role: binding.role, ordinal: binding.ordinal, permanent: true }, style: { stroke: "#a78bfa", strokeWidth: 2 }, labelStyle: { fill: "#ddd6fe", fontSize: 10, fontWeight: 700 }, labelBgStyle: { fill: "#111318", fillOpacity: 0.92 } }];
  });
  const outputEdges = Object.values(project.assets).flatMap((asset): SpaceFlowEdge[] => {
    if (asset.origin !== "GENERATED" || !asset.operationId) return [];
    const source = nodeByEntity.get(asset.operationId);
    const target = nodeByEntity.get(asset.id);
    if (!source || !target) return [];
    return [{ id: `lineage:${asset.operationId}:${asset.id}`, source, target, sourceHandle: resolveOperationOutput(asset.operationId), targetHandle: resolveAssetInput(asset.id), type: "smoothstep", label: "OUTPUT", data: { role: "OUTPUT", ordinal: 0, permanent: true }, style: { stroke: "#34d399", strokeWidth: 2 }, labelStyle: { fill: "#a7f3d0", fontSize: 10, fontWeight: 700 }, labelBgStyle: { fill: "#111318", fillOpacity: 0.92 } }];
  });
  return { nodes, edges: [...inputEdges, ...outputEdges] };
}
