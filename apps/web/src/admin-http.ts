export class HttpError extends Error {
  constructor(readonly status: number, message = `HTTP ${status}`, readonly code?: string,
    readonly issues?: Array<{ path: string; message: string }>) { super(message) }
}
export async function getAdminJson<T>(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, { signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...headers } })
  if (!response.ok) throw new HttpError(response.status)
  return response.json() as Promise<T>
}
export function errorStatus(error: unknown): number | null { return error instanceof HttpError ? error.status : null }
