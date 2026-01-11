# Contributing to Azure Game Studio MCP

Thank you for your interest in contributing! This project powers game development workflows using Azure AI services.

## 🚀 Quick Start

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/azure-mcp.git`
3. Install dependencies: `bun install`
4. Copy environment config: `cp .env.example .env`
5. Add your Azure credentials to `.env`
6. Run a server: `bun run dev:blender`

## 📁 Project Structure

```
azure-mcp/
├── index.ts              # Core server (sprites, video, voice, story)
├── servers/
│   ├── blender/         # Blender 5.x Python generation
│   ├── flame/           # Flutter/Flame 1.21+ Dart code
│   ├── unity/           # Unity 6 C# scripts
│   └── figma/           # Figma → Flutter/Unity UI
├── shared/
│   ├── azure-clients.ts # Azure AI client setup
│   ├── utils.ts         # Code extraction utilities
│   └── types.ts         # TypeScript types
└── output/              # Generated files (gitignored)
```

## 🔧 Development Guidelines

### Code Style

- Use TypeScript with strict types
- Follow existing patterns in the codebase
- Add JSDoc comments for public functions
- Use meaningful variable names

### Adding a New MCP Tool

1. Create tool in the appropriate server file
2. Use Zod schemas for input validation
3. Use shared utilities from `shared/utils.ts`
4. Add comprehensive error handling
5. Include helpful response messages

```typescript
server.tool(
  'my_new_tool',
  'Description of what this tool does',
  {
    param1: z.string().describe('Parameter description'),
    param2: z.boolean().optional().describe('Optional param')
  },
  async ({ param1, param2 = false }) => {
    try {
      // Implementation
      return textResponse('Success message');
    } catch (error: any) {
      return errorResponse(error);
    }
  }
);
```

### Adding a New Server

1. Create `servers/your-server/index.ts`
2. Import shared clients from `../../shared/azure-clients.js`
3. Import utilities from `../../shared/utils.js`
4. Add npm script in `package.json`
5. Document in README.md

### Commit Messages

Use conventional commits:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance

Examples:
```
feat(blender): add material generation tool
fix(utils): handle empty AI responses
docs: update installation instructions
```

## 🧪 Testing

Before submitting a PR:

1. **Build check**: `bun run typecheck`
2. **Test locally**: Run the server you modified
3. **Test with Claude**: Verify tools work in Claude Desktop or VS Code

## 📝 Pull Request Process

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Test thoroughly
4. Commit with clear messages
5. Push and create a PR
6. Describe what you changed and why

### PR Checklist

- [ ] Code follows existing style
- [ ] Added/updated documentation if needed
- [ ] No sensitive data (API keys, endpoints)
- [ ] Tested with at least one AI model
- [ ] Build passes (`bun run typecheck`)

## 🐛 Reporting Issues

When reporting issues, include:

1. **Description**: What happened vs. what you expected
2. **Steps to reproduce**: How to trigger the issue
3. **Environment**: OS, Bun version, Node version
4. **Logs**: Error messages or console output
5. **Server**: Which MCP server (blender, flame, unity, etc.)

## 💡 Feature Requests

Feature requests are welcome! Please include:

1. **Use case**: Why you need this feature
2. **Proposed solution**: How it might work
3. **Alternatives considered**: Other approaches

## 🔐 Security

- **NEVER** commit API keys or credentials
- Use `.env` for all sensitive configuration
- Report security vulnerabilities privately

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🙏 Thank You!

Every contribution helps make game development with AI more accessible!
