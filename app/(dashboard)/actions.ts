'use client';

import { apiUrl, authedRequestInit } from '@/utils/api-client';
import { fetchWithColdStartHint } from '@/utils/fetch-with-cold-start-hint';

type ActionResult = { success: true; data?: unknown } | { success: false; error: string };

function languageArray(value: FormDataEntryValue | null): string[] {
  const str = (value as string) || '';
  return str
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function optionalArray(value: FormDataEntryValue | null): string[] | null {
  const arr = languageArray(value);
  return arr.length > 0 ? arr : null;
}

// createItem/updateItem/deleteItem are not kept in the warm pool (see
// AWS_MIGRATION_PLAN.md), so callers can pass onSlow to surface a
// "still starting up" message if the Lambda is cold.
async function adminRequest(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  onSlow?: () => void
): Promise<ActionResult> {
  try {
    const init = await authedRequestInit({
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
    const { data } = await fetchWithColdStartHint<{ success: boolean; data?: unknown }>(
      apiUrl(path),
      init,
      () => onSlow?.()
    );
    return { success: true, data: data.data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    };
  }
}

export async function createProduct(
  formData: FormData,
  onSlow?: () => void
): Promise<ActionResult> {
  const title = (formData.get('title') as string)?.trim();
  const category = (formData.get('category') as string)?.trim();
  if (!title) return { success: false, error: 'Title is required' };
  if (!category) return { success: false, error: 'Category is required' };

  const language = languageArray(formData.get('language'));
  if (language.length === 0) {
    return { success: false, error: 'Language is required' };
  }

  const year = (formData.get('year') as string)?.trim();

  const sheetId = ((formData.get('sheetId') as string) || '').trim();

  return adminRequest(
    '/catalog',
    'POST',
    {
      title,
      category,
      language,
      pubyear: year ? parseInt(year, 10) || null : null,
      firstname: ((formData.get('firstname') as string) || '').trim(),
      lastname: ((formData.get('lastname') as string) || '').trim(),
      editedTranslated: optionalArray(formData.get('editedtranslated')),
      sheetId: sheetId || null,
    },
    onSlow
  );
}

export async function updateProduct(
  formData: FormData,
  onSlow?: () => void
): Promise<ActionResult> {
  const id = formData.get('id') as string;
  if (!id) return { success: false, error: 'Product ID is required' };

  const title = formData.get('title') as string;
  const category = formData.get('category') as string;
  const year = (formData.get('year') as string)?.trim();

  const sheetId = ((formData.get('sheetId') as string) || '').trim();

  return adminRequest(
    `/catalog/${encodeURIComponent(id)}`,
    'PUT',
    {
      ...(title ? { title } : {}),
      ...(category ? { category } : {}),
      language: languageArray(formData.get('language')),
      pubyear: year ? parseInt(year, 10) || null : null,
      firstname: ((formData.get('firstname') as string) || '').trim(),
      lastname: ((formData.get('lastname') as string) || '').trim(),
      editedTranslated: optionalArray(formData.get('editedtranslated')),
      sheetId: sheetId || null,
    },
    onSlow
  );
}

export async function deleteProduct(
  formData: FormData,
  onSlow?: () => void
): Promise<ActionResult> {
  const id = formData.get('id') as string;
  if (!id) return { success: false, error: 'Product ID is required' };

  return adminRequest(`/catalog/${encodeURIComponent(id)}`, 'DELETE', null, onSlow);
}

// checkoutBook/returnBook stay in the warm pool (see AWS_MIGRATION_PLAN.md),
// so no cold-start hint is needed for these two.
async function warmRequest(path: string, bookId: string): Promise<ActionResult> {
  try {
    const init = await authedRequestInit({ method: 'POST' });
    const response = await fetch(apiUrl(`/catalog/${encodeURIComponent(bookId)}${path}`), init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, error: body?.error ?? 'Request failed' };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    };
  }
}

export async function checkoutBook(formData: FormData): Promise<ActionResult> {
  const bookId = formData.get('bookId') as string;
  if (!bookId) return { success: false, error: 'Book ID is required' };
  return warmRequest('/checkout', bookId);
}

export async function returnBook(formData: FormData): Promise<ActionResult> {
  const bookId = formData.get('bookId') as string;
  if (!bookId) return { success: false, error: 'Book ID is required' };
  return warmRequest('/return', bookId);
}
