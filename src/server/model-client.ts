import OpenAI from 'openai';
import { modelSettings } from './config';

export function createModelClient() {
  const settings = modelSettings();
  return new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    maxRetries: 0,
    timeout: 25000,
    fetch: (input, init) => fetch(input, { ...init, redirect: 'error', cache: 'no-store' }),
  });
}
