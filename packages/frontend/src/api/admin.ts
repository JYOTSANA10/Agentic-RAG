import api from './client';

export interface Document { id: string; originalName: string; chunkCount: number; sizeBytes: number; uploadedBy: string; createdAt: string; }
export interface AuditLog { id: string; question: string; sourceType: string; latencyMs: number; retriesUsed: number; createdAt: string; user?: { email: string; name: string }; }

export async function getDocuments(): Promise<Document[]> {
  const { data } = await api.get<{ documents: Document[] }>('/documents');
  return data.documents;
}

export async function uploadDocument(file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await api.post('/ingest', form, { headers: { 'Content-Type': 'multipart/form-data' } });
}

export async function deleteDocument(id: string): Promise<void> {
  await api.delete(`/documents/${id}`);
}

export async function getAuditLogs(page = 1): Promise<{ logs: AuditLog[]; total: number; pages: number }> {
  const { data } = await api.get(`/audit?page=${page}&limit=20`);
  return data;
}

