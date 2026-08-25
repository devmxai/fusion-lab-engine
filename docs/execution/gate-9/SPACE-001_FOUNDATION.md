# SPACE-001 — Creative Space Foundation Contract

| Field | Value |
|---|---|
| Status | `LOCAL REFERENCE` |
| View mode | `STANDARD` |
| Canvas library | `@xyflow/react` Core |
| Paid actions | Prohibited |

## Domain ownership

```text
CreativeSpaceProject
├── assets
├── operations
├── bindings
├── canvasItems
├── viewport
└── activity
        ↓ derived only
     xyflow nodes / edges
```

An xyflow node points to one `canvasItemId` and embeds a read projection of the Asset for rendering. Moving a node writes only the corresponding domain `canvasItem.position`. Viewport updates write `project.viewport`. Storage never treats React Flow serialization as project truth.

## Workspace behavior

- Full-browser shell at `/projects/:projectId/studio`.
- Finite elastic extents prevent navigation into an infinite empty plane.
- Zoom range is `0.25–1.75`.
- Fit Project is always accessible in React Flow controls.
- Inspector is a 388px floating desktop panel and collapses to a rail.
- On compact/touch widths the floating panel is hidden while Add and Fit remain accessible.
- Background uses low-contrast CSS/SVG-style dots; no decorative 3D runtime.

## Non-billable boundary

The Phase 9 UI cannot quote or generate. Create actions that require Recipes display a Phase 10 notice. Local upload records only browser file metadata and creates no Engine operation, reservation, provider request or ledger entry.
