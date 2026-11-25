let inMemoryBearerToken: string | null = null;

export function setInMemoryToken(token: string | null): void {
  inMemoryBearerToken = token;
}

export function getInMemoryToken(): string | null {
  return inMemoryBearerToken;
}

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'XMLHttpRequest');
  if (inMemoryBearerToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryBearerToken}`);
  }
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !(options.body instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(options.body) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const message =
      (typeof data.error === 'string' && data.error) ||
      `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

export async function uploadVideoResumable<T>(
  file: File,
  title: string,
  opts: {
    projectId?: string;
    autoAnalyze?: boolean;
    onProgress: (pct: number, uploadedBytes: number, totalBytes: number) => void;
    onStatus?: (status: string) => void;
    signal: AbortSignal;
  }
): Promise<T> {
  const chunkSize = 4 * 1024 * 1024; // 4 MB chunks
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

  opts.onStatus?.('Initializing upload session...');
  const { uploadId } = await apiRequest<{ uploadId: string }>('/api/projects/upload/init', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      totalSize: file.size,
      totalChunks,
      title,
      projectId: opts.projectId,
      autoAnalyze: opts.autoAnalyze,
    }),
    signal: opts.signal,
  });

  try {
    let uploadedBytes = 0;
    for (let index = 0; index < totalChunks; index++) {
      if (opts.signal.aborted) {
        throw new Error('Upload cancelled.');
      }
      const start = index * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const blob = file.slice(start, end);
      const buffer = await blob.arrayBuffer();

      opts.onStatus?.(`Uploading chunk ${index + 1} of ${totalChunks}...`);
      const headers = new Headers({
        'Content-Type': 'application/octet-stream',
        'X-Requested-With': 'XMLHttpRequest',
        'x-upload-id': uploadId,
        'x-chunk-index': String(index),
      });
      if (inMemoryBearerToken) {
        headers.set('Authorization', `Bearer ${inMemoryBearerToken}`);
      }

      const res = await fetch('/api/projects/upload/chunk', {
        method: 'POST',
        headers,
        body: buffer,
        credentials: 'include',
        signal: opts.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || 'Chunk upload failed.');
      }

      uploadedBytes += buffer.byteLength;
      const pct = Math.min(96, Math.round((uploadedBytes / file.size) * 96));
      opts.onProgress(pct, uploadedBytes, file.size);
    }

    opts.onStatus?.('Verifying media streams with FFprobe...');
    const result = await apiRequest<T>('/api/projects/upload/complete', {
      method: 'POST',
      body: JSON.stringify({
        uploadId,
        autoAnalyze: opts.autoAnalyze,
      }),
      signal: opts.signal,
    });
    opts.onProgress(100, file.size, file.size);
    return result;
  } catch (err) {
    // Clean up aborted/failed chunk session on server
    apiRequest(`/api/projects/upload/${uploadId}`, { method: 'DELETE' }).catch(() => {});
    throw err;
  }
}
