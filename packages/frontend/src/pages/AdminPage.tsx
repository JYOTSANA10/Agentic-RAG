import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Trash2, FileText, AlertCircle, CheckCircle2, Loader2, ArrowLeft } from 'lucide-react';
import { getDocuments, uploadDocument, deleteDocument, getAuditLogs, type Document, type AuditLog } from '../api/admin';

type Tab = 'documents' | 'audit';
const formatBytes = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;
const SOURCE_COLOR: Record<string, string> = { internal: 'bg-emerald-100 text-emerald-700', web: 'bg-amber-100 text-amber-700', none: 'bg-gray-100 text-gray-600' };

export default function AdminPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('documents');
  const [docs, setDocs] = useState<Document[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logPages, setLogPages] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => { getDocuments().then(setDocs).catch(() => showToast('error', 'Failed to load documents')); }, []);

  useEffect(() => {
    if (tab === 'audit') {
      getAuditLogs(logPage).then((d) => { setLogs(d.logs); setLogPages(d.pages); }).catch(() => showToast('error', 'Failed to load audit logs'));
    }
  }, [tab, logPage]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadDocument(file);
      showToast('success', `"${file.name}" ingested successfully`);
      setDocs(await getDocuments());
    } catch (err: any) {
      showToast('error', err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all its vectors? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await deleteDocument(id);
      setDocs((d) => d.filter((doc) => doc.id !== id));
      showToast('success', `"${name}" deleted`);
    } catch { showToast('error', 'Failed to delete document'); }
    finally { setDeletingId(null); }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-brand-900 text-white px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/chat')} className="text-brand-300 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-bold text-lg">Admin Panel</h1>
          <p className="text-brand-300 text-sm">Manage documents and monitor usage</p>
        </div>
      </div>

      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm ${toast.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      <div className="max-w-5xl mx-auto p-6">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit mb-6">
          {(['documents', 'audit'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${tab === t ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {t === 'documents' ? 'Documents' : 'Audit Log'}
            </button>
          ))}
        </div>

        {tab === 'documents' && (
          <>
            <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center mb-6 hover:border-brand-400 transition-colors">
              <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700 mb-1">Upload a company document</p>
              <p className="text-xs text-gray-500 mb-4">Supports PDF, TXT, Markdown, DOCX · Max 20 MB</p>
              <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.docx" onChange={handleUpload} className="hidden" />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm px-5 py-2 rounded-lg transition-colors inline-flex items-center gap-2">
                {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                {uploading ? 'Ingesting...' : 'Choose File'}
              </button>
            </div>
            <div className="space-y-3">
              {docs.length === 0 && <p className="text-center text-sm text-gray-500 py-8">No documents ingested yet.</p>}
              {docs.map((d) => (
                <div key={d.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="bg-brand-100 p-2 rounded-lg flex-shrink-0"><FileText className="w-4 h-4 text-brand-600" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{d.originalName}</p>
                    <p className="text-xs text-gray-500">{d.chunkCount} chunks · {formatBytes(d.sizeBytes)} · {new Date(d.createdAt).toLocaleDateString()}</p>
                  </div>
                  <button onClick={() => handleDelete(d.id, d.originalName)} disabled={deletingId === d.id}
                    className="text-red-400 hover:text-red-600 disabled:opacity-40 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                    {deletingId === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'audit' && (
          <>
            <div className="space-y-2 mb-6">
              {logs.length === 0 && <p className="text-center text-sm text-gray-500 py-8">No audit records yet.</p>}
              {logs.map((l) => (
                <div key={l.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm text-gray-800 flex-1">{l.question}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${SOURCE_COLOR[l.sourceType] || 'bg-gray-100 text-gray-600'}`}>{l.sourceType}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    {l.user && <span>{l.user.name}</span>}
                    <span>{l.latencyMs}ms</span>
                    {l.retriesUsed > 0 && <span>{l.retriesUsed} retry</span>}
                    <span>{new Date(l.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
            {logPages > 1 && (
              <div className="flex items-center justify-center gap-3">
                <button disabled={logPage === 1} onClick={() => setLogPage(logPage - 1)} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-100">Previous</button>
                <span className="text-sm text-gray-500">Page {logPage} of {logPages}</span>
                <button disabled={logPage === logPages} onClick={() => setLogPage(logPage + 1)} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-100">Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

