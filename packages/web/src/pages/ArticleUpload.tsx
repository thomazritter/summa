import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { articleApi, summaryApi } from '../api/client';

export function ArticleUpload() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const profileId = sessionStorage.getItem('selectedProfileId');

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const article = await articleApi.upload(file) as { id: number };
      const summary = await summaryApi.generate(article.id, Number(profileId)) as { id: number };
      return summary;
    },
    onSuccess: (summary) => navigate(`/summary/${summary.id}`),
  });

  if (!profileId) { navigate('/profiles'); return null; }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Upload Scientific Article</h2>
      <div className="border-2 border-dashed rounded-lg p-12 text-center border-gray-300">
        {file ? (
          <div className="space-y-2">
            <p className="font-medium">{file.name}</p>
            <p className="text-sm text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            <button onClick={() => setFile(null)} className="text-red-600 hover:underline text-sm">Remove</button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-gray-600">Select a PDF file to summarize</p>
            <input type="file" accept=".pdf" onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} className="hidden" id="file-input" />
            <label htmlFor="file-input" className="inline-block px-4 py-2 bg-gray-100 rounded-lg cursor-pointer hover:bg-gray-200">Select PDF</label>
          </div>
        )}
      </div>
      {uploadMutation.error && <div className="bg-red-50 text-red-700 p-4 rounded-lg">Error: {(uploadMutation.error as Error).message}</div>}
      <button onClick={() => file && uploadMutation.mutate(file)} disabled={!file || uploadMutation.isPending}
        className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
        {uploadMutation.isPending ? 'Processing...' : 'Generate Summary'}
      </button>
    </div>
  );
}
