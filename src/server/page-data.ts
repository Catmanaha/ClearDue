import { publicError } from './public-error';
import { DomainError } from '../domain/core';

export const requestTimestamp = () => Date.now();
export async function pageData<T>(
  load: () => Promise<T>,
): Promise<
  | { data: T; error?: never; signInRequired?: never }
  | { data?: never; error: string; signInRequired: boolean }
> {
  try {
    return { data: await load() };
  } catch (e) {
    return {
      signInRequired: e instanceof DomainError && e.code === 'UNAUTHORIZED',
      error: publicError(
        e,
        'Your workspace could not be opened. Try opening it again. If this continues, ask the person who set it up to check the connection.',
      ),
    };
  }
}
