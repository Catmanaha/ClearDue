import { z } from 'zod';

// Browser-safe input rules; evidence hashing and invoice validation stay on the server.
export const importSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    text: z
      .string()
      .min(1)
      .max(16000)
      .refine((text) => text.trim().length > 0),
    kind: z.enum(['agreement', 'message', 'note']),
  })
  .strict();
export type ImportedRecord = z.infer<typeof importSchema>;

export function checkRecords(value: unknown): ImportedRecord[] {
  const result = z.array(importSchema).min(1).max(12).safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const record = typeof issue.path[0] === 'number' ? `Record ${issue.path[0] + 1}: ` : '';
    const field = issue.path[1];
    throw new Error(
      record +
        (field === 'text'
          ? 'supply complete text between 1 and 16,000 characters; blank text is not a record.'
          : field === 'label'
            ? 'give this record a name between 1 and 100 characters.'
            : field === 'kind'
              ? 'choose Agreement, Customer message or Internal note.'
              : 'supply 1–12 records with only label, kind and text fields.'),
    );
  }
  if (new TextEncoder().encode(JSON.stringify(result.data)).length > 32000)
    throw new Error(
      'The records exceed 32,000 UTF-8 bytes. Use a smaller complete bundle; nothing was shortened.',
    );
  return result.data;
}

export function readRecordFile(name: string, bytes: Uint8Array): ImportedRecord[] {
  if (bytes.byteLength > 64000)
    throw new Error('Files must be at most 64,000 bytes. Nothing was added.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Save the file as UTF-8 text and try again. Nothing was added.');
  }
  if (/\.txt$/i.test(name)) return checkRecords([{ label: name, kind: 'note', text }]);
  if (!/\.json$/i.test(name))
    throw new Error('Choose a .txt or .json file. PDF and image import are not supported.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The JSON could not be read. Use the example format below; nothing was added.');
  }
  return checkRecords(value);
}
