# Codex Architecture View

See your project's architecture and agent work in a live Codex panel. Inspect nodes and connections, follow task events, and send guidance to your agents.

**[Download the plugin ZIP](https://github.com/SamarthaB10/Codex_Plugin/archive/refs/heads/main.zip)** · [Install](#install) · [Use the plugin](#use-the-plugin)

## Install

You need the Codex desktop app, a Codex CLI with plugin support, and Node.js 20 or newer with npm. See the [official Codex CLI setup guide](https://developers.openai.com/codex/cli/) if you need to install the CLI. Check that `codex --version` and `node --version` work in your terminal.

### 1. Download

[Download the ZIP](https://github.com/SamarthaB10/Codex_Plugin/archive/refs/heads/main.zip), extract it, and open a terminal in the extracted **Codex_Plugin-main** folder. This folder contains `marketplace.json`.

If you use Git, run these commands instead:

```bash
git clone https://github.com/SamarthaB10/Codex_Plugin.git
cd Codex_Plugin
```

### 2. Install the plugin

Run this block from the downloaded or cloned folder:

```bash
npm --prefix plugins/codex-architecture-view ci
codex plugin marketplace add .
codex plugin add codex-architecture-view@codex-plugin
```

The first command installs the plugin's dependencies. The next two commands register this repository and install Architecture View. The built view is included, so you do not need to build it or run the development tests.

### 3. Open it in Codex

Start a **new Codex task** in your project and send:

```text
Visualize the architecture of this project.
```

You can also select the **visualize-architecture** skill. Codex inspects the project and opens the live view in the right panel. The plugin connects to the local Codex app-server and tries to start it if it is not running.

## Use the plugin

| Control | What it does |
| --- | --- |
| Task selector | Shows architecture for another task. |
| Fit nodes | Fits the map into the visible area. |
| + / − | Zooms in or out. Trackpad pinch also zooms; two-finger scrolling moves the view. |
| Node cards | Drag a card to change its position. |
| Download nodes PNG | Saves the map with node cards, connections, and labels. Controls and the event panel are excluded. |
| Copy reopen link | Copies the current task's view address. Save it before closing the panel. |
| Message your agents | Sends guidance to the selected task. |

To reopen a closed view without asking the agent, use your saved link or the **Open architecture** link in the task response. These links work while the local architecture service is running. After the service stops, ask Codex to open the view again to get a new link.

The view can show work in progress or a completed project. When architecture records are missing, the skill inspects the project before it creates the map.

## Installation help

- **`codex` or `npm` is not found:** Install the required CLI or Node.js, then open a new terminal.
- **`codex plugin` is not available:** Use a Codex CLI version that supports plugins.
- **The skill does not appear:** Start a new task after installation. Run `codex plugin list` and look for `codex-architecture-view@codex-plugin`.
- **The view cannot connect:** Check that `codex` is available to the plugin process. The default app-server address is `ws://127.0.0.1:4500`.
- **A reopen link stops working:** The local service may have stopped. Open the view through Codex once to get a new link.

## Development

From the repository folder:

```bash
npm --prefix plugins/codex-architecture-view ci
npm --prefix plugins/codex-architecture-view run check
```

The check command builds the view and runs the tests.

- Plugin manifest: `plugins/codex-architecture-view/.codex-plugin/plugin.json`
- Skill: `plugins/codex-architecture-view/skills/visualize-architecture/SKILL.md`
- Built view: `plugins/codex-architecture-view/dist/architecture-view.html`

## License

This repository does not yet include an open-source license.
