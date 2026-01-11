#!/usr/bin/env node
/**
 * Unity MCP Server v2.0
 * Unity 6 (6000.0+) Game Engine tools powered by Azure AI
 * Generates C# scripts for Unity development
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { gptClient, rootDir } from '../../shared/azure-clients.js';
import { 
  extractCSharp, 
  extractMultipleFiles,
  saveFile, 
  ensureDir, 
  textResponse, 
  errorResponse,
  generateId 
} from '../../shared/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(rootDir, 'output', 'unity');
const scriptsDir = ensureDir(path.join(outputDir, 'scripts'));
const editorsDir = ensureDir(path.join(outputDir, 'editor'));

const server = new McpServer({
  name: 'unity-mcp',
  version: '2.0.0',
  description: 'Unity 6 MCP Server - C# Script Generation'
});

// ==========================================
// UNITY 6 SYSTEM PROMPT
// ==========================================

const UNITY_SYSTEM_PROMPT = `You are an expert Unity developer. Generate production-ready C# code for Unity 6 (version 6000.0+).

UNITY 6 BEST PRACTICES:

1. MONOBEHAVIOUR STRUCTURE:
\`\`\`csharp
using UnityEngine;
using UnityEngine.InputSystem; // New Input System

public class MyComponent : MonoBehaviour
{
    [Header("Settings")]
    [SerializeField] private float _speed = 5f;
    [SerializeField, Tooltip("Target to follow")] private Transform _target;
    
    private Rigidbody _rb;
    
    private void Awake()
    {
        // Cache components
        _rb = GetComponent<Rigidbody>();
    }
    
    private void Start()
    {
        // Initialization that depends on other objects
    }
    
    private void Update()
    {
        // Per-frame logic
    }
    
    private void FixedUpdate()
    {
        // Physics updates
    }
}
\`\`\`

2. NEW INPUT SYSTEM (Default in Unity 6):
\`\`\`csharp
using UnityEngine;
using UnityEngine.InputSystem;

public class PlayerController : MonoBehaviour
{
    private PlayerInput _playerInput;
    private InputAction _moveAction;
    private InputAction _jumpAction;
    
    private void Awake()
    {
        _playerInput = GetComponent<PlayerInput>();
        _moveAction = _playerInput.actions["Move"];
        _jumpAction = _playerInput.actions["Jump"];
    }
    
    private void Update()
    {
        Vector2 moveInput = _moveAction.ReadValue<Vector2>();
        // Use moveInput.x and moveInput.y
    }
    
    // Or use callbacks:
    public void OnMove(InputValue value)
    {
        Vector2 movement = value.Get<Vector2>();
    }
}
\`\`\`

3. AWAITABLE (Unity 6+ async/await):
\`\`\`csharp
using UnityEngine;

public class AsyncExample : MonoBehaviour
{
    private async void Start()
    {
        await DoSomethingAsync();
    }
    
    private async Awaitable DoSomethingAsync()
    {
        await Awaitable.WaitForSecondsAsync(1f);
        Debug.Log("One second passed");
        
        // Wait for next frame
        await Awaitable.NextFrameAsync();
        
        // Wait for fixed update
        await Awaitable.FixedUpdateAsync();
    }
}
\`\`\`

4. SCRIPTABLE OBJECTS:
\`\`\`csharp
using UnityEngine;

[CreateAssetMenu(fileName = "NewItem", menuName = "Game/Item Data")]
public class ItemData : ScriptableObject
{
    public string itemName;
    public Sprite icon;
    public int value;
    [TextArea] public string description;
}
\`\`\`

5. EDITOR SCRIPTS:
\`\`\`csharp
#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;

[CustomEditor(typeof(MyComponent))]
public class MyComponentEditor : Editor
{
    public override void OnInspectorGUI()
    {
        DrawDefaultInspector();
        
        MyComponent comp = (MyComponent)target;
        if (GUILayout.Button("Do Something"))
        {
            comp.DoSomething();
        }
    }
}
#endif
\`\`\`

NAMING CONVENTIONS:
- PascalCase: Classes, methods, properties, public fields
- _camelCase: Private fields with underscore prefix
- camelCase: Parameters and local variables
- UPPER_CASE: Constants

ATTRIBUTES TO USE:
- [SerializeField] - Expose private fields in inspector
- [Header("Section")] - Organize inspector
- [Tooltip("Description")] - Add hover tooltips
- [Range(min, max)] - Slider in inspector
- [RequireComponent(typeof(T))] - Auto-add dependencies

Always include proper using statements and follow Unity 6 conventions.`;

// ==========================================
// TOOL: Generate Unity Script
// ==========================================

server.tool(
  'generate_unity_script',
  'Generate Unity C# script',
  {
    type: z.enum([
      'monobehaviour', 'scriptable-object', 'player', 'enemy', 'camera',
      'manager', 'ui', 'inventory', 'save-system', 'audio', 'pooler',
      'state-machine', 'dialogue', 'quest', 'editor'
    ]).describe('Script type'),
    description: z.string().describe('What the script should do'),
    useNewInputSystem: z.boolean().optional().describe('Use new Input System'),
    useAwaitable: z.boolean().optional().describe('Use Unity 6 Awaitable async')
  },
  async ({ type, description, useNewInputSystem = true, useAwaitable = false }) => {
    try {
      const typeContext: Record<string, string> = {
        'monobehaviour': 'Standard MonoBehaviour component',
        'scriptable-object': 'ScriptableObject for data storage with CreateAssetMenu',
        'player': 'Player controller with movement, input, and animations',
        'enemy': 'Enemy AI with state machine (Idle, Patrol, Chase, Attack)',
        'camera': 'Camera controller (follow, orbit, or cinematic)',
        'manager': 'Singleton manager for game systems',
        'ui': 'UI manager with screen transitions',
        'inventory': 'Inventory system with ScriptableObject items',
        'save-system': 'Save/Load system with JSON serialization',
        'audio': 'Audio manager with pooling and categories',
        'pooler': 'Object pooler with expandable pools',
        'state-machine': 'Generic state machine pattern',
        'dialogue': 'Dialogue system with ScriptableObject conversations',
        'quest': 'Quest/objective tracking system',
        'editor': 'Custom Editor script or EditorWindow'
      };

      const prompt = `Generate Unity 6 C# script: ${typeContext[type]}

DESCRIPTION: ${description}

OPTIONS:
- Use New Input System: ${useNewInputSystem}
- Use Awaitable (async): ${useAwaitable}

Requirements:
- Complete, compilable C# code
- Proper Unity 6 conventions
- All necessary using statements
- Helpful comments
${type === 'editor' ? '- Include #if UNITY_EDITOR preprocessor' : ''}`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: UNITY_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 5000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractCSharp(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```csharp\n?/gi, '').replace(/```cs\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('using')) {
        return errorResponse('Failed to generate valid C# code. Please try again.');
      }

      const dir = type === 'editor' ? editorsDir : scriptsDir;
      const filename = `${type.replace(/-/g, '_')}_${generateId()}.cs`;
      const filepath = saveFile(code, filename, dir);

      return textResponse(`✅ Generated Unity ${type} script

\`\`\`csharp
${code}
\`\`\`

📁 **Saved to:** ${filepath}

Copy to your Unity project's Assets/Scripts folder.`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate Player Controller
// ==========================================

server.tool(
  'generate_player_controller',
  'Generate complete player controller',
  {
    movementType: z.enum(['platformer-2d', 'platformer-3d', 'topdown-2d', 'topdown-3d', 'first-person', 'third-person']).describe('Movement type'),
    features: z.array(z.enum([
      'jump', 'double-jump', 'dash', 'crouch', 'sprint', 'wall-jump',
      'attack', 'shoot', 'health', 'stamina', 'animation'
    ])).optional().describe('Player features'),
    physicsType: z.enum(['rigidbody', 'character-controller', 'kinematic']).optional().describe('Physics approach')
  },
  async ({ movementType, features = ['jump', 'animation'], physicsType = 'rigidbody' }) => {
    try {
      const prompt = `Generate Unity player controller:

MOVEMENT TYPE: ${movementType}
PHYSICS: ${physicsType}
FEATURES: ${features.join(', ')}

Requirements:
- Use New Input System with PlayerInput component
- ${physicsType === 'rigidbody' ? 'Use Rigidbody/Rigidbody2D with velocity-based movement' : ''}
- ${physicsType === 'character-controller' ? 'Use CharacterController with Move()' : ''}
- Implement all specified features
- Add proper ground detection
- Include animation trigger calls where appropriate
- Use [RequireComponent] for dependencies
- Cache all component references`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: UNITY_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 5000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractCSharp(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```csharp\n?/gi, '').replace(/```cs\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('using')) {
        return errorResponse('Failed to generate player controller.');
      }

      const filename = `player_${movementType.replace(/-/g, '_')}_${generateId()}.cs`;
      const filepath = saveFile(code, filename, scriptsDir);

      return textResponse(`✅ Generated ${movementType} player (${physicsType})

Features: ${features.join(', ')}

\`\`\`csharp
${code}
\`\`\`

📁 **Saved to:** ${filepath}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate Enemy AI
// ==========================================

server.tool(
  'generate_enemy_ai',
  'Generate enemy AI with state machine',
  {
    aiType: z.enum(['patrol', 'chase', 'ranged', 'boss', 'flying', 'turret']).describe('AI behavior type'),
    description: z.string().describe('Enemy description'),
    states: z.array(z.string()).optional().describe('Custom states to include')
  },
  async ({ aiType, description, states = ['Idle', 'Patrol', 'Chase', 'Attack'] }) => {
    try {
      const prompt = `Generate Unity enemy AI:

AI TYPE: ${aiType}
DESCRIPTION: ${description}
STATES: ${states.join(', ')}

Requirements:
- Implement state machine pattern
- Include NavMeshAgent for pathfinding (3D) or simple movement (2D)
- Add detection system (raycast or trigger collider)
- Implement each state with proper transitions
- Add attack logic with damage dealing
- Include health and death handling
- Use events for external communication`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: UNITY_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 5000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractCSharp(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```csharp\n?/gi, '').replace(/```cs\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('using')) {
        return errorResponse('Failed to generate enemy AI.');
      }

      const filename = `enemy_${aiType}_${generateId()}.cs`;
      const filepath = saveFile(code, filename, scriptsDir);

      return textResponse(`✅ Generated ${aiType} enemy AI

States: ${states.join(' → ')}

\`\`\`csharp
${code}
\`\`\`

📁 **Saved to:** ${filepath}`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate ScriptableObject
// ==========================================

server.tool(
  'generate_scriptable_object',
  'Generate ScriptableObject for data storage',
  {
    dataType: z.enum(['item', 'character', 'weapon', 'ability', 'quest', 'dialogue', 'level', 'config', 'custom']).describe('Data type'),
    description: z.string().describe('What data to store'),
    fields: z.array(z.string()).optional().describe('Field names to include')
  },
  async ({ dataType, description, fields }) => {
    try {
      const prompt = `Generate Unity ScriptableObject:

DATA TYPE: ${dataType}
DESCRIPTION: ${description}
${fields ? `FIELDS: ${fields.join(', ')}` : 'Include appropriate fields for this data type'}

Requirements:
- Use [CreateAssetMenu] attribute with proper menu path
- Include all relevant data fields
- Add [SerializeField] for private fields
- Use [Header] to organize sections
- Add [Tooltip] for complex fields
- Include validation methods if needed`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: UNITY_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 3000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractCSharp(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```csharp\n?/gi, '').replace(/```cs\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('ScriptableObject')) {
        return errorResponse('Failed to generate ScriptableObject.');
      }

      const filename = `${dataType}_data_${generateId()}.cs`;
      const filepath = saveFile(code, filename, scriptsDir);

      return textResponse(`✅ Generated ${dataType} ScriptableObject

\`\`\`csharp
${code}
\`\`\`

📁 **Saved to:** ${filepath}

Create assets: Right-click in Project → Create → [Your Menu Path]`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: Generate Editor Script
// ==========================================

server.tool(
  'generate_editor_script',
  'Generate custom Editor or EditorWindow',
  {
    editorType: z.enum(['custom-inspector', 'editor-window', 'property-drawer', 'menu-item', 'wizard']).describe('Editor type'),
    description: z.string().describe('What the editor should do'),
    targetClass: z.string().optional().describe('Target class for custom inspector')
  },
  async ({ editorType, description, targetClass }) => {
    try {
      const prompt = `Generate Unity Editor script:

TYPE: ${editorType}
DESCRIPTION: ${description}
${targetClass ? `TARGET CLASS: ${targetClass}` : ''}

Requirements:
- Include #if UNITY_EDITOR / #endif preprocessor
- Place in Editor folder convention
- Use EditorGUILayout for UI
- Include proper undo support with Undo.RecordObject
- Add SerializedProperty for safe data access
- Handle null cases gracefully`;

      const response = await gptClient.chat.completions.create({
        model: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
        messages: [
          { role: 'system', content: UNITY_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 4000,
        temperature: 0.7
      });

      const content = response.choices[0].message.content || '';
      let code = extractCSharp(content);
      
      if (!code || code.length < 50) {
        code = content.replace(/```csharp\n?/gi, '').replace(/```cs\n?/gi, '').replace(/```\n?/g, '').trim();
      }
      
      if (!code || !code.includes('UnityEditor')) {
        return errorResponse('Failed to generate editor script.');
      }

      const filename = `${editorType.replace(/-/g, '_')}_${generateId()}.cs`;
      const filepath = saveFile(code, filename, editorsDir);

      return textResponse(`✅ Generated ${editorType} editor script

\`\`\`csharp
${code}
\`\`\`

📁 **Saved to:** ${filepath}

Place in Assets/Editor/ folder in your Unity project.`);

    } catch (error: any) {
      return errorResponse(error);
    }
  }
);

// ==========================================
// TOOL: List Generated Scripts
// ==========================================

server.tool(
  'list_unity_scripts',
  'List all generated Unity scripts',
  {},
  async () => {
    try {
      const scripts = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.cs'));
      const editors = fs.readdirSync(editorsDir).filter(f => f.endsWith('.cs'));
      
      if (scripts.length === 0 && editors.length === 0) {
        return textResponse('No Unity scripts generated yet.');
      }

      let output = '📁 Generated Unity Scripts:\n\n';
      
      if (scripts.length > 0) {
        output += '**Scripts:**\n' + scripts.map(f => `- ${f}`).join('\n') + '\n\n';
      }
      
      if (editors.length > 0) {
        output += '**Editor Scripts:**\n' + editors.map(f => `- ${f}`).join('\n');
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
  console.error('Unity MCP Server v2.0 running');
}

main().catch(console.error);
