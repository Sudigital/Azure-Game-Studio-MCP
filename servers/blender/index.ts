#!/usr/bin/env node
/**
 * Blender MCP Server v2.0
 * 3D Modeling and Animation tools powered by Azure AI
 * Generates Python scripts for Blender 4.0+ / 5.x automation
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { gptClient, rootDir } from '../../shared/azure-clients.js';
import { 
  extractPython, 
  saveFile, 
  ensureDir, 
  textResponse, 
  errorResponse,
  generateId 
} from '../../shared/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(rootDir, 'output', 'blender');
const scriptsDir = ensureDir(path.join(outputDir, 'scripts'));
const modelsDir = ensureDir(path.join(outputDir, 'models'));

const server = new McpServer({
  name: 'blender-mcp',
  version: '2.0.0',
  description: 'Blender 5.x MCP Server - Python Script Generation'
});

// ==========================================
// BLENDER 5.x SYSTEM PROMPT
// ==========================================

const BLENDER_SYSTEM_PROMPT = `You are an expert Blender Python developer. Generate production-ready Python scripts for Blender 5.x (also compatible with 4.0+).

CRITICAL BLENDER 5.x API CHANGES (MUST FOLLOW):

1. NO CONTEXT OVERRIDE DICTS - Completely removed in Blender 4.0+
   WRONG: bpy.ops.object.mode_set({'object': obj}, mode='EDIT')
   CORRECT: 
   bpy.context.view_layer.objects.active = obj
   bpy.ops.object.mode_set(mode='EDIT')

2. NO use_auto_smooth - Removed in Blender 4.1+
   WRONG: mesh.use_auto_smooth = True
   WRONG: bpy.ops.object.shade_smooth(use_auto_smooth=True)
   CORRECT: 
   bpy.ops.object.shade_smooth()
   mod = obj.modifiers.new(name="Smooth by Angle", type='SMOOTH_BY_ANGLE')
   mod.angle = 0.523599  # 30 degrees

3. CORRECT OBJECT SELECTION:
   bpy.ops.object.select_all(action='DESELECT')
   obj.select_set(True)
   bpy.context.view_layer.objects.active = obj

4. CORRECT OBJECT JOINING:
   bpy.ops.object.select_all(action='DESELECT')
   for o in objects_to_join:
       o.select_set(True)
   bpy.context.view_layer.objects.active = target_object
   bpy.ops.object.join()

5. CORRECT MESH CREATION:
   mesh = bpy.data.meshes.new("MeshName")
   obj = bpy.data.objects.new("ObjectName", mesh)
   bpy.context.collection.objects.link(obj)
   bpy.context.view_layer.objects.active = obj
   obj.select_set(True)

6. USE BMESH FOR MESH MANIPULATION:
   import bmesh
   bm = bmesh.new()
   # ... create geometry
   bm.to_mesh(mesh)
   bm.free()  # Always free bmesh!

7. SCENE CLEANUP:
   bpy.ops.object.select_all(action='SELECT')
   bpy.ops.object.delete()

8. MATERIALS:
   mat = bpy.data.materials.new(name="MaterialName")
   mat.use_nodes = True
   nodes = mat.node_tree.nodes
   links = mat.node_tree.links
   # Clear default nodes
   nodes.clear()
   # Create nodes...
   obj.data.materials.append(mat)

ALWAYS:
- Import bpy at the top
- Import bmesh, mathutils as needed
- Handle errors with try/except
- Add comments explaining the code
- Ensure the script is complete and runnable
- DO NOT use any deprecated APIs`;

// ==========================================
// TOOL: Generate Blender Script
// ==========================================

server.tool(
  'generate_blender_script',
  'Generate Python script for any Blender task',
  {
    task: z.enum([
      'model', 'modifier', 'material', 'rig', 'animation',
      'uv', 'export', 'render', 'scene', 'particles', 'physics', 'custom'
    ]).describe('Type of Blender task'),
    description: z.string().describe('Detailed description of what the script should do'),
    complexity: z.enum(['simple', 'medium', 'complex']).optional().describe('Script complexity level')
  },
  async ({ task, description, complexity = 'medium' }) => {
    try {
      const taskContext: Record<string, string> = {
        model: 'Create 3D model geometry using bmesh or primitives',
        modifier: 'Set up and configure modifiers on objects',
        material: 'Create node-based materials and shaders',
        rig: 'Create armature and bone hierarchy for rigging',
        animation: 'Create keyframe animations and actions',
        uv: 'UV unwrap and configure UV maps',
        export: 'Export models to various formats (FBX, OBJ, glTF)',
        render: 'Configure render settings and output',
        scene: 'Set up scene, lighting, and camera',
        particles: 'Create and configure particle systems',
        physics: 'Set up physics simulation (rigid body, cloth, fluid)',
        custom: 'Custom Blender automation'
      };

      const prompt = `Create a ${complexity} Blender Python script for: ${taskContext[task]}

TASK DESCRIPTION: ${description}

Requirements:
- Script must be complete and runnable in Blender 5.x
- Follow all Blender 5.x API requirements (no deprecated code)
- Include helpful comments
- Handle potential errors gracefully`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: BLENDER_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 4000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      
      // Extract Python code with robust extraction
      let code = extractPython(content);
      
      // Validation: ensure we have actual Python code
      if (!code || code.length < 50) {
        // Try fallback extraction
        code = content
          .replace(/```python\n?/gi, '')
          .replace(/```\n?/g, '')
          .trim();
      }
      
      // Final validation
      if (!code || code.length < 50 || !code.includes('import bpy')) {
        return errorResponse('Failed to generate valid Blender script. Please try again with more specific description.');
      }

      const filename = `${task}_${generateId()}.py`;
      const filepath = saveFile(code, filename, scriptsDir);

      return textResponse(`✅ Generated Blender ${task} script

\`\`\`python
${code}
\`\`\`

📁 **Saved to:** ${filepath}

🎯 **Run in Blender:**
1. Open Blender
2. Go to Scripting workspace
3. Click "Open" → Select the file
4. Click "Run Script" or press Alt+P`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate 3D Model Script
// ==========================================

server.tool(
  'generate_3d_model',
  'Generate script to create a specific 3D model',
  {
    modelType: z.enum([
      'character', 'prop', 'vehicle', 'building', 'weapon',
      'creature', 'furniture', 'plant', 'rock', 'stylized'
    ]).describe('Type of 3D model'),
    description: z.string().describe('Detailed model description'),
    polyCount: z.enum(['low', 'medium', 'high']).optional().describe('Target polygon count'),
    gameReady: z.boolean().optional().describe('Optimize for game engines')
  },
  async ({ modelType, description, polyCount = 'medium', gameReady = true }) => {
    try {
      const polyGuide = {
        low: 'under 1,000 polygons (mobile games)',
        medium: '1,000-10,000 polygons (standard games)',
        high: '10,000+ polygons (AAA or film quality)'
      };

      const prompt = `Create a Blender Python script to generate a ${modelType} model:

MODEL: ${description}

SPECIFICATIONS:
- Polygon budget: ${polyGuide[polyCount]}
- Game-ready: ${gameReady ? 'Yes - clean topology, no n-gons, proper UVs' : 'No - artistic freedom'}
${gameReady ? `
GAME-READY REQUIREMENTS:
- Object origin at base center
- Apply all transforms (Ctrl+A)
- Single mesh if possible
- Correct face normals (blue = outward)
- Add basic UV coordinates
- Add placeholder material` : ''}

Create the model using bmesh and/or primitive operations. Include modifiers where appropriate (Subdivision, Mirror, Bevel, etc.).`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: BLENDER_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 5000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractPython(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```python\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('import bpy')) {
        return errorResponse('Failed to generate model script. Try a simpler model description.');
      }

      const filename = `model_${modelType}_${generateId()}.py`;
      const filepath = saveFile(code, filename, scriptsDir);

      return textResponse(`✅ Generated ${modelType} model script (${polyCount} poly, ${gameReady ? 'game-ready' : 'standard'})

\`\`\`python
${code}
\`\`\`

📁 **Saved to:** ${filepath}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate Character Rig
// ==========================================

server.tool(
  'generate_rig',
  'Generate character rigging script with armature and constraints',
  {
    rigType: z.enum(['humanoid', 'quadruped', 'bird', 'fish', 'mechanical', 'custom']).describe('Rig type'),
    features: z.array(z.enum([
      'ik_arms', 'ik_legs', 'spine_fk', 'spine_ik', 'fingers',
      'face', 'tail', 'wings', 'bendy_bones', 'twist_bones'
    ])).optional().describe('Rig features to include'),
    targetMesh: z.string().optional().describe('Name of existing mesh to rig')
  },
  async ({ rigType, features = ['ik_arms', 'ik_legs'], targetMesh }) => {
    try {
      const prompt = `Create a Blender Python script to generate a ${rigType} character rig:

FEATURES TO INCLUDE:
${features.map(f => `- ${f.replace(/_/g, ' ')}`).join('\n')}

${targetMesh ? `TARGET MESH: "${targetMesh}" (parent with automatic weights)` : 'Create a simple placeholder mesh'}

REQUIREMENTS:
- Create armature with proper bone hierarchy
- Add IK constraints where specified
- Set up bone groups with colors for organization
- Create custom shapes for control bones
- Use bone collections (Blender 4.0+ style)
- Add proper bone orientations`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: BLENDER_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 6000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractPython(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```python\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('import bpy')) {
        return errorResponse('Failed to generate rig script.');
      }

      const filename = `rig_${rigType}_${generateId()}.py`;
      const filepath = saveFile(code, filename, scriptsDir);

      return textResponse(`✅ Generated ${rigType} rig script

\`\`\`python
${code}
\`\`\`

📁 **Saved to:** ${filepath}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate Animation Script
// ==========================================

server.tool(
  'generate_animation',
  'Generate keyframe animation script',
  {
    animType: z.enum([
      'walk', 'run', 'idle', 'jump', 'attack', 'death',
      'camera', 'object', 'procedural', 'custom'
    ]).describe('Animation type'),
    description: z.string().describe('Animation description'),
    frames: z.number().optional().describe('Number of frames'),
    fps: z.number().optional().describe('Frames per second'),
    loop: z.boolean().optional().describe('Should animation loop seamlessly')
  },
  async ({ animType, description, frames = 24, fps = 24, loop = true }) => {
    try {
      const prompt = `Create a Blender Python script for a ${animType} animation:

DESCRIPTION: ${description}

SETTINGS:
- Total frames: ${frames}
- FPS: ${fps}
- Duration: ${(frames / fps).toFixed(2)} seconds
- Loop: ${loop ? 'Yes (first and last frame must match)' : 'No'}

REQUIREMENTS:
- Set scene frame range and FPS
- Create keyframes on appropriate channels
- Use Bezier interpolation with proper easing
- Add anticipation and follow-through
${loop ? '- Ensure seamless loop (copy first keyframe to last)' : ''}`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: BLENDER_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 4000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractPython(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```python\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('import bpy')) {
        return errorResponse('Failed to generate animation script.');
      }

      const filename = `anim_${animType}_${generateId()}.py`;
      const filepath = saveFile(code, filename, scriptsDir);

      return textResponse(`✅ Generated ${animType} animation (${frames} frames @ ${fps}fps)

\`\`\`python
${code}
\`\`\`

📁 **Saved to:** ${filepath}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate Material Script
// ==========================================

server.tool(
  'generate_material',
  'Generate node-based material/shader script',
  {
    materialType: z.enum([
      'pbr', 'toon', 'glass', 'metal', 'wood', 'fabric',
      'skin', 'water', 'emissive', 'procedural', 'custom'
    ]).describe('Material type'),
    description: z.string().describe('Material appearance description'),
    targetObject: z.string().optional().describe('Object name to apply material to')
  },
  async ({ materialType, description, targetObject }) => {
    try {
      const prompt = `Create a Blender Python script for a ${materialType} material:

DESCRIPTION: ${description}

${targetObject ? `APPLY TO: "${targetObject}"` : 'Create material only (user will apply manually)'}

REQUIREMENTS:
- Use node-based materials (use_nodes = True)
- Clear default nodes and build from scratch
- Create proper node connections
- Add color ramps and texture coordinates as needed
- Set up proper metallic/roughness for PBR
- Include comments explaining each node`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: BLENDER_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 4000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractPython(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```python\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('import bpy')) {
        return errorResponse('Failed to generate material script.');
      }

      const filename = `material_${materialType}_${generateId()}.py`;
      const filepath = saveFile(code, filename, scriptsDir);

      return textResponse(`✅ Generated ${materialType} material

\`\`\`python
${code}
\`\`\`

📁 **Saved to:** ${filepath}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: List Generated Scripts
// ==========================================

server.tool(
  'list_scripts',
  'List all generated Blender scripts',
  {},
  async () => {
    try {
      const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.py'));
      
      if (files.length === 0) {
        return textResponse('No scripts generated yet. Use generate_blender_script or other tools to create scripts.');
      }

      const fileList = files.map(f => {
        const stat = fs.statSync(path.join(scriptsDir, f));
        return `- ${f} (${(stat.size / 1024).toFixed(1)} KB)`;
      }).join('\n');

      return textResponse(`📁 Generated Blender Scripts:\n\n${fileList}\n\n**Directory:** ${scriptsDir}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Read Script
// ==========================================

server.tool(
  'read_script',
  'Read contents of a generated script',
  {
    filename: z.string().describe('Script filename to read')
  },
  async ({ filename }) => {
    try {
      const filepath = path.join(scriptsDir, filename);
      if (!fs.existsSync(filepath)) {
        return errorResponse(`Script not found: ${filename}`);
      }
      const content = fs.readFileSync(filepath, 'utf-8');
      return textResponse(`📄 ${filename}\n\n\`\`\`python\n${content}\n\`\`\``);
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
  console.error('Blender MCP Server v2.0 running');
}

main().catch(console.error);
