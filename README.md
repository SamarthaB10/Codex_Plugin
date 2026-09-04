# Codex Architecture View

Codex Architecture View is a loadable Codex plugin. It shows live agent work, project architecture, relationships, events, and task messaging in a live server view.

## Install from GitHub

Requirements: Codex, Node.js 20 or newer, and a local Codex app-server.

```bash
git clone https://github.com/SamarthaB10/Codex_Plugin.git
cd Codex_Plugin
npm --prefix plugins/codex-architecture-view install
npm --prefix plugins/codex-architecture-view run check
codex plugin marketplace add .
codex plugin add codex-architecture-view@codex-plugin
```

Start a new Codex task after installation. Ask Codex to visualize the architecture. The plugin reports nodes while the task runs. If the task is complete or has no architecture records, the Architecture View skill inspects the workspace and publishes an evidence-based project inventory before opening the view.

## Use during a task

Ask Codex:

```text
Visualize the architecture of this task and keep the live view open.
```

The view stays connected to the Codex app-server. Use **Message your agents** to send guidance to the selected task.

## Development

```bash
npm --prefix plugins/codex-architecture-view install
npm --prefix plugins/codex-architecture-view run check
```

The plugin manifest is at `plugins/codex-architecture-view/.codex-plugin/plugin.json`. The built MCP app is committed at `plugins/codex-architecture-view/dist/architecture-view.html` so a clone can load it immediately.

## License

This project is provided for use with Codex. Add a license before redistributing it under a specific open-source license.
