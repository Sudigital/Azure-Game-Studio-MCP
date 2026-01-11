import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { rootDir } from './azure-clients.js';

// ==========================================
// DIRECTORY MANAGEMENT
// ==========================================

export const assetsDir = path.join(rootDir, 'assets');
export const audioDir = path.join(rootDir, 'audio');
export const videoDir = path.join(rootDir, 'videos');
export const packagesDir = path.join(rootDir, 'packages');
export const outputDir = path.join(rootDir, 'output');

export function ensureDirectories() {
  [assetsDir, audioDir, videoDir, packagesDir, outputDir].forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
  });
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ==========================================
// FILE OPERATIONS
// ==========================================

export function saveFile(content: string, filename: string, dir: string): string {
  const filepath = path.join(dir, filename);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

export function readFile(filepath: string): string {
  return fs.readFileSync(filepath, 'utf-8');
}

export function fileExists(filepath: string): boolean {
  return fs.existsSync(filepath);
}

export function listFiles(dir: string, extension?: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  return extension ? files.filter(f => f.endsWith(extension)) : files;
}

// ==========================================
// IMAGE OPERATIONS
// ==========================================

export async function saveImage(buffer: Buffer, filename: string, dir: string = assetsDir): Promise<string> {
  ensureDir(dir);
  const filepath = path.join(dir, filename);
  await sharp(buffer).png().toFile(filepath);
  return filepath;
}

export async function fetchAndSaveImage(url: string, filename: string, dir: string = assetsDir): Promise<string> {
  const imgRes = await fetch(url);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return saveImage(buffer, filename, dir);
}

export async function imageToBase64(filepath: string): Promise<string> {
  const buffer = fs.readFileSync(filepath);
  return buffer.toString('base64');
}

// ==========================================
// CODE EXTRACTION - ROBUST MULTI-LANGUAGE
// ==========================================

/**
 * Extract code blocks from AI-generated markdown content
 * Handles various formats and edge cases
 */
export function extractCode(content: string, language?: string): string {
  if (!content || content.trim().length === 0) {
    return '';
  }

  // Pattern 1: Standard markdown code blocks with language
  const langPattern = language 
    ? new RegExp(`\`\`\`(?:${language})\\s*\\n([\\s\\S]*?)\`\`\``, 'gi')
    : /```(?:python|dart|csharp|cs|typescript|ts|javascript|js|json|yaml|xml|html|css|glsl|hlsl|gdscript)\s*\n([\s\S]*?)```/gi;
  
  const langMatches = [...content.matchAll(langPattern)];
  if (langMatches.length > 0) {
    return langMatches.map(m => m[1].trim()).join('\n\n');
  }

  // Pattern 2: Generic code blocks (no language specified)
  const genericPattern = /```\s*\n([\s\S]*?)```/gi;
  const genericMatches = [...content.matchAll(genericPattern)];
  if (genericMatches.length > 0) {
    return genericMatches.map(m => m[1].trim()).join('\n\n');
  }

  // Pattern 3: Code might not be in blocks - look for code indicators
  if (language === 'python' || language === 'py') {
    // Python detection: imports, def, class
    if (/^(?:import |from |def |class |#.*coding)/m.test(content)) {
      return cleanCodeContent(content);
    }
  }
  
  if (language === 'dart') {
    // Dart detection: imports, void main, class
    if (/^(?:import |void main|class |@override)/m.test(content)) {
      return cleanCodeContent(content);
    }
  }

  if (language === 'csharp' || language === 'cs') {
    // C# detection: using, namespace, public class
    if (/^(?:using |namespace |public class |private class |\[SerializeField\])/m.test(content)) {
      return cleanCodeContent(content);
    }
  }

  // Pattern 4: Return cleaned content as fallback (strip markdown artifacts)
  return cleanCodeContent(content);
}

/**
 * Clean code content by removing markdown artifacts
 */
function cleanCodeContent(content: string): string {
  return content
    // Remove markdown headers
    .replace(/^#{1,6}\s+.+$/gm, '')
    // Remove bold/italic markdown
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove markdown links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, '')
    // Trim excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract code for specific languages
 */
export function extractPython(content: string): string {
  return extractCode(content, 'python');
}

export function extractDart(content: string): string {
  return extractCode(content, 'dart');
}

export function extractCSharp(content: string): string {
  return extractCode(content, 'csharp') || extractCode(content, 'cs');
}

export function extractTypeScript(content: string): string {
  return extractCode(content, 'typescript') || extractCode(content, 'ts');
}

export function extractJSON(content: string): string {
  return extractCode(content, 'json');
}

/**
 * Extract multiple files from a single response
 * Looks for file markers like: // FILE: filename.ext or # FILE: filename.py
 */
export function extractMultipleFiles(content: string): Map<string, string> {
  const files = new Map<string, string>();
  
  // Pattern: // FILE: path/to/file.ext or # FILE: path/to/file.ext
  const filePattern = /(?:\/\/|#)\s*(?:FILE|FILENAME|Path):\s*([^\n]+)\n([\s\S]*?)(?=(?:\/\/|#)\s*(?:FILE|FILENAME|Path):|$)/gi;
  
  for (const match of content.matchAll(filePattern)) {
    const filename = match[1].trim();
    const code = extractCode(match[2]) || match[2].trim();
    if (filename && code.length > 10) {
      files.set(filename, code);
    }
  }

  // If no files found, try markdown headers as file separators
  if (files.size === 0) {
    const headerPattern = /^##\s*`?([^`\n]+\.(?:py|dart|cs|ts|js))`?\s*\n([\s\S]*?)(?=^##\s*`?[^`\n]+\.|$)/gim;
    for (const match of content.matchAll(headerPattern)) {
      const filename = match[1].trim();
      const code = extractCode(match[2]) || match[2].trim();
      if (filename && code.length > 10) {
        files.set(filename, code);
      }
    }
  }

  return files;
}

// ==========================================
// STYLE PROMPTS FOR ASSET GENERATION
// ==========================================

export const stylePrompts: Record<string, string> = {
  'pixel-art': '16-bit pixel art game sprite, retro style, clean pixels, transparent background',
  'cartoon': 'cartoon game character, cel-shaded, vibrant colors, clean edges',
  'realistic': 'realistic game asset, detailed textures, PBR-ready, high quality',
  'anime': 'anime style game character, clean lines, expressive, vibrant',
  'low-poly': 'low-poly 3D style, geometric shapes, minimal details, flat shading',
  'hand-drawn': 'hand-drawn illustration style, sketch-like, artistic',
  'voxel': 'voxel art style, 3D pixel art, cube-based, minecraft-like'
};

export const videoStylePrompts: Record<string, string> = {
  'cinematic': 'cinematic game trailer, dramatic lighting, professional camera movements',
  'anime': 'anime style animation, vibrant colors, expressive characters',
  'pixel-art': 'pixel art animation, retro game style, 16-bit aesthetic',
  'realistic': 'photorealistic game footage, high detail, realistic physics',
  '3d-render': '3D rendered game scene, smooth animation, modern graphics'
};

export const resolutionMap: Record<string, { width: string; height: string }> = {
  '480p': { width: '854', height: '480' },
  '720p': { width: '1280', height: '720' },
  '1080p': { width: '1920', height: '1080' }
};

// ==========================================
// PACKAGE STRUCTURE
// ==========================================

export function createPackageStructure(packageId: string, includeVideo: boolean = false): string {
  const packageDir = path.join(packagesDir, packageId);
  const dirs = ['sprites', 'audio', 'code', 'story'];
  if (includeVideo) dirs.push('video');
  
  dirs.forEach(sub => {
    fs.mkdirSync(path.join(packageDir, sub), { recursive: true });
  });
  
  return packageDir;
}

// ==========================================
// RESPONSE FORMATTERS
// ==========================================

export interface ToolResponse {
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}

export function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }] };
}

export function errorResponse(error: string | Error): ToolResponse {
  const msg = error instanceof Error ? error.message : error;
  return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
}

export function successResponse(message: string, details?: Record<string, any>): ToolResponse {
  let text = `✅ ${message}`;
  if (details) {
    text += '\n\n' + Object.entries(details)
      .map(([k, v]) => `**${k}:** ${typeof v === 'object' ? JSON.stringify(v, null, 2) : v}`)
      .join('\n');
  }
  return { content: [{ type: 'text', text }] };
}

export function codeResponse(code: string, language: string, filepath?: string): ToolResponse {
  let text = `\`\`\`${language}\n${code}\n\`\`\``;
  if (filepath) {
    text += `\n\n📁 Saved to: ${filepath}`;
  }
  return { content: [{ type: 'text', text }] };
}

export async function imageResponse(filepath: string, caption?: string): Promise<ToolResponse> {
  const base64 = await imageToBase64(filepath);
  const content: ToolResponse['content'] = [
    { type: 'image', data: base64, mimeType: 'image/png' }
  ];
  if (caption) {
    content.push({ type: 'text', text: caption });
  }
  return { content };
}

// ==========================================
// VALIDATION HELPERS
// ==========================================

export function validateNotEmpty(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} cannot be empty`);
  }
  return value.trim();
}

export function validateEnum<T extends string>(value: string, allowed: T[], name: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

// ==========================================
// TIMESTAMP & ID GENERATION
// ==========================================

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function generateId(prefix: string = ''): string {
  return `${prefix}${prefix ? '_' : ''}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
