import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { summaryApi, feedbackApi } from '../api/client';

interface Summary { id: number; content: string; factualityScore: number | null; }

export function SummaryView() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState({ utilityRating: 3, technicalLevelRating: 3, depthRating: 3, comments: '' });

  const { data: summary, isLoading } = useQuery({ queryKey: ['summary', id], queryFn: () => summaryApi.get(Number(id)) as Promise<Summary> });

  const feedbackMutation = useMutation({
    mutationFn: (data: typeof feedback) => feedbackApi.submit({ summaryId: Number(id), ...data }),
    onSuccess: () => alert('Thank you for your feedback!'),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => summaryApi.regenerate(Number(id)),
    onSuccess: (newSummary) => queryClient.setQueryData(['summary', id], newSummary),
  });

  if (isLoading) return <div className="text-center py-8">Loading summary...</div>;
  if (!summary) return <div className="text-center py-8">Summary not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Your Personalized Summary</h2>
        <Link to="/profiles" className="text-blue-600 hover:underline">Summarize Another</Link>
      </div>

      <div className="bg-white p-6 rounded-lg border">
        <div className="prose max-w-none">
          <ReactMarkdown>{summary.content}</ReactMarkdown>
        </div>
        {summary.factualityScore !== null && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm text-gray-600">Factuality Score: {(summary.factualityScore * 100).toFixed(0)}%</p>
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-lg border">
        <h3 className="font-semibold text-lg mb-4">Rate This Summary</h3>
        <div className="space-y-4">
          <RatingInput label="How useful?" value={feedback.utilityRating} onChange={(v) => setFeedback({ ...feedback, utilityRating: v })} low="Not useful" high="Very useful" />
          <RatingInput label="Technical level?" value={feedback.technicalLevelRating} onChange={(v) => setFeedback({ ...feedback, technicalLevelRating: v })} low="Too simple" high="Too complex" />
          <RatingInput label="Depth?" value={feedback.depthRating} onChange={(v) => setFeedback({ ...feedback, depthRating: v })} low="Too brief" high="Too detailed" />
          <div>
            <label className="block text-sm font-medium mb-1">Comments (optional)</label>
            <textarea value={feedback.comments} onChange={(e) => setFeedback({ ...feedback, comments: e.target.value })} className="w-full border rounded-lg p-2 h-24" placeholder="What could be improved?" />
          </div>
          <div className="flex gap-3">
            <button onClick={() => feedbackMutation.mutate(feedback)} disabled={feedbackMutation.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">Submit Feedback</button>
            <button onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50">
              {regenerateMutation.isPending ? 'Regenerating...' : 'Regenerate Summary'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RatingInput({ label, value, onChange, low, high }: { label: string; value: number; onChange: (v: number) => void; low: string; high: string }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 w-20">{low}</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => onChange(n)} className={`w-8 h-8 rounded-full border ${value === n ? 'bg-blue-600 text-white border-blue-600' : 'hover:border-blue-400'}`}>{n}</button>
          ))}
        </div>
        <span className="text-xs text-gray-500 w-20 text-right">{high}</span>
      </div>
    </div>
  );
}
