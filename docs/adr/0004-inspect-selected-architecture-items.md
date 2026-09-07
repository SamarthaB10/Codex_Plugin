# ADR 0004: Inspect selected architecture items

## Status

Accepted

## Context

Node cards have limited room. Users need the evidence and relationships behind each architecture item.

## Decision

A node or relationship click opens its details in the right-side Architecture Inspector. Show the data that is present: type, role, status, verification, parent, children, inbound and outbound relationships, files, and evidence. Keep the last details if a selected node is removed, until the user closes the inspector or selects another item.

Support pointer and keyboard selection.

## Consequences

The map stays readable while detailed architecture data remains available. Missing fields stay absent instead of showing invented content.
