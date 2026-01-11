#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AzureOpenAI } from 'openai';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, 'assets');
const audioDir = path.join(__dirname, 'audio');
fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });
const videoDir = path.join(__dirname, 'videos');
fs.mkdirSync(videoDir, { recursive: true });

// DALL-E 3 client for image generation
const imageClient = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: '2024-02-01',
  deployment: process.env.AZURE_IMAGE_DEPLOYMENT_NAME || 'dall-e-3',
});

// Sora client for video generation
const soraClient = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: '2025-04-01-preview',
  deployment: process.env.AZURE_SORA_DEPLOYMENT_NAME || 'sora',
});

// GPT-4 client for story and code generation
const gptClient = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: '2024-02-01',
  deployment: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
});

// Azure Speech config
const speechConfig = process.env.AZURE_SPEECH_KEY 
  ? sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY,
      process.env.AZURE_SPEECH_REGION || 'eastus'
    )
  : null;

const server = new McpServer({
  name: 'azure-game-studio',
  version: '3.0.0',
});

server.tool(
  'generate_2d_asset',
  'Generate pixel art 2D game sprite for Flutter/Flame using DALL-E 3',
  { 
    prompt: z.string().describe('Game asset description'),
    style: z.enum(['pixel-art', 'cartoon', 'realistic', 'anime', 'low-poly']).optional().describe('Art style'),
    size: z.enum(['1024x1024', '1792x1024', '1024x1792']).optional().describe('Image size')
  },
  async ({ prompt, style = 'pixel-art', size = '1024x1024' }) => {
    const stylePrompts: Record<string, string> = {
      'pixel-art': '16-bit pixel art game sprite, retro style, clean pixels',
      'cartoon': 'cartoon game character, cel-shaded, vibrant colors',
      'realistic': 'realistic game asset, detailed textures, PBR-ready',
      'anime': 'anime style game character, clean lines, expressive',
      'low-poly': 'low-poly 3D style, geometric shapes, minimal details'
    };
    
    const enhanced = `${stylePrompts[style]}: ${prompt}, game-ready asset, solid white background, centered, complete object, no cutoff, professional quality`;
    
    const res = await imageClient.images.generate({
      prompt: enhanced, 
      n: 1, 
      size: size
    });
    
    if (!res.data?.[0]?.url) {
      return { content: [{ type: 'text', text: 'Failed to generate image' }] };
    }
    const imgRes = await fetch(res.data[0].url);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    
    const filename = `${style}_asset_${Date.now()}.png`;
    const filepath = path.join(assetsDir, filename);
    await sharp(buffer).png().toFile(filepath);
    
    return {
      content: [{ type: 'text', text: `Generated ${style} asset: ${filename} (saved to ${filepath})` }]
    };
  }
);

// 🎬 Video Generation Tool (Sora)
server.tool(
  'generate_video',
  'Generate game cinematics, trailers, or animated sequences using Sora',
  { 
    prompt: z.string().describe('Video description - be detailed about motion, camera, and scene'),
    duration: z.enum(['5', '10', '15', '20']).optional().describe('Video duration in seconds'),
    resolution: z.enum(['480p', '720p', '1080p']).optional().describe('Video resolution'),
    style: z.enum(['cinematic', 'anime', 'pixel-art', 'realistic', '3d-render']).optional().describe('Visual style')
  },
  async ({ prompt, duration = '5', resolution = '1080p', style = 'cinematic' }) => {
    const stylePrompts: Record<string, string> = {
      'cinematic': 'cinematic game trailer, dramatic lighting, professional camera movements',
      'anime': 'anime style animation, vibrant colors, expressive characters',
      'pixel-art': 'pixel art animation, retro game style, 16-bit aesthetic',
      'realistic': 'photorealistic game footage, high detail, realistic physics',
      '3d-render': '3D rendered game scene, smooth animation, modern graphics'
    };
    
    const enhanced = `${stylePrompts[style]}: ${prompt}. High quality game footage, smooth motion, professional production value.`;
    
    // Resolution mapping
    const resolutionMap: Record<string, { width: string; height: string }> = {
      '480p': { width: '854', height: '480' },
      '720p': { width: '1280', height: '720' },
      '1080p': { width: '1080', height: '1080' }
    };
    const { width, height } = resolutionMap[resolution] || resolutionMap['1080p'];
    
    const soraEndpoint = process.env.AZURE_SORA_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
    const soraApiKey = process.env.AZURE_SORA_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    
    try {
      // Sora video generation API - Create job
      const createRes = await fetch(`${soraEndpoint}/openai/v1/video/generations/jobs?api-version=preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-key': soraApiKey!
        },
        body: JSON.stringify({
          model: 'sora',
          prompt: enhanced,
          height: height,
          width: width,
          n_seconds: duration,
          n_variants: '1'
        })
      });
      
      if (!createRes.ok) {
        const error = await createRes.text();
        return {
          content: [{ type: 'text', text: `Sora API error: ${createRes.status} - ${error}` }]
        };
      }
      
      const job = await createRes.json() as any;
      const jobId = job.id;
      
      // Poll for completion (video generation takes time)
      let generationId = null;
      let attempts = 0;
      const maxAttempts = 120; // 10 minutes max wait (video gen is slow)
      
      while (!generationId && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        
        const statusRes = await fetch(`${soraEndpoint}/openai/v1/video/generations/jobs/${jobId}?api-version=preview`, {
          headers: { 'Api-key': soraApiKey! }
        });
        
        const status = await statusRes.json() as any;
        
        if (status.status === 'succeeded' || status.status === 'completed') {
          generationId = status.generations?.[0]?.id;
        } else if (status.status === 'failed') {
          return {
            content: [{ type: 'text', text: `Video generation failed: ${status.failure_reason || JSON.stringify(status)}` }]
          };
        }
        attempts++;
      }
      
      if (!generationId) {
        return {
          content: [{ type: 'text', text: `Video generation timed out after ${maxAttempts * 5}s. Job ID: ${jobId} - Check Azure portal.` }]
        };
      }
      
      // Download video using the correct endpoint
      const videoRes = await fetch(`${soraEndpoint}/openai/v1/video/generations/${generationId}/content/video?api-version=preview`, {
        headers: { 'Api-key': soraApiKey! }
      });
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
      const filename = `video_${style}_${Date.now()}.mp4`;
      const filepath = path.join(videoDir, filename);
      fs.writeFileSync(filepath, videoBuffer);
      
      return {
        content: [{ type: 'text', text: `Generated ${duration}s ${style} video: ${filename} (saved to ${filepath})` }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Video generation error: ${error.message}` }]
      };
    }
  }
);

// 📝 Story Generation Tool
server.tool(
  'generate_story',
  'Generate game story, dialogue, level design, or character backgrounds',
  { 
    type: z.enum(['plot', 'dialogue', 'level', 'character']).describe('Type of story content'),
    prompt: z.string().describe('Description of what to generate'),
    context: z.string().optional().describe('Additional game context')
  },
  async ({ type, prompt, context }) => {
    const systemPrompts: Record<string, string> = {
      plot: 'You are a game narrative designer. Create compelling game plots with clear story arcs, conflicts, and resolutions. Output in structured format.',
      dialogue: 'You are a game dialogue writer. Write natural, engaging character dialogues. Include speaker names and emotional cues.',
      level: 'You are a level designer. Describe level layouts, objectives, enemies, secrets, and progression. Be specific about game mechanics.',
      character: 'You are a character designer. Create detailed character backstories, motivations, abilities, and personality traits.'
    };
    
    const systemContent = systemPrompts[type] || systemPrompts['story'];
    const res = await gptClient.chat.completions.create({
      model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: context ? `Context: ${context}\n\nRequest: ${prompt}` : prompt }
      ],
      
      max_completion_tokens: 2000
    });
    
    const content = res.choices[0]?.message?.content || 'No content generated';
    const filename = `${type}_${Date.now()}.md`;
    const filepath = path.join(assetsDir, filename);
    fs.writeFileSync(filepath, `# ${type.toUpperCase()}\n\n${content}`);
    
    return {
      content: [{ type: 'text', text: `Generated ${type}:\n\n${content}\n\n(saved to ${filepath})` }]
    };
  }
);

// 💻 Flame Game Code Generation Tool
server.tool(
  'generate_game_code',
  'Generate Flutter/Flame engine game code - components, systems, screens, or full game',
  { 
    type: z.enum(['component', 'system', 'screen', 'full', 'player', 'enemy', 'collectible', 'level', 'hud']).describe('Type of Flame code to generate'),
    prompt: z.string().describe('Description of the game code needed'),
    sprites: z.array(z.string()).optional().describe('List of sprite filenames to use')
  },
  async ({ type, prompt, sprites }) => {
    const flameSystemPrompt = `You are an expert Flutter Flame game engine developer. Generate production-ready Dart code for Flame games.

FLAME ENGINE RULES:
- Use Flame 1.18+ patterns and APIs
- Extend proper base classes: FlameGame, SpriteComponent, PositionComponent, etc.
- Use mixins: HasCollisionDetection, HasKeyboardHandlerComponents, TapCallbacks, etc.
- Implement proper game loop: update(dt), render(canvas)
- Use Vector2 for positions and sizes
- Load assets in onLoad() async method
- Use CollisionCallbacks for collision detection
- Use JoystickComponent or HardwareKeyboardDetector for input
- Add proper hitboxes: RectangleHitbox, CircleHitbox, PolygonHitbox

CODE STRUCTURE:
- Always include all necessary imports from 'package:flame/...'
- Add 'package:flutter/material.dart' when needed
- Include 'package:flutter/services.dart' for keyboard input
- Separate game logic from rendering
- Use async/await for asset loading

COMPONENT HIERARCHY:
- FlameGame (main game class)
  ├── Player extends SpriteAnimationComponent with KeyboardHandler, CollisionCallbacks
  ├── Enemy extends SpriteComponent with CollisionCallbacks  
  ├── Level extends Component (manages tiles/world)
  ├── HudComponent extends PositionComponent
  └── GameOverlay (Flutter widgets over game)

${sprites ? `\nAVAILABLE SPRITES: ${sprites.join(', ')}` : ''}

Generate complete, working code with helpful comments.`;

    const typePrompts: Record<string, string> = {
      component: `Generate a reusable Flame Component: ${prompt}`,
      system: `Generate a Flame game system/manager: ${prompt}`,
      screen: `Generate a Flame game screen with routing: ${prompt}`,
      full: `Generate a complete Flame game structure with main.dart, game class, and basic components: ${prompt}`,
      player: `Generate a Flame Player component with movement, animations, collision, and input handling: ${prompt}`,
      enemy: `Generate a Flame Enemy component with AI behavior, patrol/chase patterns, and collision: ${prompt}`,
      collectible: `Generate a Flame Collectible component (coins, powerups) with animations and pickup logic: ${prompt}`,
      level: `Generate a Flame Level/World component with tile loading and camera setup: ${prompt}`,
      hud: `Generate a Flame HUD component showing score, health, etc: ${prompt}`
    };

    const userContent = typePrompts[type] || prompt;
    const res = await gptClient.chat.completions.create({
      model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
      messages: [
        { role: 'system', content: flameSystemPrompt },
        { role: 'user', content: userContent }
      ],
      
      max_completion_tokens: 4000
    });
    
    const content = res.choices[0]?.message?.content || 'No code generated';
    const filename = `${type}_${Date.now()}.dart`;
    const filepath = path.join(assetsDir, filename);
    
    // Extract code from markdown if present
    const codeMatch = content.match(/```dart\n([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1] : content;
    fs.writeFileSync(filepath, code);
    
    return {
      content: [{ type: 'text', text: `Generated ${type} code:\n\n${content}\n\n(saved to ${filepath})` }]
    };
  }
);

// 🎤 Voice Generation Tool
server.tool(
  'generate_voice',
  'Generate character voice audio using Azure Speech',
  { 
    text: z.string().describe('Text to speak'),
    voice: z.enum(['en-US-JennyNeural', 'en-US-GuyNeural', 'en-US-AriaNeural', 'en-US-DavisNeural', 'en-US-JaneNeural', 'en-US-JasonNeural']).optional().describe('Voice to use'),
    style: z.enum(['neutral', 'cheerful', 'sad', 'angry', 'excited', 'friendly', 'terrified', 'shouting', 'whispering']).optional().describe('Speaking style')
  },
  async ({ text, voice = 'en-US-JennyNeural', style = 'neutral' }) => {
    if (!speechConfig) {
      return { content: [{ type: 'text', text: 'Azure Speech not configured. Add AZURE_SPEECH_KEY to .env' }] };
    }
    
    const filename = `voice_${Date.now()}.wav`;
    const filepath = path.join(audioDir, filename);
    
    const audioConfig = sdk.AudioConfig.fromAudioFileOutput(filepath);
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);
    
    // Use SSML for style control
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
      <voice name="${voice}">
        <mstts:express-as style="${style}">
          ${text}
        </mstts:express-as>
      </voice>
    </speak>`;
    
    return new Promise((resolve) => {
      synthesizer.speakSsmlAsync(ssml,
        (result) => {
          synthesizer.close();
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve({ content: [{ type: 'text', text: `Generated voice audio: ${filepath}` }] });
          } else {
            resolve({ content: [{ type: 'text', text: `Voice generation failed: ${result.errorDetails}` }] });
          }
        },
        (error) => {
          synthesizer.close();
          resolve({ content: [{ type: 'text', text: `Voice generation error: ${error}` }] });
        }
      );
    });
  }
);

// 🔊 Sound Effect Generation Tool
server.tool(
  'generate_sfx',
  'Generate game sound effects using Azure Speech SSML',
  { 
    type: z.enum(['jump', 'hit', 'coin', 'powerup', 'explosion', 'laser', 'menu', 'custom']).describe('Type of sound effect'),
    customSsml: z.string().optional().describe('Custom SSML for advanced sound design')
  },
  async ({ type, customSsml }) => {
    if (!speechConfig) {
      return { content: [{ type: 'text', text: 'Azure Speech not configured. Add AZURE_SPEECH_KEY to .env' }] };
    }
    
    const filename = `sfx_${type}_${Date.now()}.wav`;
    const filepath = path.join(audioDir, filename);
    
    // Predefined SSML patterns for game sounds
    const sfxPatterns: Record<string, string> = {
      jump: '<prosody pitch="+50%" rate="fast">boing</prosody>',
      hit: '<prosody pitch="-20%" rate="fast">thud</prosody>',
      coin: '<prosody pitch="+80%" rate="fast">ding</prosody>',
      powerup: '<prosody pitch="+30%" rate="slow"><emphasis level="strong">woosh</emphasis></prosody>',
      explosion: '<prosody pitch="-50%" rate="slow" volume="loud">boom</prosody>',
      laser: '<prosody pitch="+100%" rate="x-fast">pew pew</prosody>',
      menu: '<prosody pitch="+20%" rate="medium">click</prosody>',
      custom: ''
    };
    
    const audioConfig = sdk.AudioConfig.fromAudioFileOutput(filepath);
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);
    
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
      <voice name="en-US-JennyNeural">
        ${customSsml || sfxPatterns[type]}
      </voice>
    </speak>`;
    
    return new Promise((resolve) => {
      synthesizer.speakSsmlAsync(ssml,
        (result) => {
          synthesizer.close();
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve({ content: [{ type: 'text', text: `Generated SFX: ${filepath}` }] });
          } else {
            resolve({ content: [{ type: 'text', text: `SFX generation failed: ${result.errorDetails}` }] });
          }
        },
        (error) => {
          synthesizer.close();
          resolve({ content: [{ type: 'text', text: `SFX generation error: ${error}` }] });
        }
      );
    });
  }
);

// 🎮 Game Package Orchestrator Tool
server.tool(
  'create_game_package',
  'Create a complete game asset package with sprites, story, code, audio, and video from a single prompt',
  { 
    concept: z.string().describe('Game concept description (e.g., "cyberpunk robot platformer")'),
    characterName: z.string().describe('Main character name'),
    includeVideo: z.boolean().optional().describe('Include cinematic trailer (slower, ~2 min)'),
    artStyle: z.enum(['pixel-art', 'cartoon', 'realistic', 'anime', 'low-poly']).optional().describe('Art style for all assets')
  },
  async ({ concept, characterName, includeVideo = false, artStyle = 'pixel-art' }) => {
    const packageId = `game_${Date.now()}`;
    const packageDir = path.join(__dirname, 'packages', packageId);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'sprites'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'audio'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'code'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'story'), { recursive: true });
    if (includeVideo) fs.mkdirSync(path.join(packageDir, 'video'), { recursive: true });
    
    const results: string[] = [];
    results.push(`🎮 Creating game package: ${concept}`);
    results.push(`📁 Package ID: ${packageId}\n`);
    
    const soraEndpoint = process.env.AZURE_SORA_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
    const soraApiKey = process.env.AZURE_SORA_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    
    // 1. Generate Character Sprite
    results.push('🎨 Generating character sprite...');
    try {
      const stylePrompts: Record<string, string> = {
        'pixel-art': '16-bit pixel art game sprite, retro style, clean pixels',
        'cartoon': 'cartoon game character, cel-shaded, vibrant colors',
        'realistic': 'realistic game asset, detailed textures, PBR-ready',
        'anime': 'anime style game character, clean lines, expressive',
        'low-poly': 'low-poly 3D style, geometric shapes, minimal details'
      };
      const spritePrompt = `${stylePrompts[artStyle]}: ${characterName} from ${concept}, game-ready asset, solid white background, centered, complete object, no cutoff, professional quality`;
      const spriteRes = await imageClient.images.generate({ prompt: spritePrompt, n: 1, size: '1024x1024' });
      const spriteUrl = spriteRes.data[0].url!;
      const spriteBuffer = Buffer.from(await (await fetch(spriteUrl)).arrayBuffer());
      const spritePath = path.join(packageDir, 'sprites', `${characterName.toLowerCase().replace(/\s+/g, '_')}.png`);
      await sharp(spriteBuffer).png().toFile(spritePath);
      results.push(`  ✅ Character sprite saved: sprites/${characterName.toLowerCase().replace(/\s+/g, '_')}.png`);
    } catch (e: any) {
      results.push(`  ❌ Sprite failed: ${e.message}`);
    }
    
    // 2. Generate Background
    results.push('🎨 Generating background...');
    try {
      const bgPrompt = `game background for ${concept}, ${artStyle} style, wide landscape, no characters, atmospheric, game-ready`;
      const bgRes = await imageClient.images.generate({ prompt: bgPrompt, n: 1, size: '1792x1024' });
      const bgUrl = bgRes.data[0].url!;
      const bgBuffer = Buffer.from(await (await fetch(bgUrl)).arrayBuffer());
      await sharp(bgBuffer).png().toFile(path.join(packageDir, 'sprites', 'background.png'));
      results.push('  ✅ Background saved: sprites/background.png');
    } catch (e: any) {
      results.push(`  ❌ Background failed: ${e.message}`);
    }
    
    // 3. Generate Story
    results.push('📝 Generating game story...');
    try {
      const storyRes = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a game narrative designer. Create a compelling game story with plot, character background, and 3 level descriptions.' },
          { role: 'user', content: `Create a complete story for: ${concept}. Main character: ${characterName}. Include: 1) Plot summary, 2) Character backstory, 3) Three level descriptions with objectives.` }
        ],
        
        max_completion_tokens: 2000
      });
      const story = storyRes.choices[0].message.content || '';
      fs.writeFileSync(path.join(packageDir, 'story', 'game_story.md'), `# ${concept}\n\n${story}`);
      results.push('  ✅ Story saved: story/game_story.md');
    } catch (e: any) {
      results.push(`  ❌ Story failed: ${e.message}`);
    }
    
    // 4. Generate Flame Game Code
    results.push('💻 Generating Flame game code...');
    const spriteFile = `${characterName.toLowerCase().replace(/\s+/g, '_')}.png`;
    const flamePrompt = `You are an expert Flutter Flame game engine developer.

Generate a COMPLETE Flame game project structure for: ${concept}
Character: ${characterName}
Sprite file: ${spriteFile}

Generate these files with FULL code:

1. main.dart - App entry with GameWidget
2. game.dart - Main FlameGame class with HasCollisionDetection, HasKeyboardHandlerComponents
3. player.dart - Player component with:
   - SpriteComponent or SpriteAnimationComponent
   - KeyboardHandler mixin for WASD/Arrow movement
   - CollisionCallbacks mixin
   - Jump with gravity
   - RectangleHitbox
4. level.dart - Simple level with ground/platforms
5. hud.dart - Score/health display

Use Flame 1.18+ APIs:
- Vector2 for positions
- async onLoad() for asset loading
- update(double dt) for game logic
- CollisionCallbacks for collisions
- KeyboardHandler for input

Include all imports from package:flame/...`;

    try {
      const codeRes = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are an expert Flutter/Flame game engine developer. Generate complete, production-ready Dart code. Output each file with a clear filename header like "// === FILE: main.dart ===" followed by the complete code.' },
          { role: 'user', content: flamePrompt }
        ],
        
        max_completion_tokens: 6000
      });
      const code = codeRes.choices[0].message.content || '';
      
      // Parse multiple files from response
      const fileMatches = code.matchAll(/\/\/\s*={3,}\s*FILE:\s*(\S+\.dart)\s*={3,}[\r\n]+([\s\S]*?)(?=\/\/\s*={3,}\s*FILE:|```|$)/gi);
      const dartBlockMatches = code.matchAll(/```dart\n([\s\S]*?)```/g);
      
      let filesWritten = 0;
      
      // Try to extract named files first
      for (const match of fileMatches) {
        const fileName = match[1].trim();
        const fileCode = match[2].trim();
        if (fileCode.length > 50) {
          fs.writeFileSync(path.join(packageDir, 'code', fileName), fileCode);
          filesWritten++;
        }
      }
      
      // If no named files found, extract dart code blocks
      if (filesWritten === 0) {
        const codeBlocks = [...dartBlockMatches];
        const fileNames = ['main.dart', 'game.dart', 'player.dart', 'level.dart', 'hud.dart'];
        codeBlocks.forEach((match, i) => {
          const fileName = fileNames[i] || `component_${i}.dart`;
          fs.writeFileSync(path.join(packageDir, 'code', fileName), match[1]);
          filesWritten++;
        });
      }
      
      // If still nothing, save raw
      if (filesWritten === 0) {
        fs.writeFileSync(path.join(packageDir, 'code', 'game.dart'), code);
        filesWritten = 1;
      }
      
      const codeFiles = fs.readdirSync(path.join(packageDir, 'code'));
      results.push(`  ✅ Flame code saved: ${codeFiles.join(', ')}`);
    } catch (e: any) {
      results.push(`  ❌ Code failed: ${e.message}`);
    }
    
    // 5. Generate Voice Line
    results.push('🎤 Generating voice intro...');
    if (speechConfig) {
      try {
        const voicePath = path.join(packageDir, 'audio', 'intro_voice.wav');
        const audioConfig = sdk.AudioConfig.fromAudioFileOutput(voicePath);
        const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);
        const introText = `Welcome to ${concept}! I am ${characterName}, and your adventure begins now!`;
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
          <voice name="en-US-GuyNeural"><mstts:express-as style="excited">${introText}</mstts:express-as></voice>
        </speak>`;
        await new Promise<void>((resolve) => {
          synthesizer.speakSsmlAsync(ssml, () => { synthesizer.close(); resolve(); }, () => { synthesizer.close(); resolve(); });
        });
        results.push('  ✅ Voice intro saved: audio/intro_voice.wav');
      } catch (e: any) {
        results.push(`  ❌ Voice failed: ${e.message}`);
      }
    } else {
      results.push('  ⏭️ Voice skipped (Azure Speech not configured)');
    }
    
    // 6. Generate SFX
    results.push('🔊 Generating sound effects...');
    if (speechConfig) {
      const sfxTypes = [
        { name: 'jump', ssml: '<prosody pitch="+50%" rate="fast">boing</prosody>' },
        { name: 'coin', ssml: '<prosody pitch="+80%" rate="fast">ding</prosody>' },
        { name: 'hit', ssml: '<prosody pitch="-20%" rate="fast">thud</prosody>' }
      ];
      for (const sfx of sfxTypes) {
        try {
          const sfxPath = path.join(packageDir, 'audio', `${sfx.name}.wav`);
          const audioConfig = sdk.AudioConfig.fromAudioFileOutput(sfxPath);
          const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);
          const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="en-US-JennyNeural">${sfx.ssml}</voice></speak>`;
          await new Promise<void>((resolve) => {
            synthesizer.speakSsmlAsync(ssml, () => { synthesizer.close(); resolve(); }, () => { synthesizer.close(); resolve(); });
          });
        } catch {}
      }
      results.push('  ✅ SFX saved: audio/jump.wav, coin.wav, hit.wav');
    } else {
      results.push('  ⏭️ SFX skipped (Azure Speech not configured)');
    }
    
    // 7. Generate Video Trailer (optional)
    if (includeVideo && soraApiKey) {
      results.push('🎬 Generating cinematic trailer (this takes ~2 minutes)...');
      try {
        const videoPrompt = `Cinematic game trailer for ${concept}, featuring ${characterName}, dramatic camera movements, ${artStyle} style, high quality game footage`;
        const createRes = await fetch(`${soraEndpoint}/openai/v1/video/generations/jobs?api-version=preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Api-key': soraApiKey },
          body: JSON.stringify({ model: 'sora', prompt: videoPrompt, height: '1080', width: '1920', n_seconds: '10', n_variants: '1' })
        });
        
        if (createRes.ok) {
          const job = await createRes.json() as any;
          let generationId = null;
          for (let i = 0; i < 60; i++) { // Wait up to 5 min
            await new Promise(r => setTimeout(r, 5000));
            const statusRes = await fetch(`${soraEndpoint}/openai/v1/video/generations/jobs/${job.id}?api-version=preview`, {
              headers: { 'Api-key': soraApiKey }
            });
            const status = await statusRes.json() as any;
            if (status.status === 'succeeded') { generationId = status.generations?.[0]?.id; break; }
            if (status.status === 'failed') break;
          }
          if (generationId) {
            const videoRes = await fetch(`${soraEndpoint}/openai/v1/video/generations/${generationId}/content/video?api-version=preview`, {
              headers: { 'Api-key': soraApiKey }
            });
            const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
            fs.writeFileSync(path.join(packageDir, 'video', 'trailer.mp4'), videoBuffer);
            results.push('  ✅ Trailer saved: video/trailer.mp4');
          } else {
            results.push('  ❌ Video generation timed out');
          }
        }
      } catch (e: any) {
        results.push(`  ❌ Video failed: ${e.message}`);
      }
    } else if (includeVideo) {
      results.push('  ⏭️ Video skipped (Sora not configured)');
    }
    
    // Summary
    results.push('\n' + '═'.repeat(50));
    results.push(`✅ Game package complete: packages/${packageId}`);
    results.push('═'.repeat(50));
    
    const files = {
      sprites: fs.readdirSync(path.join(packageDir, 'sprites')),
      audio: fs.readdirSync(path.join(packageDir, 'audio')),
      code: fs.readdirSync(path.join(packageDir, 'code')),
      story: fs.readdirSync(path.join(packageDir, 'story')),
      video: includeVideo && fs.existsSync(path.join(packageDir, 'video')) ? fs.readdirSync(path.join(packageDir, 'video')) : []
    };
    
    results.push(`\n📦 Package Contents:`);
    results.push(`  🎨 Sprites: ${files.sprites.join(', ')}`);
    results.push(`  🎵 Audio: ${files.audio.join(', ')}`);
    results.push(`  💻 Code: ${files.code.join(', ')}`);
    results.push(`  📝 Story: ${files.story.join(', ')}`);
    if (files.video.length) results.push(`  🎬 Video: ${files.video.join(', ')}`);
    
    return { content: [{ type: 'text', text: results.join('\n') }] };
  }
);

// 🧮 Physics Calculator Tool
server.tool(
  'calculate_physics',
  'Calculate physics values for desired game behavior (jump heights, speeds, gravity)',
  {
    jumpHeight: z.number().optional().describe('Desired jump height in pixels'),
    jumpDuration: z.number().optional().describe('Desired time in air (seconds)'),
    platformGap: z.number().optional().describe('Horizontal gap between platforms in pixels'),
    screenWidth: z.number().optional().describe('Game screen width (default 800)'),
    screenHeight: z.number().optional().describe('Game screen height (default 600)'),
    gameStyle: z.enum(['mario', 'celeste', 'hollow-knight', 'megaman', 'custom']).optional().describe('Preset game feel style')
  },
  async ({ jumpHeight, jumpDuration, platformGap, screenWidth = 800, screenHeight = 600, gameStyle }) => {
    // Preset physics for different game styles
    const presets: Record<string, { gravity: number; jumpVelocity: number; moveSpeed: number; airControl: number; description: string }> = {
      'mario': { gravity: 1200, jumpVelocity: 500, moveSpeed: 200, airControl: 0.8, description: 'Floaty, forgiving jumps with good air control' },
      'celeste': { gravity: 900, jumpVelocity: 420, moveSpeed: 250, airControl: 1.0, description: 'Precise, responsive movement with dash mechanics' },
      'hollow-knight': { gravity: 1500, jumpVelocity: 550, moveSpeed: 180, airControl: 0.6, description: 'Weighty, deliberate movement with double jump' },
      'megaman': { gravity: 1800, jumpVelocity: 600, moveSpeed: 160, airControl: 0.3, description: 'Snappy, committed jumps with minimal air control' },
      'custom': { gravity: 980, jumpVelocity: 400, moveSpeed: 200, airControl: 0.7, description: 'Balanced default values' }
    };

    let result: any = {};
    
    // If game style selected, use preset
    if (gameStyle && gameStyle !== 'custom') {
      const preset = presets[gameStyle];
      result = {
        preset: gameStyle,
        description: preset.description,
        physics: {
          gravity: preset.gravity,
          jumpVelocity: preset.jumpVelocity,
          moveSpeed: preset.moveSpeed,
          airControl: preset.airControl
        },
        calculated: {
          maxJumpHeight: Math.round((preset.jumpVelocity * preset.jumpVelocity) / (2 * preset.gravity)),
          jumpDuration: (2 * preset.jumpVelocity / preset.gravity).toFixed(2) + 's',
          maxHorizontalDistance: Math.round(preset.moveSpeed * (2 * preset.jumpVelocity / preset.gravity))
        }
      };
    } else if (jumpHeight && jumpDuration) {
      // Calculate from desired height and duration
      // Physics: h = v₀t - ½gt², at peak: v₀ = gt_peak, t_peak = duration/2
      const tPeak = jumpDuration / 2;
      const gravity = (2 * jumpHeight) / (tPeak * tPeak);
      const jumpVelocity = gravity * tPeak;
      
      result = {
        input: { jumpHeight, jumpDuration },
        physics: {
          gravity: Math.round(gravity),
          jumpVelocity: Math.round(jumpVelocity),
          recommendedMoveSpeed: Math.round(jumpHeight * 2), // Heuristic
          airControl: 0.7
        },
        platformRecommendations: {
          maxVerticalGap: Math.round(jumpHeight * 0.85),
          maxHorizontalGap: Math.round(jumpHeight * 2.5),
          recommendedTileSize: Math.round(jumpHeight / 3),
          safePatformWidth: Math.round(jumpHeight / 2)
        }
      };
    } else if (jumpHeight) {
      // Calculate assuming 0.5s jump duration (comfortable default)
      const tPeak = 0.25;
      const gravity = (2 * jumpHeight) / (tPeak * tPeak);
      const jumpVelocity = gravity * tPeak;
      
      result = {
        input: { jumpHeight, assumedDuration: '0.5s' },
        physics: {
          gravity: Math.round(gravity),
          jumpVelocity: Math.round(jumpVelocity)
        }
      };
    } else if (platformGap) {
      // Calculate minimum speed to cross gap
      const assumedAirTime = 0.6;
      const minSpeed = platformGap / assumedAirTime;
      
      result = {
        input: { platformGap },
        required: {
          minimumMoveSpeed: Math.round(minSpeed),
          recommendedMoveSpeed: Math.round(minSpeed * 1.2),
          assumedJumpDuration: assumedAirTime + 's'
        }
      };
    } else {
      // Return all presets for reference
      result = {
        message: 'Provide jumpHeight, jumpDuration, platformGap, or gameStyle to calculate physics',
        presets: Object.entries(presets).map(([name, p]) => ({
          name,
          ...p,
          maxJumpHeight: Math.round((p.jumpVelocity * p.jumpVelocity) / (2 * p.gravity))
        }))
      };
    }

    // Add Flame/Dart code snippet
    if (result.physics) {
      result.flameCode = `
// Flame Physics Constants
class GamePhysics {
  static const double gravity = ${result.physics.gravity};
  static const double jumpVelocity = ${result.physics.jumpVelocity};
  static const double moveSpeed = ${result.physics.moveSpeed || 200};
  static const double airControl = ${result.physics.airControl || 0.7};
}

// Usage in Player component:
// velocity.y += GamePhysics.gravity * dt;
// if (jumping) velocity.y = -GamePhysics.jumpVelocity;
// velocity.x = direction * GamePhysics.moveSpeed * (isGrounded ? 1.0 : GamePhysics.airControl);
`;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  }
);

// 👁️ Visual Analysis Tool (GPT-4 Vision)
server.tool(
  'analyze_game_screenshot',
  'Analyze a game screenshot using GPT-4 Vision to suggest improvements',
  {
    imagePath: z.string().describe('Absolute path to the game screenshot'),
    analysisType: z.enum(['general', 'level-design', 'ui-ux', 'visual-polish', 'player-experience']).optional().describe('Focus area for analysis'),
    context: z.string().optional().describe('Additional context about the game')
  },
  async ({ imagePath, analysisType = 'general', context }) => {
    if (!fs.existsSync(imagePath)) {
      return { content: [{ type: 'text', text: `Error: Image not found at ${imagePath}` }] };
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const analysisPrompts: Record<string, string> = {
      'general': `Analyze this game screenshot comprehensively:
1. Visual Quality: Art style consistency, color palette, readability
2. Level Design: Platform placement, enemy positions, collectibles
3. UI/HUD: Health bars, score display, clarity
4. Player Experience: Can you tell where to go? Is it confusing?
5. Technical Issues: Clipping, alignment, z-ordering problems
6. Specific Suggestions: List 3-5 actionable improvements`,

      'level-design': `Analyze the LEVEL DESIGN in this game screenshot:
1. Platform Spacing: Are gaps jumpable? Too easy/hard?
2. Vertical Flow: Good use of height variation?
3. Enemy Placement: Fair challenge or frustrating?
4. Secrets/Collectibles: Interesting placement?
5. Visual Guidance: Does the level guide the player?
6. Pacing: Good rhythm of challenges and rest areas?
Suggest specific changes with pixel estimates where possible.`,

      'ui-ux': `Analyze the UI/UX in this game screenshot:
1. HUD Clarity: Is health/score/ammo easy to read?
2. Visual Hierarchy: Most important info stands out?
3. Screen Space: HUD blocking gameplay?
4. Consistency: Matching art style with game?
5. Feedback: Are interactive elements clear?
6. Accessibility: Good contrast, readable fonts?`,

      'visual-polish': `Analyze the VISUAL POLISH in this game screenshot:
1. Art Consistency: Same style throughout?
2. Color Harmony: Palette working well?
3. Particle Effects: Needed? Overdone?
4. Lighting/Shadows: Enhancing depth?
5. Animation Frames: Visible issues?
6. Background Layers: Good parallax/depth?`,

      'player-experience': `Analyze PLAYER EXPERIENCE from this game screenshot:
1. Clarity: Where should player go next?
2. Difficulty Read: Does it look fair or frustrating?
3. Emotional Response: Exciting? Calming? Tense?
4. Learning Curve: Good tutorial elements visible?
5. Reward Visibility: Are goals/collectibles enticing?
6. Death Fairness: Can player see hazards in time?`
    };

    try {
      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert game designer and visual analyst. Provide specific, actionable feedback on game screenshots. When suggesting position changes, give approximate pixel values. Be constructive but thorough.'
          },
          {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: `${context ? `Game Context: ${context}\n\n` : ''}${analysisPrompts[analysisType]}` 
              },
              { 
                type: 'image_url', 
                image_url: { 
                  url: `data:${mimeType};base64,${base64}`,
                  detail: 'high'
                } 
              }
            ]
          }
        ],
        max_tokens: 2000
      });

      const analysis = response.choices[0].message.content;
      
      // Save analysis to file
      const analysisFile = path.join(assetsDir, `analysis_${Date.now()}.md`);
      fs.writeFileSync(analysisFile, `# Game Screenshot Analysis\n\n**Type:** ${analysisType}\n**Image:** ${imagePath}\n\n${analysis}`);

      return {
        content: [{ type: 'text', text: `## 🎮 Game Analysis (${analysisType})\n\n${analysis}\n\n---\n📄 Saved to: ${analysisFile}` }]
      };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Vision analysis error: ${error.message}` }] };
    }
  }
);

// 🗺️ Level Generator Tool
server.tool(
  'generate_level',
  'Generate a game level based on difficulty curve and design parameters',
  {
    levelType: z.enum(['platformer', 'topdown', 'endless-runner', 'metroidvania']).describe('Type of level to generate'),
    difficulty: z.enum(['tutorial', 'easy', 'medium', 'hard', 'expert']).describe('Difficulty level'),
    length: z.enum(['short', 'medium', 'long']).optional().describe('Level length'),
    theme: z.string().optional().describe('Visual theme (e.g., "forest", "cave", "castle")'),
    mechanics: z.array(z.string()).optional().describe('Game mechanics to include (e.g., ["double-jump", "wall-slide"])'),
    width: z.number().optional().describe('Level width in tiles'),
    height: z.number().optional().describe('Level height in tiles'),
    tileSize: z.number().optional().describe('Tile size in pixels (default 32)')
  },
  async ({ levelType, difficulty, length = 'medium', theme = 'default', mechanics = [], width, height, tileSize = 32 }) => {
    // Difficulty presets
    const difficultySettings: Record<string, any> = {
      'tutorial': { enemyDensity: 0.05, gapDifficulty: 0.3, secretDensity: 0.1, hazardDensity: 0 },
      'easy': { enemyDensity: 0.1, gapDifficulty: 0.5, secretDensity: 0.15, hazardDensity: 0.05 },
      'medium': { enemyDensity: 0.15, gapDifficulty: 0.7, secretDensity: 0.1, hazardDensity: 0.1 },
      'hard': { enemyDensity: 0.2, gapDifficulty: 0.85, secretDensity: 0.08, hazardDensity: 0.15 },
      'expert': { enemyDensity: 0.25, gapDifficulty: 1.0, secretDensity: 0.05, hazardDensity: 0.2 }
    };

    const lengthSettings: Record<string, { width: number; height: number }> = {
      'short': { width: 40, height: 15 },
      'medium': { width: 80, height: 20 },
      'long': { width: 150, height: 25 }
    };

    const levelWidth = width || lengthSettings[length].width;
    const levelHeight = height || lengthSettings[length].height;
    const settings = difficultySettings[difficulty];

    const prompt = `Generate a ${levelType} game level with these specifications:

DIMENSIONS:
- Width: ${levelWidth} tiles
- Height: ${levelHeight} tiles  
- Tile size: ${tileSize}px

DIFFICULTY: ${difficulty}
- Enemy density: ${(settings.enemyDensity * 100).toFixed(0)}%
- Gap difficulty: ${(settings.gapDifficulty * 100).toFixed(0)}%
- Hazard density: ${(settings.hazardDensity * 100).toFixed(0)}%

THEME: ${theme}
MECHANICS: ${mechanics.length > 0 ? mechanics.join(', ') : 'basic movement and jumping'}

OUTPUT FORMAT - Generate a JSON level structure:
{
  "metadata": {
    "name": "Level Name",
    "width": ${levelWidth},
    "height": ${levelHeight},
    "tileSize": ${tileSize},
    "theme": "${theme}",
    "difficulty": "${difficulty}",
    "estimatedTime": "X seconds"
  },
  "playerSpawn": { "x": number, "y": number },
  "levelExit": { "x": number, "y": number },
  "platforms": [
    { "x": number, "y": number, "width": number, "type": "solid|moving|crumbling" }
  ],
  "enemies": [
    { "x": number, "y": number, "type": "walker|jumper|flyer|shooter", "patrol": { "left": number, "right": number } }
  ],
  "collectibles": [
    { "x": number, "y": number, "type": "coin|gem|powerup", "value": number }
  ],
  "hazards": [
    { "x": number, "y": number, "width": number, "type": "spikes|lava|pit" }
  ],
  "checkpoints": [
    { "x": number, "y": number }
  ],
  "secrets": [
    { "x": number, "y": number, "reward": "coins|health|powerup" }
  ],
  "designNotes": "Explanation of level flow and intended experience"
}

Create a well-paced level with:
1. Clear start and goal
2. Gradually increasing challenge
3. Fair placement (player can always see hazards before committing)
4. Rest areas between difficult sections
5. Visual landmarks for navigation
6. Secrets that reward exploration`;

    try {
      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert level designer. Generate levels that are fun, fair, and well-paced. Always output valid JSON.' 
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4000
      });

      let levelData = response.choices[0].message.content || '';
      
      // Extract JSON from response
      const jsonMatch = levelData.match(/```json\n?([\s\S]*?)```/) || levelData.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        levelData = jsonMatch[1] || jsonMatch[0];
      }

      // Parse and validate
      let parsedLevel;
      try {
        parsedLevel = JSON.parse(levelData);
      } catch {
        parsedLevel = { raw: levelData, error: 'Could not parse as JSON' };
      }

      // Save level file
      const levelFile = path.join(assetsDir, `level_${levelType}_${difficulty}_${Date.now()}.json`);
      fs.writeFileSync(levelFile, JSON.stringify(parsedLevel, null, 2));

      // Generate Flame/Dart loader code
      const loaderCode = `
// Flame Level Loader for: ${parsedLevel.metadata?.name || 'Generated Level'}
import 'dart:convert';
import 'package:flame/components.dart';
import 'package:flutter/services.dart';

class LevelData {
  final Map<String, dynamic> data;
  
  LevelData(this.data);
  
  Vector2 get playerSpawn => Vector2(
    (data['playerSpawn']['x'] as num).toDouble() * ${tileSize},
    (data['playerSpawn']['y'] as num).toDouble() * ${tileSize},
  );
  
  Vector2 get levelExit => Vector2(
    (data['levelExit']['x'] as num).toDouble() * ${tileSize},
    (data['levelExit']['y'] as num).toDouble() * ${tileSize},
  );
  
  List<PlatformData> get platforms => (data['platforms'] as List)
    .map((p) => PlatformData(
      position: Vector2((p['x'] as num).toDouble() * ${tileSize}, (p['y'] as num).toDouble() * ${tileSize}),
      width: (p['width'] as num).toDouble() * ${tileSize},
      type: p['type'] as String,
    ))
    .toList();
    
  List<EnemyData> get enemies => (data['enemies'] as List)
    .map((e) => EnemyData(
      position: Vector2((e['x'] as num).toDouble() * ${tileSize}, (e['y'] as num).toDouble() * ${tileSize}),
      type: e['type'] as String,
    ))
    .toList();
}

class PlatformData {
  final Vector2 position;
  final double width;
  final String type;
  PlatformData({required this.position, required this.width, required this.type});
}

class EnemyData {
  final Vector2 position;
  final String type;
  EnemyData({required this.position, required this.type});
}

// Load level:
// final jsonString = await rootBundle.loadString('assets/levels/level1.json');
// final levelData = LevelData(json.decode(jsonString));
`;

      const loaderFile = path.join(assetsDir, `level_loader_${Date.now()}.dart`);
      fs.writeFileSync(loaderFile, loaderCode);

      return {
        content: [{ 
          type: 'text', 
          text: `## 🗺️ Generated ${difficulty} ${levelType} Level

**Theme:** ${theme}
**Size:** ${levelWidth}×${levelHeight} tiles (${levelWidth * tileSize}×${levelHeight * tileSize} pixels)

### Level Summary:
- Platforms: ${parsedLevel.platforms?.length || '?'}
- Enemies: ${parsedLevel.enemies?.length || '?'}
- Collectibles: ${parsedLevel.collectibles?.length || '?'}
- Checkpoints: ${parsedLevel.checkpoints?.length || '?'}
- Secrets: ${parsedLevel.secrets?.length || '?'}

### Design Notes:
${parsedLevel.designNotes || 'See JSON file for details'}

### Files Generated:
📄 Level JSON: ${levelFile}
📄 Dart Loader: ${loaderFile}

\`\`\`json
${JSON.stringify(parsedLevel.metadata || {}, null, 2)}
\`\`\`
` 
        }]
      };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Level generation error: ${error.message}` }] };
    }
  }
);

// 🎯 Playtesting Simulator Tool
server.tool(
  'simulate_playtest',
  'Simulate a playtest to verify level is completable and analyze difficulty',
  {
    levelPath: z.string().optional().describe('Path to level JSON file'),
    levelData: z.any().optional().describe('Direct level data object'),
    playerPhysics: z.object({
      jumpHeight: z.number().optional(),
      moveSpeed: z.number().optional(),
      gravity: z.number().optional()
    }).optional().describe('Player physics parameters'),
    simulationType: z.enum(['pathfinding', 'difficulty', 'full']).optional().describe('Type of simulation')
  },
  async ({ levelPath, levelData, playerPhysics, simulationType = 'full' }) => {
    // Load level data
    let level: any;
    if (levelPath && fs.existsSync(levelPath)) {
      level = JSON.parse(fs.readFileSync(levelPath, 'utf-8'));
    } else if (levelData) {
      level = levelData;
    } else {
      return { content: [{ type: 'text', text: 'Error: Provide either levelPath or levelData' }] };
    }

    // Default physics
    const physics = {
      jumpHeight: playerPhysics?.jumpHeight || 96,
      moveSpeed: playerPhysics?.moveSpeed || 200,
      gravity: playerPhysics?.gravity || 980
    };

    // Calculate derived values
    const maxJumpHeight = physics.jumpHeight;
    const jumpDuration = Math.sqrt(2 * maxJumpHeight / physics.gravity) * 2;
    const maxHorizontalJump = physics.moveSpeed * jumpDuration;

    const results: any = {
      levelInfo: level.metadata || { width: '?', height: '?' },
      physics: physics,
      derived: {
        maxJumpHeight: Math.round(maxJumpHeight),
        jumpDuration: jumpDuration.toFixed(2) + 's',
        maxHorizontalJump: Math.round(maxHorizontalJump)
      },
      analysis: {
        pathfinding: { reachable: true, issues: [] as string[] },
        difficulty: { score: 0, breakdown: {} as Record<string, number> },
        timing: { estimatedSeconds: 0 },
        fairness: { issues: [] as string[], score: 100 }
      }
    };

    // Pathfinding Analysis
    if (level.platforms && level.playerSpawn && level.levelExit) {
      const platforms = level.platforms.sort((a: any, b: any) => a.x - b.x);
      const tileSize = level.metadata?.tileSize || 32;
      
      let currentPos = { x: level.playerSpawn.x, y: level.playerSpawn.y };
      let pathIssues: string[] = [];
      
      for (let i = 0; i < platforms.length - 1; i++) {
        const current = platforms[i];
        const next = platforms[i + 1];
        
        const dx = (next.x - (current.x + (current.width || 1))) * tileSize;
        const dy = (next.y - current.y) * tileSize;
        
        // Check horizontal gap
        if (dx > maxHorizontalJump) {
          pathIssues.push(`Gap between platform ${i} and ${i+1} is ${dx}px, max jump is ${Math.round(maxHorizontalJump)}px`);
          results.analysis.pathfinding.reachable = false;
        }
        
        // Check vertical gap (can only jump up, not teleport)
        if (dy < -maxJumpHeight) { // Negative because y goes down
          pathIssues.push(`Platform ${i+1} is ${Math.abs(dy)}px above, max jump height is ${Math.round(maxJumpHeight)}px`);
          results.analysis.pathfinding.reachable = false;
        }
      }
      
      results.analysis.pathfinding.issues = pathIssues;
    }

    // Difficulty Analysis
    let difficultyScore = 0;
    const breakdown: Record<string, number> = {};

    // Count enemies
    if (level.enemies) {
      breakdown.enemies = level.enemies.length * 5;
      difficultyScore += breakdown.enemies;
    }

    // Count hazards
    if (level.hazards) {
      breakdown.hazards = level.hazards.length * 8;
      difficultyScore += breakdown.hazards;
    }

    // Platform difficulty (moving/crumbling platforms)
    if (level.platforms) {
      const hardPlatforms = level.platforms.filter((p: any) => p.type !== 'solid').length;
      breakdown.hardPlatforms = hardPlatforms * 10;
      difficultyScore += breakdown.hardPlatforms;
    }

    // Gap analysis
    if (level.platforms && level.platforms.length > 1) {
      const tileSize = level.metadata?.tileSize || 32;
      let totalGapDifficulty = 0;
      
      for (let i = 0; i < level.platforms.length - 1; i++) {
        const dx = Math.abs(level.platforms[i + 1].x - level.platforms[i].x) * tileSize;
        const gapRatio = dx / maxHorizontalJump;
        totalGapDifficulty += Math.pow(gapRatio, 2) * 10;
      }
      
      breakdown.gaps = Math.round(totalGapDifficulty);
      difficultyScore += breakdown.gaps;
    }

    results.analysis.difficulty.score = Math.round(difficultyScore);
    results.analysis.difficulty.breakdown = breakdown;
    results.analysis.difficulty.rating = 
      difficultyScore < 20 ? 'Tutorial' :
      difficultyScore < 50 ? 'Easy' :
      difficultyScore < 100 ? 'Medium' :
      difficultyScore < 200 ? 'Hard' : 'Expert';

    // Timing Estimate
    const levelWidth = (level.metadata?.width || 50) * (level.metadata?.tileSize || 32);
    const baseTime = levelWidth / physics.moveSpeed;
    const enemyTime = (level.enemies?.length || 0) * 2;
    const platformTime = (level.platforms?.filter((p: any) => p.type !== 'solid').length || 0) * 3;
    
    results.analysis.timing.estimatedSeconds = Math.round(baseTime + enemyTime + platformTime);
    results.analysis.timing.speedrunEstimate = Math.round(baseTime * 0.7);

    // Fairness Analysis
    const fairnessIssues: string[] = [];
    let fairnessScore = 100;

    // Check for blind jumps
    if (level.hazards && level.platforms) {
      for (const hazard of level.hazards) {
        const abovePlatform = level.platforms.find((p: any) => 
          Math.abs(p.x - hazard.x) < 3 && p.y < hazard.y
        );
        if (abovePlatform) {
          fairnessIssues.push(`Hazard at (${hazard.x}, ${hazard.y}) may be a blind drop`);
          fairnessScore -= 10;
        }
      }
    }

    // Check checkpoint spacing
    if (level.checkpoints && level.checkpoints.length > 0) {
      const avgSpacing = (level.metadata?.width || 50) / (level.checkpoints.length + 1);
      if (avgSpacing > 30) {
        fairnessIssues.push(`Checkpoints are far apart (avg ${Math.round(avgSpacing)} tiles). Consider adding more.`);
        fairnessScore -= 5;
      }
    } else {
      fairnessIssues.push('No checkpoints found. Long levels should have checkpoints.');
      fairnessScore -= 15;
    }

    results.analysis.fairness.issues = fairnessIssues;
    results.analysis.fairness.score = Math.max(0, fairnessScore);

    // Generate summary
    const summary = `
## 🎯 Playtest Simulation Results

### ✅ Pathfinding
- **Completable:** ${results.analysis.pathfinding.reachable ? '✓ Yes' : '✗ No'}
${results.analysis.pathfinding.issues.length > 0 ? results.analysis.pathfinding.issues.map((i: string) => `- ⚠️ ${i}`).join('\n') : '- All platforms reachable'}

### 📊 Difficulty Analysis
- **Score:** ${results.analysis.difficulty.score} (${results.analysis.difficulty.rating})
- **Breakdown:**
${Object.entries(breakdown).map(([k, v]) => `  - ${k}: +${v}`).join('\n')}

### ⏱️ Timing
- **Estimated Completion:** ${results.analysis.timing.estimatedSeconds} seconds
- **Speedrun Potential:** ${results.analysis.timing.speedrunEstimate} seconds

### ⚖️ Fairness
- **Score:** ${results.analysis.fairness.score}/100
${results.analysis.fairness.issues.length > 0 ? results.analysis.fairness.issues.map((i: string) => `- ⚠️ ${i}`).join('\n') : '- No fairness issues detected'}

### 🔧 Recommendations
${!results.analysis.pathfinding.reachable ? '1. **CRITICAL:** Fix unreachable platforms before testing\n' : ''}${results.analysis.difficulty.rating === 'Expert' ? '2. Consider adding easier alternative paths\n' : ''}${results.analysis.fairness.score < 80 ? '3. Address fairness issues for better player experience\n' : ''}${results.analysis.timing.estimatedSeconds > 180 ? '4. Level is long - ensure adequate checkpoints\n' : ''}
`;

    return {
      content: [{ type: 'text', text: summary }]
    };
  }
);

// 📋 List Assets Tool
server.tool(
  'list_game_assets',
  'List all generated game assets (images, audio, video, code, story)',
  {},
  async () => {
    const images = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter(f => f.endsWith('.png')) : [];
    const audio = fs.existsSync(audioDir) ? fs.readdirSync(audioDir) : [];
    const videos = fs.existsSync(videoDir) ? fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4')) : [];
    const code = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter(f => f.endsWith('.dart')) : [];
    const stories = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter(f => f.endsWith('.md')) : [];
    const packages = fs.existsSync(path.join(__dirname, 'packages')) ? fs.readdirSync(path.join(__dirname, 'packages')) : [];
    
    return {
      content: [{ 
        type: 'text', 
        text: `📁 Game Assets:\n\n🎮 Packages (${packages.length}):\n${packages.map(f => `  - ${f}`).join('\n') || '  (none)'}\n\n🎨 Images (${images.length}):\n${images.map(f => `  - ${f}`).join('\n') || '  (none)'}\n\n🎬 Videos (${videos.length}):\n${videos.map(f => `  - ${f}`).join('\n') || '  (none)'}\n\n🎵 Audio (${audio.length}):\n${audio.map(f => `  - ${f}`).join('\n') || '  (none)'}\n\n💻 Code (${code.length}):\n${code.map(f => `  - ${f}`).join('\n') || '  (none)'}\n\n📝 Stories (${stories.length}):\n${stories.map(f => `  - ${f}`).join('\n') || '  (none)'}` 
      }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
