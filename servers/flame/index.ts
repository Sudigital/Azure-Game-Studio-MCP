#!/usr/bin/env node
/**
 * Flame MCP Server v2.0
 * Flutter/Flame Game Engine tools powered by Azure AI
 * Generates Dart code for Flame 1.21+ games
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { gptClient, imageClient, rootDir } from '../../shared/azure-clients.js';
import { 
  extractDart, 
  extractMultipleFiles,
  saveFile, 
  ensureDir, 
  fetchAndSaveImage,
  textResponse, 
  errorResponse,
  generateId,
  stylePrompts
} from '../../shared/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(rootDir, 'output', 'flame');
const codeDir = ensureDir(path.join(outputDir, 'code'));
const assetsDir = ensureDir(path.join(outputDir, 'assets'));

const server = new McpServer({
  name: 'flame-mcp',
  version: '2.0.0',
  description: 'Flutter Flame 1.21+ Game Engine MCP Server'
});

// ==========================================
// FLAME 1.21+ SYSTEM PROMPT
// ==========================================

const FLAME_SYSTEM_PROMPT = `You are an expert Flutter/Flame game developer. Generate production-ready Dart code for Flame 1.21+ games.

FLAME 1.21+ CRITICAL PATTERNS:

1. GAME CLASS STRUCTURE:
\`\`\`dart
import 'package:flame/game.dart';
import 'package:flame/components.dart';

class MyGame extends FlameGame with HasCollisionDetection, KeyboardEvents {
  late final World gameWorld;
  late final CameraComponent cameraComponent;
  
  @override
  Future<void> onLoad() async {
    gameWorld = World();
    cameraComponent = CameraComponent(world: gameWorld);
    addAll([gameWorld, cameraComponent]);
  }
}
\`\`\`

2. PLAYER WITH KEYBOARD INPUT:
\`\`\`dart
import 'package:flame/components.dart';
import 'package:flame/collisions.dart';
import 'package:flutter/services.dart';

class Player extends SpriteAnimationComponent 
    with KeyboardHandler, CollisionCallbacks, HasGameReference<MyGame> {
  
  final Vector2 velocity = Vector2.zero();
  final double speed = 200;
  
  @override
  Future<void> onLoad() async {
    add(RectangleHitbox());
  }
  
  @override
  bool onKeyEvent(KeyEvent event, Set<LogicalKeyboardKey> keysPressed) {
    velocity.setZero();
    if (keysPressed.contains(LogicalKeyboardKey.arrowLeft)) {
      velocity.x = -speed;
    }
    if (keysPressed.contains(LogicalKeyboardKey.arrowRight)) {
      velocity.x = speed;
    }
    return true;
  }
  
  @override
  void update(double dt) {
    super.update(dt);
    position += velocity * dt;
  }
}
\`\`\`

3. COLLISION DETECTION:
\`\`\`dart
mixin CollisionCallbacks on Component {
  @override
  void onCollisionStart(Set<Vector2> points, PositionComponent other) {
    if (other is Enemy) {
      // Handle collision
    }
  }
}
\`\`\`

4. CAMERA FOLLOWING:
\`\`\`dart
cameraComponent.follow(player, maxSpeed: 200, snap: true);
\`\`\`

5. SPRITE LOADING:
\`\`\`dart
final sprite = await Sprite.load('player.png');
// OR for animation:
final animation = await SpriteAnimation.load(
  'player_run.png',
  SpriteAnimationData.sequenced(
    amount: 6,
    stepTime: 0.1,
    textureSize: Vector2(32, 32),
  ),
);
\`\`\`

REQUIRED IMPORTS:
- package:flame/game.dart
- package:flame/components.dart  
- package:flame/collisions.dart
- package:flame/events.dart
- package:flame/input.dart
- package:flutter/services.dart (for keyboard)
- package:flutter/material.dart (for Flutter widgets)

MIXINS TO USE:
- HasCollisionDetection (on FlameGame)
- KeyboardHandler (on components for keyboard input)
- CollisionCallbacks (on components for collision)
- HasGameReference<T> (for typed game access)
- TapCallbacks (for tap events)
- DragCallbacks (for drag events)

Always generate complete, compilable Dart code with all imports.`;

// ==========================================
// TOOL: Generate Flame Code
// ==========================================

server.tool(
  'generate_flame_code',
  'Generate Flutter/Flame game code',
  {
    type: z.enum([
      'game', 'player', 'enemy', 'component', 'level',
      'hud', 'menu', 'collectible', 'system', 'full'
    ]).describe('Type of Flame code to generate'),
    description: z.string().describe('Description of what to generate'),
    gameName: z.string().optional().describe('Game class name'),
    withAnimation: z.boolean().optional().describe('Include sprite animation')
  },
  async ({ type, description, gameName = 'MyGame', withAnimation = true }) => {
    try {
      const typeContext: Record<string, string> = {
        game: 'Main FlameGame class with World and CameraComponent',
        player: 'Player component with movement, keyboard input, and collision',
        enemy: 'Enemy component with AI behavior and collision',
        component: 'Reusable game component',
        level: 'Level/World component with tile loading or procedural generation',
        hud: 'HUD overlay showing score, health, etc.',
        menu: 'Main menu screen with RouterComponent',
        collectible: 'Collectible item (coins, powerups) with pickup logic',
        system: 'Game system/manager (spawner, score, audio)',
        full: 'Complete game structure with multiple files'
      };

      const prompt = `Generate Flame 1.21+ Dart code for: ${typeContext[type]}

DESCRIPTION: ${description}

GAME CLASS NAME: ${gameName}
USE ANIMATIONS: ${withAnimation}

${type === 'full' ? `
Generate multiple files with this format:
// FILE: lib/main.dart
[code]

// FILE: lib/game.dart
[code]

// FILE: lib/player.dart
[code]
` : 'Generate a single complete Dart file with all necessary imports.'}`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: FLAME_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: type === 'full' ? 8000 : 4000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      
      if (type === 'full') {
        // Extract multiple files
        const files = extractMultipleFiles(content);
        
        if (files.size > 0) {
          const savedFiles: string[] = [];
          const projectDir = ensureDir(path.join(codeDir, `flame_${generateId()}`));
          
          for (const [filename, code] of files) {
            const filepath = saveFile(code, filename, projectDir);
            savedFiles.push(filepath);
          }
          
          return textResponse(`✅ Generated Flame project with ${files.size} files

${savedFiles.map(f => `📄 ${path.basename(f)}`).join('\n')}

📁 **Project directory:** ${projectDir}`);
        }
      }
      
      // Single file extraction
      let code = extractDart(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```dart\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('import')) {
        return errorResponse('Failed to generate valid Dart code. Please try again.');
      }

      const filename = `${type}_${generateId()}.dart`;
      const filepath = saveFile(code, filename, codeDir);

      return textResponse(`✅ Generated Flame ${type} code

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
// TOOL: Generate Player Component
// ==========================================

server.tool(
  'generate_player',
  'Generate a complete player component with movement and input',
  {
    movementType: z.enum(['platformer', 'topdown', 'sidescroller', 'flying']).describe('Movement style'),
    features: z.array(z.enum([
      'keyboard', 'touch', 'jump', 'dash', 'shoot', 'health', 'animation'
    ])).optional().describe('Player features'),
    spriteName: z.string().optional().describe('Sprite asset filename')
  },
  async ({ movementType, features = ['keyboard', 'jump', 'animation'], spriteName = 'player.png' }) => {
    try {
      const prompt = `Generate a Flame Player component:

MOVEMENT TYPE: ${movementType}
FEATURES: ${features.join(', ')}
SPRITE: ${spriteName}

Requirements:
- Extend appropriate base class (SpriteAnimationComponent for animated, SpriteComponent otherwise)
- Use KeyboardHandler mixin for keyboard input
- Add CollisionCallbacks and RectangleHitbox
- Implement proper physics/velocity-based movement
- Include all necessary imports
${features.includes('jump') ? '- Implement jumping with gravity' : ''}
${features.includes('dash') ? '- Implement dash ability with cooldown' : ''}
${features.includes('health') ? '- Add health system with damage/heal methods' : ''}`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: FLAME_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 4000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractDart(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```dart\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('import')) {
        return errorResponse('Failed to generate player code.');
      }

      const filename = `player_${movementType}_${generateId()}.dart`;
      const filepath = saveFile(code, filename, codeDir);

      return textResponse(`✅ Generated ${movementType} player with: ${features.join(', ')}

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
// TOOL: Generate Enemy Component
// ==========================================

server.tool(
  'generate_enemy',
  'Generate enemy component with AI behavior',
  {
    behavior: z.enum(['patrol', 'chase', 'shooter', 'boss', 'flying', 'stationary']).describe('Enemy behavior'),
    description: z.string().describe('Enemy description'),
    difficulty: z.enum(['easy', 'medium', 'hard']).optional().describe('Difficulty level')
  },
  async ({ behavior, description, difficulty = 'medium' }) => {
    try {
      const prompt = `Generate a Flame Enemy component:

BEHAVIOR: ${behavior}
DESCRIPTION: ${description}
DIFFICULTY: ${difficulty}

Requirements:
- Extend SpriteComponent or SpriteAnimationComponent
- Add CollisionCallbacks and hitbox
- Implement ${behavior} AI behavior
- Include state machine if complex behavior needed
- Add damage/death handling
- Use HasGameReference for game access`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: FLAME_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 4000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractDart(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```dart\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('import')) {
        return errorResponse('Failed to generate enemy code.');
      }

      const filename = `enemy_${behavior}_${generateId()}.dart`;
      const filepath = saveFile(code, filename, codeDir);

      return textResponse(`✅ Generated ${behavior} enemy (${difficulty})

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
// TOOL: Generate Game Asset
// ==========================================

server.tool(
  'generate_sprite',
  'Generate 2D game sprite using DALL-E',
  {
    description: z.string().describe('Sprite description'),
    style: z.enum(['pixel-art', 'cartoon', 'anime', 'realistic', 'low-poly']).optional().describe('Art style'),
    size: z.enum(['1024x1024', '1792x1024', '1024x1792']).optional().describe('Image size')
  },
  async ({ description, style = 'pixel-art', size = '1024x1024' }) => {
    try {
      const stylePrompt = stylePrompts[style] || stylePrompts['pixel-art'];
      const enhanced = `${stylePrompt}: ${description}, game-ready sprite, centered, complete, transparent background, no cutoff`;

      const response = await imageClient.images.generate({
        prompt: enhanced,
        n: 1,
        size: size
      });

      const imageUrl = response.data[0].url!;
      const filename = `sprite_${generateId()}.png`;
      const filepath = await fetchAndSaveImage(imageUrl, filename, assetsDir);

      return textResponse(`✅ Generated ${style} sprite

📁 **Saved to:** ${filepath}

Copy to your Flutter project's assets folder to use with Flame.`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: List Generated Code
// ==========================================

server.tool(
  'list_flame_code',
  'List all generated Flame code files',
  {},
  async () => {
    try {
      const files = fs.readdirSync(codeDir);
      
      if (files.length === 0) {
        return textResponse('No Flame code generated yet.');
      }

      const fileList = files.map(f => {
        const fullPath = path.join(codeDir, f);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          return `📁 ${f}/ (project)`;
        }
        return `📄 ${f}`;
      }).join('\n');

      return textResponse(`📁 Generated Flame Code:\n\n${fileList}\n\n**Directory:** ${codeDir}`);

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
  console.error('Flame MCP Server v2.0 running');
}

main().catch(console.error);
