# Azure Game Studio MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.0+-black?logo=bun)](https://bun.sh)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Azure OpenAI](https://img.shields.io/badge/Azure-OpenAI-0078D4?logo=microsoftazure)](https://azure.microsoft.com/en-us/products/ai-services/openai-service)

> 🎮 Multi-engine game development tools powered by Azure AI Services and the Model Context Protocol (MCP)

Generate production-ready code for **Blender**, **Unity**, **Flutter/Flame**, and **Figma** using AI-powered tools that integrate directly with Claude Desktop or VS Code.

<p align="center">
  <img src="https://img.shields.io/badge/Blender-5.x-orange?logo=blender" alt="Blender 5.x">
  <img src="https://img.shields.io/badge/Unity-6-black?logo=unity" alt="Unity 6">
  <img src="https://img.shields.io/badge/Flutter-3.24+-blue?logo=flutter" alt="Flutter 3.24+">
  <img src="https://img.shields.io/badge/Flame-1.21+-red" alt="Flame 1.21+">
</p>

---

## ✨ Features

- 🎨 **Blender MCP** - Python scripts for 3D modeling, rigging, animation, materials
- 🎮 **Unity MCP** - C# scripts with Unity 6 Input System, Awaitable async
- 🔥 **Flame MCP** - Dart code for Flutter games with Flame 1.21+ patterns
- 🎯 **Figma MCP** - Convert designs to Flutter widgets or Unity UI Toolkit
- 🖼️ **Core MCP** - Sprite generation (DALL-E 3), video (Sora), voice (Azure Speech)

## 🏗️ Architecture

```
azure-game-studio-mcp/
├── index.ts              # Core server (sprites, video, voice, story)
├── servers/
│   ├── blender/         # Blender 5.x Python generation
│   ├── flame/           # Flutter/Flame 1.21+ Dart code
│   ├── unity/           # Unity 6 C# scripts
│   └── figma/           # Figma → Flutter/Unity UI
├── shared/
│   ├── azure-clients.ts # Azure AI client configuration
│   ├── utils.ts         # Code extraction & utilities
│   └── types.ts         # TypeScript type definitions
└── output/              # Generated files (gitignored)
```

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+ (recommended) or Node.js 18+
- [Azure OpenAI](https://azure.microsoft.com/en-us/products/ai-services/openai-service) access
- Optional: Azure Speech Services, Figma API token

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/azure-game-studio-mcp.git
cd azure-game-studio-mcp

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your Azure credentials
```

### Running Servers

```bash
# Individual servers
bun run dev:core      # Core (sprites, video, voice)
bun run dev:blender   # Blender Python scripts
bun run dev:flame     # Flutter/Flame Dart code
bun run dev:unity     # Unity C# scripts
bun run dev:figma     # Figma UI code generation

# Type checking
bun run typecheck

# Build all servers
bun run build
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Required: Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key
AZURE_GPT_DEPLOYMENT_NAME=gpt-4o
AZURE_IMAGE_DEPLOYMENT_NAME=dall-e-3

# Optional: Azure Sora (video generation)
AZURE_SORA_DEPLOYMENT_NAME=sora

# Optional: Azure Speech (voice generation)
AZURE_SPEECH_KEY=your-speech-key
AZURE_SPEECH_REGION=eastus

# Optional: Figma API
FIGMA_ACCESS_TOKEN=your-figma-token
```

### MCP Client Configuration

Copy `mcp-config.example.json` and configure for your MCP client:

<details>
<summary><b>Claude Desktop</b> (~/.config/claude/claude_desktop_config.json)</summary>

```json
{
  "mcpServers": {
    "blender-mcp": {
      "command": "bun",
      "args": ["run", "/path/to/azure-game-studio-mcp/servers/blender/index.ts"],
      "env": {
        "AZURE_OPENAI_ENDPOINT": "https://your-resource.openai.azure.com/",
        "AZURE_OPENAI_API_KEY": "your-api-key",
        "AZURE_GPT_DEPLOYMENT_NAME": "gpt-4o"
      }
    }
  }
}
```
</details>

<details>
<summary><b>VS Code</b> (.vscode/settings.json)</summary>

```json
{
  "mcp.servers": {
    "blender-mcp": {
      "command": "bun",
      "args": ["run", "${workspaceFolder}/servers/blender/index.ts"]
    }
  }
}
```
</details>

## 📋 Available Tools

### 🎨 Blender MCP (`servers/blender/`)

| Tool | Description |
|------|-------------|
| `generate_blender_script` | Generate Blender Python automation script |
| `generate_3d_model` | Create mesh generation scripts |
| `generate_rig` | Character rigging automation |
| `generate_animation` | Animation and keyframe scripts |
| `generate_material` | Shader and material node setup |
| `list_scripts` | List generated scripts |

### 🔥 Flame MCP (`servers/flame/`)

| Tool | Description |
|------|-------------|
| `generate_flame_code` | General Flame/Dart code generation |
| `generate_player` | Player component with movement, input |
| `generate_enemy` | Enemy AI with state machine |
| `generate_sprite` | SpriteComponent/AnimationComponent |
| `list_flame_code` | List generated Dart files |

### 🎮 Unity MCP (`servers/unity/`)

| Tool | Description |
|------|-------------|
| `generate_unity_script` | MonoBehaviour, ScriptableObject, etc. |
| `generate_player_controller` | Full player with physics, input |
| `generate_enemy_ai` | Enemy with state machine, NavMesh |
| `generate_scriptable_object` | Data containers for items, configs |
| `generate_editor_script` | Custom editors, windows, drawers |
| `list_unity_scripts` | List generated C# files |

### 🎯 Figma MCP (`servers/figma/`)

| Tool | Description |
|------|-------------|
| `analyze_figma_design` | Get implementation strategy |
| `generate_flutter_ui` | Flutter widgets from design |
| `generate_unity_ui` | Unity UI Toolkit (UXML/USS/C#) |
| `generate_ui_component` | Reusable UI components |
| `generate_theme_system` | Complete theming setup |

### 🖼️ Core MCP (`index.ts`)

| Tool | Description |
|------|-------------|
| `generate_2d_asset` | Sprites with DALL-E 3 |
| `generate_video` | Game cinematics with Sora |
| `generate_voice` | Character voices (Azure Speech) |
| `generate_story` | Narrative and dialogue |
| `create_game_package` | Complete game asset bundle |

## 💡 Usage Examples

### Generate a Blender Character

```
Using blender-mcp: Create a low-poly medieval knight character 
with basic rig for Unity export
```

### Generate a Flame Player

```
Using flame-mcp: Create a platformer player with double jump, 
wall slide, and dash abilities
```

### Generate Unity Enemy AI

```
Using unity-mcp: Create a patrol enemy that chases the player 
when spotted and attacks in melee range
```

### Generate Flutter UI from Design

```
Using figma-mcp: Create a game menu screen with play button, 
settings, and leaderboard in sci-fi style
```

## 🛠️ Development

### Project Setup

```bash
# Install dependencies
bun install

# Run type checking
bun run typecheck

# Build all servers
bun run build
```

### Adding New Tools

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding new MCP tools.

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Code style guidelines
- How to add new tools
- Pull request process
- Issue reporting

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io) by Anthropic
- [Azure OpenAI Service](https://azure.microsoft.com/en-us/products/ai-services/openai-service)
- [Bun](https://bun.sh) runtime

---

<p align="center">
  Made with ❤️ for game developers
</p>
