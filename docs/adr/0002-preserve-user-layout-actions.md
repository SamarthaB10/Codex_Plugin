# ADR 0002: Preserve user layout actions

## Status

Accepted

## Context

Live updates can make a map move while a user reads it. Users also need to keep important nodes in a chosen position.

## Decision

Run automatic layout only for structural changes. Group nearby structural updates for 300 milliseconds. A drag pins the node. A pinned container moves its descendants. Arrange keeps pins. Reset layout clears pins. Fit nodes changes only the viewport. Refresh changes only the data.

Keep the last valid layout if layout fails. Respect reduced-motion settings.

## Consequences

Status and evidence updates do not cause unwanted movement. User positions remain stable. The controls have separate and predictable effects.
