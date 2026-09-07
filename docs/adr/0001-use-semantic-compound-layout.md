# ADR 0001: Use semantic compound layout

## Status

Accepted

## Context

The view placed nodes in a simple top-to-bottom stack. This did not show the codebase structure. The reported data already includes parent links and typed relationships.

## Decision

Use parent links as the main containment rule. Use typed relationships for flow and ordering. Show systems, services, and modules as containers. Show nodes without enough structural data in a separate Unmapped area. Do not infer links that were not reported.

Keep the hidden workspace root. Support more than one top-level system and support cycles.

## Consequences

The map shows reported architecture instead of report arrival order. Good source data produces a stable hierarchy. Incomplete source data stays visible without creating false structure.
