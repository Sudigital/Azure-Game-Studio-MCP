// Common types shared across all MCP servers

export type ArtStyle = 'pixel-art' | 'cartoon' | 'realistic' | 'anime' | 'low-poly';
export type VideoStyle = 'cinematic' | 'anime' | 'pixel-art' | 'realistic' | '3d-render';
export type ImageSize = '1024x1024' | '1792x1024' | '1024x1792';
export type VideoResolution = '480p' | '720p' | '1080p';
export type VideoDuration = '5' | '10' | '15' | '20';

export type StoryType = 'plot' | 'dialogue' | 'level' | 'character';
export type LevelType = 'platformer' | 'topdown' | 'endless-runner' | 'metroidvania';
export type Difficulty = 'tutorial' | 'easy' | 'medium' | 'hard' | 'expert';
export type LevelLength = 'short' | 'medium' | 'long';

export type VoiceName = 'en-US-JennyNeural' | 'en-US-GuyNeural' | 'en-US-AriaNeural' | 'en-US-DavisNeural' | 'en-US-JaneNeural' | 'en-US-JasonNeural';
export type VoiceStyle = 'neutral' | 'cheerful' | 'sad' | 'angry' | 'excited' | 'friendly' | 'terrified' | 'shouting' | 'whispering';
export type SfxType = 'jump' | 'hit' | 'coin' | 'powerup' | 'explosion' | 'laser' | 'menu' | 'custom';

// Game physics presets
export interface PhysicsPreset {
  gravity: number;
  jumpVelocity: number;
  moveSpeed: number;
  airControl: number;
  description: string;
}

export const physicsPresets: Record<string, PhysicsPreset> = {
  'mario': { gravity: 1200, jumpVelocity: 500, moveSpeed: 200, airControl: 0.8, description: 'Floaty, forgiving jumps with good air control' },
  'celeste': { gravity: 900, jumpVelocity: 420, moveSpeed: 250, airControl: 1.0, description: 'Precise, responsive movement with dash mechanics' },
  'hollow-knight': { gravity: 1500, jumpVelocity: 550, moveSpeed: 180, airControl: 0.6, description: 'Weighty, deliberate movement with double jump' },
  'megaman': { gravity: 1800, jumpVelocity: 600, moveSpeed: 160, airControl: 0.3, description: 'Snappy, committed jumps with minimal air control' },
  'custom': { gravity: 980, jumpVelocity: 400, moveSpeed: 200, airControl: 0.7, description: 'Balanced default values' }
};

// Level data structures
export interface LevelMetadata {
  name: string;
  width: number;
  height: number;
  tileSize: number;
  theme: string;
  difficulty: string;
  estimatedTime: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface Platform {
  x: number;
  y: number;
  width: number;
  type: 'solid' | 'moving' | 'crumbling';
}

export interface Enemy {
  x: number;
  y: number;
  type: 'walker' | 'jumper' | 'flyer' | 'shooter';
  patrol?: { left: number; right: number };
}

export interface Collectible {
  x: number;
  y: number;
  type: 'coin' | 'gem' | 'powerup';
  value: number;
}

export interface Hazard {
  x: number;
  y: number;
  width: number;
  type: 'spikes' | 'lava' | 'pit';
}

export interface LevelData {
  metadata: LevelMetadata;
  playerSpawn: Position;
  levelExit: Position;
  platforms: Platform[];
  enemies: Enemy[];
  collectibles: Collectible[];
  hazards: Hazard[];
  checkpoints: Position[];
  secrets: Array<Position & { reward: string }>;
  designNotes: string;
}

// MCP Tool result type
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
}
