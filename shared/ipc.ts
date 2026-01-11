/**
 * Inter-Process Communication for MCP Servers
 * Enables server-to-server communication via file-based message passing
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IPC_DIR = path.join(__dirname, '..', '.ipc');

// Ensure IPC directory exists
fs.mkdirSync(IPC_DIR, { recursive: true });

export type ServerName = 'core' | 'flame' | 'unity' | 'blender' | 'figma';

export interface IPCMessage {
  id: string;
  from: ServerName;
  to: ServerName;
  action: string;
  payload: Record<string, any>;
  timestamp: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  response?: any;
}

/**
 * Send a message to another MCP server
 */
export async function sendToServer(
  from: ServerName,
  to: ServerName,
  action: string,
  payload: Record<string, any>
): Promise<string> {
  const message: IPCMessage = {
    id: `${from}-${to}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    from,
    to,
    action,
    payload,
    timestamp: Date.now(),
    status: 'pending'
  };
  
  const filepath = path.join(IPC_DIR, `${message.id}.json`);
  fs.writeFileSync(filepath, JSON.stringify(message, null, 2));
  
  return message.id;
}

/**
 * Check for pending messages for a server
 */
export function getPendingMessages(serverName: ServerName): IPCMessage[] {
  const files = fs.readdirSync(IPC_DIR).filter(f => f.endsWith('.json'));
  const messages: IPCMessage[] = [];
  
  for (const file of files) {
    const filepath = path.join(IPC_DIR, file);
    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    if (content.to === serverName && content.status === 'pending') {
      messages.push(content);
    }
  }
  
  return messages;
}

/**
 * Update message status and optionally add response
 */
export function updateMessage(
  messageId: string,
  status: IPCMessage['status'],
  response?: any
): void {
  const filepath = path.join(IPC_DIR, `${messageId}.json`);
  if (fs.existsSync(filepath)) {
    const message: IPCMessage = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    message.status = status;
    if (response !== undefined) {
      message.response = response;
    }
    fs.writeFileSync(filepath, JSON.stringify(message, null, 2));
  }
}

/**
 * Wait for a message response (with timeout)
 */
export async function waitForResponse(
  messageId: string,
  timeoutMs: number = 30000
): Promise<any> {
  const filepath = path.join(IPC_DIR, `${messageId}.json`);
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    if (fs.existsSync(filepath)) {
      const message: IPCMessage = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      if (message.status === 'completed') {
        // Cleanup
        fs.unlinkSync(filepath);
        return message.response;
      }
      if (message.status === 'error') {
        fs.unlinkSync(filepath);
        throw new Error(`IPC Error: ${message.response}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  throw new Error(`IPC timeout waiting for ${messageId}`);
}

/**
 * Clean up old IPC messages (older than 1 hour)
 */
export function cleanupOldMessages(): void {
  const files = fs.readdirSync(IPC_DIR).filter(f => f.endsWith('.json'));
  const oneHourAgo = Date.now() - 3600000;
  
  for (const file of files) {
    const filepath = path.join(IPC_DIR, file);
    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    if (content.timestamp < oneHourAgo) {
      fs.unlinkSync(filepath);
    }
  }
}

/**
 * Pipeline builder for multi-server workflows
 */
export class Pipeline {
  private steps: Array<{
    server: ServerName;
    action: string;
    payloadMapper: (prevResult: any) => Record<string, any>;
  }> = [];
  
  constructor(private readonly sourceServer: ServerName) {}
  
  addStep(
    server: ServerName,
    action: string,
    payloadMapper: (prevResult: any) => Record<string, any> = (r) => r
  ): Pipeline {
    this.steps.push({ server, action, payloadMapper });
    return this;
  }
  
  async execute(initialPayload: Record<string, any>): Promise<any> {
    let result = initialPayload;
    
    for (const step of this.steps) {
      const payload = step.payloadMapper(result);
      const messageId = await sendToServer(
        this.sourceServer,
        step.server,
        step.action,
        payload
      );
      result = await waitForResponse(messageId);
    }
    
    return result;
  }
}

/**
 * Create a pipeline for common workflows
 */
export const pipelines = {
  /**
   * Blender → Unity: Generate 3D model then import to Unity
   */
  blenderToUnity: (sourceServer: ServerName) =>
    new Pipeline(sourceServer)
      .addStep('blender', 'generate_3d_model')
      .addStep('unity', 'import_fbx'),
  
  /**
   * Figma → Flame: Export UI design then generate Flutter widgets
   */
  figmaToFlame: (sourceServer: ServerName) =>
    new Pipeline(sourceServer)
      .addStep('figma', 'export_design')
      .addStep('flame', 'generate_ui_component'),
  
  /**
   * Core → Blender → Unity: AI generate concept, create 3D model, import to Unity
   */
  fullAssetPipeline: (sourceServer: ServerName) =>
    new Pipeline(sourceServer)
      .addStep('core', 'generate_2d_asset')
      .addStep('blender', 'create_from_reference')
      .addStep('unity', 'import_and_setup')
};
