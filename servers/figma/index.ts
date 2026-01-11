#!/usr/bin/env node
/**
 * Figma MCP Server v2.0
 * Figma API + Flutter/Unity UI Code Generation
 * Converts Figma designs to Flutter widgets and Unity UI
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { gptClient, rootDir } from '../../shared/azure-clients.js';
import { 
  extractDart, 
  extractCSharp,
  extractMultipleFiles,
  saveFile, 
  ensureDir, 
  textResponse, 
  errorResponse,
  generateId 
} from '../../shared/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(rootDir, 'output', 'figma');
const flutterDir = ensureDir(path.join(outputDir, 'flutter'));
const unityDir = ensureDir(path.join(outputDir, 'unity'));
const analysisDir = ensureDir(path.join(outputDir, 'analysis'));

const server = new McpServer({
  name: 'figma-mcp',
  version: '2.0.0',
  description: 'Figma MCP Server - Design to Code Generation'
});

// ==========================================
// SYSTEM PROMPTS
// ==========================================

const FLUTTER_UI_PROMPT = `You are an expert Flutter UI developer. Generate production-ready Flutter 3.24+ widget code.

FLUTTER UI BEST PRACTICES:

1. WIDGET STRUCTURE:
\`\`\`dart
import 'package:flutter/material.dart';

class MyWidget extends StatelessWidget {
  const MyWidget({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    
    return Container(
      // Widget content
    );
  }
}
\`\`\`

2. RESPONSIVE LAYOUTS:
\`\`\`dart
LayoutBuilder(
  builder: (context, constraints) {
    if (constraints.maxWidth > 600) {
      return WideLayout();
    }
    return NarrowLayout();
  },
)

// Or use MediaQuery
final screenWidth = MediaQuery.sizeOf(context).width;
\`\`\`

3. THEMING:
\`\`\`dart
// Use color scheme
final colorScheme = Theme.of(context).colorScheme;

Container(
  color: colorScheme.primaryContainer,
  child: Text(
    'Hello',
    style: TextStyle(color: colorScheme.onPrimaryContainer),
  ),
)

// Use text theme
Text(
  'Title',
  style: Theme.of(context).textTheme.headlineMedium,
)
\`\`\`

4. COMPONENT PATTERNS:
- Use const constructors where possible
- Extract reusable widgets
- Use proper semantics for accessibility
- Handle loading/error/empty states

Always include proper imports and use Flutter 3.24+ conventions.`;

const UNITY_UI_PROMPT = `You are an expert Unity UI developer. Generate production-ready C# code for Unity UI Toolkit (USS + UXML + C#).

UNITY UI TOOLKIT BEST PRACTICES:

1. UI DOCUMENT CONTROLLER:
\`\`\`csharp
using UnityEngine;
using UnityEngine.UIElements;

public class MyUIController : MonoBehaviour
{
    private UIDocument _document;
    private Button _playButton;
    private Label _scoreLabel;
    
    private void Awake()
    {
        _document = GetComponent<UIDocument>();
    }
    
    private void OnEnable()
    {
        var root = _document.rootVisualElement;
        
        _playButton = root.Q<Button>("play-button");
        _scoreLabel = root.Q<Label>("score-label");
        
        _playButton.clicked += OnPlayClicked;
    }
    
    private void OnDisable()
    {
        _playButton.clicked -= OnPlayClicked;
    }
    
    private void OnPlayClicked()
    {
        Debug.Log("Play clicked");
    }
}
\`\`\`

2. USS STYLING:
\`\`\`css
.container {
    flex-direction: column;
    padding: 20px;
    background-color: rgba(0, 0, 0, 0.8);
}

.button {
    background-color: #4CAF50;
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    transition-duration: 0.2s;
}

.button:hover {
    background-color: #45a049;
    scale: 1.05;
}
\`\`\`

3. UXML STRUCTURE:
\`\`\`xml
<ui:UXML xmlns:ui="UnityEngine.UIElements">
    <ui:VisualElement class="container">
        <ui:Label text="Game Title" class="title"/>
        <ui:Button name="play-button" text="Play" class="button"/>
    </ui:VisualElement>
</ui:UXML>
\`\`\`

Generate all three files (C#, USS, UXML) when creating UI components.`;

// ==========================================
// TOOL: Analyze Figma Design
// ==========================================

server.tool(
  'analyze_figma_design',
  'Analyze Figma design and provide implementation strategy',
  {
    designDescription: z.string().describe('Description of the Figma design to analyze'),
    targetPlatform: z.enum(['flutter', 'unity', 'both']).describe('Target platform'),
    screenType: z.enum(['menu', 'hud', 'inventory', 'dialog', 'settings', 'leaderboard', 'shop', 'profile', 'custom']).optional().describe('Type of screen')
  },
  async ({ designDescription, targetPlatform, screenType = 'custom' }) => {
    try {
      const prompt = `Analyze this UI design and provide implementation strategy:

DESIGN: ${designDescription}
SCREEN TYPE: ${screenType}
TARGET: ${targetPlatform}

Provide:
1. Component breakdown (list each UI element)
2. Widget/element hierarchy
3. Color palette extraction (suggest hex codes)
4. Typography recommendations
5. Responsive considerations
6. Animation suggestions
7. Code architecture approach
8. Estimated implementation time`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a UI/UX expert who analyzes designs for game development.' },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 3000,
        temperature: 0.7
      });

      const analysis = response.choices[0].message.content || 'Analysis failed';
      
      const filename = `analysis_${screenType}_${generateId()}.md`;
      const filepath = saveFile(analysis, filename, analysisDir);

      return textResponse(`📊 Design Analysis

${analysis}

📁 **Saved to:** ${filepath}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate Flutter UI
// ==========================================

server.tool(
  'generate_flutter_ui',
  'Generate Flutter UI widget from design description',
  {
    screenType: z.enum(['menu', 'hud', 'inventory', 'dialog', 'settings', 'leaderboard', 'shop', 'profile', 'custom']).describe('Type of screen'),
    description: z.string().describe('Detailed description of the UI'),
    features: z.array(z.string()).optional().describe('Specific features to include'),
    useAnimations: z.boolean().optional().describe('Include animations')
  },
  async ({ screenType, description, features = [], useAnimations = true }) => {
    try {
      const prompt = `Generate Flutter widget for game UI:

SCREEN TYPE: ${screenType}
DESCRIPTION: ${description}
FEATURES: ${features.join(', ') || 'Standard features'}
ANIMATIONS: ${useAnimations ? 'Include smooth animations' : 'Keep static'}

Requirements:
- Complete StatelessWidget or StatefulWidget
- Use proper theming (Theme.of(context))
- Responsive layout with LayoutBuilder if needed
- Proper const usage for optimization
- Clean, reusable code structure`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: FLUTTER_UI_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 5000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractDart(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```dart\n?/gi, '').replace(/```flutter\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('import')) {
        return errorResponse('Failed to generate Flutter UI code.');
      }

      const filename = `${screenType}_screen_${generateId()}.dart`;
      const filepath = saveFile(code, filename, flutterDir);

      return textResponse(`✅ Generated Flutter ${screenType} UI

\`\`\`dart
${code}
\`\`\`

📁 **Saved to:** ${filepath}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate Unity UI
// ==========================================

server.tool(
  'generate_unity_ui',
  'Generate Unity UI Toolkit code from design description',
  {
    screenType: z.enum(['menu', 'hud', 'inventory', 'dialog', 'settings', 'leaderboard', 'shop', 'profile', 'custom']).describe('Type of screen'),
    description: z.string().describe('Detailed description of the UI'),
    features: z.array(z.string()).optional().describe('Specific features to include')
  },
  async ({ screenType, description, features = [] }) => {
    try {
      const prompt = `Generate Unity UI Toolkit code:

SCREEN TYPE: ${screenType}
DESCRIPTION: ${description}
FEATURES: ${features.join(', ') || 'Standard features'}

Generate THREE separate code blocks:
1. C# Controller script (use \`\`\`csharp)
2. USS Stylesheet (use \`\`\`css)
3. UXML Layout (use \`\`\`xml)

Requirements:
- Complete, production-ready code
- Proper event handling in C#
- Modern USS styling with hover/active states
- Semantic UXML structure`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: UNITY_UI_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 5000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      
      // Extract each file type
      const csMatch = content.match(/```csharp\n([\s\S]*?)```/i) || content.match(/```cs\n([\s\S]*?)```/i);
      const ussMatch = content.match(/```css\n([\s\S]*?)```/i) || content.match(/```uss\n([\s\S]*?)```/i);
      const uxmlMatch = content.match(/```xml\n([\s\S]*?)```/i) || content.match(/```uxml\n([\s\S]*?)```/i);

      const id = generateId();
      const files: string[] = [];

      if (csMatch) {
        const csPath = saveFile(csMatch[1].trim(), `${screenType}_ui_${id}.cs`, unityDir);
        files.push(`C# Controller: ${csPath}`);
      }

      if (ussMatch) {
        const ussPath = saveFile(ussMatch[1].trim(), `${screenType}_ui_${id}.uss`, unityDir);
        files.push(`USS Stylesheet: ${ussPath}`);
      }

      if (uxmlMatch) {
        const uxmlPath = saveFile(uxmlMatch[1].trim(), `${screenType}_ui_${id}.uxml`, unityDir);
        files.push(`UXML Layout: ${uxmlPath}`);
      }

      if (files.length === 0) {
        // Fallback - save entire content
        const fallbackPath = saveFile(content, `${screenType}_ui_${id}.txt`, unityDir);
        return textResponse(`Generated Unity UI (raw format)

📁 **Saved to:** ${fallbackPath}

Review and extract C#, USS, and UXML sections manually.`);
      }

      return textResponse(`✅ Generated Unity ${screenType} UI

${content}

📁 **Saved Files:**
${files.map(f => `- ${f}`).join('\n')}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate Component System
// ==========================================

server.tool(
  'generate_ui_component',
  'Generate reusable UI component',
  {
    platform: z.enum(['flutter', 'unity']).describe('Target platform'),
    componentType: z.enum(['button', 'card', 'list-item', 'input', 'toggle', 'slider', 'progress-bar', 'badge', 'avatar', 'tooltip']).describe('Component type'),
    style: z.string().describe('Visual style description'),
    variants: z.array(z.string()).optional().describe('Variant names')
  },
  async ({ platform, componentType, style, variants = ['primary', 'secondary'] }) => {
    try {
      const systemPrompt = platform === 'flutter' ? FLUTTER_UI_PROMPT : UNITY_UI_PROMPT;
      
      const prompt = `Generate reusable ${componentType} component:

PLATFORM: ${platform}
STYLE: ${style}
VARIANTS: ${variants.join(', ')}

Requirements:
- Support all specified variants
- Include hover/press states
- Add customization parameters
- Follow platform design patterns
- Include usage example in comments`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 4000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      const extractFn = platform === 'flutter' ? extractDart : extractCSharp;
      let code = extractFn(content);
      
      if (!code || code.length < 50) {
        const langPattern = platform === 'flutter' ? /```dart\n?/gi : /```csharp\n?/gi;
        code = content.replace(langPattern, '').replace(/```\n?/g, '').trim();
      }

      const dir = platform === 'flutter' ? flutterDir : unityDir;
      const ext = platform === 'flutter' ? 'dart' : 'cs';
      const filename = `${componentType.replace(/-/g, '_')}_component_${generateId()}.${ext}`;
      const filepath = saveFile(code || content, filename, dir);

      return textResponse(`✅ Generated ${platform} ${componentType} component

Variants: ${variants.join(', ')}

\`\`\`${platform === 'flutter' ? 'dart' : 'csharp'}
${code || content}
\`\`\`

📁 **Saved to:** ${filepath}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate Theme System
// ==========================================

server.tool(
  'generate_theme_system',
  'Generate complete theme/styling system',
  {
    platform: z.enum(['flutter', 'unity']).describe('Target platform'),
    colors: z.object({
      primary: z.string(),
      secondary: z.string(),
      background: z.string(),
      surface: z.string(),
      error: z.string()
    }).optional().describe('Color palette'),
    style: z.enum(['modern', 'retro', 'pixel', 'minimalist', 'fantasy', 'sci-fi']).describe('Visual style')
  },
  async ({ platform, colors, style }) => {
    try {
      const defaultColors = colors || {
        primary: '#6200EE',
        secondary: '#03DAC6',
        background: '#121212',
        surface: '#1E1E1E',
        error: '#CF6679'
      };

      const prompt = `Generate complete theme system:

PLATFORM: ${platform}
STYLE: ${style}
COLORS:
- Primary: ${defaultColors.primary}
- Secondary: ${defaultColors.secondary}
- Background: ${defaultColors.background}
- Surface: ${defaultColors.surface}
- Error: ${defaultColors.error}

Requirements:
- Complete color palette with variants
- Typography scale
- Spacing/sizing constants
- Border radius definitions
- Shadow/elevation styles
- ${platform === 'flutter' ? 'ThemeData configuration' : 'USS variables and base styles'}`;

      const systemPrompt = platform === 'flutter' ? FLUTTER_UI_PROMPT : UNITY_UI_PROMPT;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 5000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      const extractFn = platform === 'flutter' ? extractDart : extractCSharp;
      let code = extractFn(content);
      
      if (!code || code.length < 50) {
        code = content;
      }

      const dir = platform === 'flutter' ? flutterDir : unityDir;
      const ext = platform === 'flutter' ? 'dart' : 'cs';
      const filename = `theme_${style}_${generateId()}.${ext}`;
      const filepath = saveFile(code, filename, dir);

      return textResponse(`✅ Generated ${style} theme for ${platform}

\`\`\`${platform === 'flutter' ? 'dart' : 'csharp'}
${code}
\`\`\`

📁 **Saved to:** ${filepath}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: List Generated UI Code
// ==========================================

server.tool(
  'list_figma_output',
  'List all generated UI code',
  {},
  async () => {
    try {
      const flutter = fs.existsSync(flutterDir) ? fs.readdirSync(flutterDir).filter(f => f.endsWith('.dart')) : [];
      const unity = fs.existsSync(unityDir) ? fs.readdirSync(unityDir) : [];
      const analysis = fs.existsSync(analysisDir) ? fs.readdirSync(analysisDir).filter(f => f.endsWith('.md')) : [];
      
      if (flutter.length === 0 && unity.length === 0 && analysis.length === 0) {
        return textResponse('No UI code generated yet.');
      }

      let output = '📁 Generated UI Code:\n\n';
      
      if (flutter.length > 0) {
        output += '**Flutter:**\n' + flutter.map(f => `- ${f}`).join('\n') + '\n\n';
      }
      
      if (unity.length > 0) {
        output += '**Unity UI Toolkit:**\n' + unity.map(f => `- ${f}`).join('\n') + '\n\n';
      }
      
      if (analysis.length > 0) {
        output += '**Design Analysis:**\n' + analysis.map(f => `- ${f}`).join('\n');
      }

      return textResponse(output);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// START SERVER
// ==========================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Figma MCP Server v2.0 running');
}

main().catch(console.error);
