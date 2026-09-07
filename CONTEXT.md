# Project Context

## Domain language

**Architecture View** — The live map that shows the software structure for one Codex task.

**Architecture Node** — A reported software element, such as a system, service, module, component, store, endpoint, or mapping.

**Relationship** — A reported directional link between two architecture nodes. Its kind and label explain the interaction.

**Parent Node** — The architecture node that contains another node. Parent links define the main structural hierarchy.

**Container Node** — A system, service, or module that contains child nodes in the map.

**Unmapped Node** — A node that has no reported parent and no relationship that gives it a structural position. The view shows it in a separate Unmapped area.

**Pinned Node** — A node that a user moved. Automatic arrangement keeps its saved position. A pinned container moves its descendants with it.

**Collapsed Node** — A container whose descendants are hidden. Relationships from hidden descendants are shown as aggregated links at the container.

**Selected Item** — The node or relationship whose details are shown in the architecture inspector.

**Architecture Inspector** — The right-side area that shows details for the selected node or relationship.

**Architecture Event** — A change report that adds, updates, settles, or removes a node, relationship, or agent record.

**Verification** — The reported evidence state for an architecture item: verified, unverified, or failed.

**Live Session** — The local service session that connects one Codex task to its Architecture View.

**Architecture Identity** — A stable identifier for the same software element across live updates. Full identity reconciliation is a later feature.

**Architecture Conflict** — Two reports that describe the same software element in incompatible ways. Conflict handling is a later feature.

**Pending Architecture Data** — A report that cannot yet be attached to a known architecture item. Pending report handling is a later feature.

## Visual rules

- Node status controls the node status color.
- Parent links control containment.
- Relationships control functional flow and ordering.
- The map does not invent missing relationships.
- A status-only update does not move nodes.
