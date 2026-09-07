# ADR 0003: Use ELK for layout

## Status

Accepted

## Context

The map needs compound nodes, hierarchy-aware edges, cycles, stable updates, and interactive positions. A simple stack or tree layout cannot meet all of these needs.

## Decision

Use ELK layered layout in the web client. Use compound graphs, rightward flow, orthogonal edges, and interactive layout hints. Keep layout input and output behind the semantic layout module.

## Consequences

The map can show nested architecture and cyclic relationships. The browser bundle is larger. Tests must cover layout behavior and performance.
