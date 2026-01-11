#!/usr/bin/env node
/**
 * Shared Azure AI Clients
 * Used by all MCP servers in the monorepo
 */
import { AzureOpenAI } from 'openai';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

// DALL-E 3 client for image generation
export const imageClient = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: '2024-02-01',
  deployment: process.env.AZURE_IMAGE_DEPLOYMENT_NAME || 'dall-e-3',
});

// Sora client for video generation
export const soraClient = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: '2025-04-01-preview',
  deployment: process.env.AZURE_SORA_DEPLOYMENT_NAME || 'sora',
});

// GPT-4 client for story and code generation
export const gptClient = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: '2024-02-01',
  deployment: process.env.AZURE_GPT_DEPLOYMENT_NAME || 'gpt-4o',
});

// Azure Speech config
export const speechConfig = process.env.AZURE_SPEECH_KEY 
  ? sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY,
      process.env.AZURE_SPEECH_REGION || 'eastus'
    )
  : null;

// Sora endpoints
export const soraEndpoint = process.env.AZURE_SORA_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
export const soraApiKey = process.env.AZURE_SORA_API_KEY || process.env.AZURE_OPENAI_API_KEY;

// Re-export speech SDK for use in other modules
export { sdk as speechSdk };

// Helper function to check if Azure is configured
export function isAzureConfigured(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.AZURE_OPENAI_API_KEY) missing.push('AZURE_OPENAI_API_KEY');
  if (!process.env.AZURE_OPENAI_ENDPOINT) missing.push('AZURE_OPENAI_ENDPOINT');
  return { configured: missing.length === 0, missing };
}

// Helper function to check speech configuration
export function isSpeechConfigured(): boolean {
  return !!process.env.AZURE_SPEECH_KEY;
}
