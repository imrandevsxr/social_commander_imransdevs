import React, { useEffect, useState } from 'react';
import { Sparkles, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface Conversation {
  id: number;
  title: string;
  messagesJson: Array<{ role: 'user' | 'assistant'; text: string; ts: string }>;
  updatedAt: string;
}

export function AiStudioView({
  aiModel,
  aiEnabled,
}: {
  aiModel: string;
  aiEnabled: boolean;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | undefined>(undefined);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = async () => {
    const data = await apiFetch<Conversation[]>('/api/ai/conversations');
    setConversations(data);
    if (data.length > 0 && !activeConvId) {
      setActiveConvId(data[0].id);
    }
  };

  useEffect(() => {
    void loadConversations();
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch<{ ok: boolean; model: string; reply: string; latencyMs: number }>('/api/ai/test', {
        method: 'POST',
      });
      setTestResult({ ok: true, text: `${res.model} responded in ${res.latencyMs}ms: "${res.reply}"` });
    } catch (err: unknown) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const updated = await apiFetch<Conversation>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ conversationId: activeConvId, message: prompt }),
      });
      setPrompt('');
      setActiveConvId(updated.id);
      await loadConversations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'AI request failed');
    } finally {
      setSending(false);
    }
  };

  const activeConv = conversations.find((c) => c.id === activeConvId) || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gemini AI Control Center</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Server-side Gemini integration for intelligent metadata mapping, failure diagnostics, and administrator assistance.
          </p>
        </div>
        <button
          type="button"
          disabled={testing}
          onClick={handleTest}
          className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          <span>{testing ? 'Testing...' : 'Test Gemini Connection'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Active Model</div>
          <div className="mt-1 text-sm font-mono font-semibold">{aiModel}</div>
        </div>
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">AI Metadata Assistant</div>
          <div className="mt-1 text-sm font-semibold">{aiEnabled ? 'Enabled' : 'Disabled'}</div>
        </div>
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Credential Handling</div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">Managed externally via server Secrets</div>
        </div>
      </div>

      {testResult && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-center gap-2 ${
            testResult.ok
              ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
              : 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
          }`}
        >
          {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{testResult.text}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Conversations</span>
            <button
              type="button"
              onClick={() => setActiveConvId(undefined)}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              + New Chat
            </button>
          </div>
          <div className="space-y-1">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveConvId(c.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs truncate ${
                  c.id === activeConvId
                    ? 'bg-indigo-600 text-white'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {c.title}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col h-[520px]">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
            AI Administrator & Metadata Assistant
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {!activeConv || activeConv.messagesJson.length === 0 ? (
              <div className="text-sm text-slate-500 space-y-2">
                <p>Ask Gemini to help diagnose publishing errors, explain YouTube/TikTok/Meta quotas, or draft multi-platform captions.</p>
                <div className="flex flex-wrap gap-2 pt-2">
                  {[
                    'Why might a TikTok upload be restricted to SELF_ONLY?',
                    'Diagnose recent failed publishing jobs in my queue.',
                    'Suggest YouTube tags and Instagram caption for an AI tutorial.',
                  ].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setPrompt(q)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              activeConv.messagesJson.map((m, i) => (
                <div
                  key={i}
                  className={`p-3.5 rounded-xl text-sm whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white ml-auto max-w-[80%]'
                      : 'bg-slate-100 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 mr-auto max-w-[88%]'
                  }`}
                >
                  {m.text}
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSend} className="p-4 border-t border-slate-200 dark:border-slate-800 flex gap-3">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask the AI Administrator Assistant..."
              className="flex-1 px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
            />
            <button
              type="submit"
              disabled={sending || !prompt.trim()}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white inline-flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{sending ? 'Thinking...' : 'Send'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
