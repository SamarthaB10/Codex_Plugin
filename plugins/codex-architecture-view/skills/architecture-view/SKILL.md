---
name: architecture-view
description: Report live software architecture while Codex builds or changes a project, and open the live service in the right Codex panel when the user asks to visualize, observe, inspect, or message agents.
---

# Architecture View

## Report work

1. When a software task identifies or creates a service, module, component, endpoint, mapping, worker, queue, or store, call `publish_architecture_event` with `upsert-node` after file or task evidence exists.
2. Report a typed relationship after both connected nodes exist.
3. Set the node to `working` during active work or readjustment, `testing` during verification, `failed` or `blocked` for a problem, and `settled` after successful completion.
4. Update the existing node ID when its role or status changes. Keep file-level details in `affectedFiles` instead of making one node for each file.

Architecture reporting is complete when every changed architectural part and connection has one current, evidence-backed record.

## Build an architecture from an existing project

When this skill is invoked for a task that is already complete, or when the selected task has only the default task node:

1. Inspect the workspace before opening the view. Read the project instructions, context, package manifests, entry points, routes, services, stores, workers, and tests.
2. Publish one `upsert-node` record for each major system, service, module, component, endpoint, mapping, worker, queue, or store that the inspection confirms. Use stable IDs and `parentId` values to show containment.
3. Publish a typed `upsert-relationship` after both connected nodes exist. Keep relationships evidence-backed.
4. Mark inspected, working code as `settled` with `verified` evidence. Mark uncertain areas `thinking` or `unverified` instead of guessing.
5. Do not create one node per file. Put supporting paths in `affectedFiles` and evidence in `evidence`.
6. Reuse existing node IDs. Do not duplicate nodes that are already in the task history.

This inventory pass makes the view useful after a project is finished, not only while a task is running.

## Open and control the view

1. Call `open_architecture_view` when the user asks to see or observe architecture. Pass a task ID only when the user names a different task.
2. Read `viewerUrl` from the tool result. Call `open_in_codex` with a browser target for that address and `placement: "right"`.
3. Keep the right panel open while the task runs. The live service pushes new task state to this panel.
4. Use `get_architecture_state` when architecture data is needed without the visual view.
5. Use `message_codex_task` when the user gives guidance for a running task outside the view.

The message control sends guidance through the same Codex app-server task.
