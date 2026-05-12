import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { articleApi, userApi } from '../api/client';
import type { ArticleUploadResponse } from '../api/client';
import { formatFileSize } from '../utils/format';

type Phase = 'upload' | 'loading' | 'results';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const LOADING_MESSAGES = [
  'Extraindo texto do PDF...',
  'Identificando seções do artigo...',
  'Analisando metadados...',
  'Validando estrutura...',
];

export function ArticleUpload() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const participantId = sessionStorage.getItem('experimentParticipantId');

  const [phase, setPhase] = useState<Phase>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [uploadResult, setUploadResult] = useState<ArticleUploadResponse | null>(null);

  // Redirect if no profile configured
  useEffect(() => {
    if (!participantId) {
      navigate('/dashboard');
    }
  }, [participantId, navigate]);

  // Cycle loading messages
  useEffect(() => {
    if (phase !== 'loading') return;
    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [phase]);

  const uploadMutation = useMutation({
    mutationFn: (selectedFile: File) => articleApi.upload(selectedFile),
    onSuccess: (data: ArticleUploadResponse) => {
      setUploadResult(data);
      setPhase('results');
    },
    onError: () => {
      setPhase('upload');
    },
  });

  const validateFile = useCallback((selectedFile: File): boolean => {
    setFileError(null);
    if (selectedFile.type !== 'application/pdf') {
      setFileError('Apenas arquivos PDF são aceitos.');
      return false;
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      setFileError('O arquivo deve ter no máximo 10MB.');
      return false;
    }
    return true;
  }, []);

  const handleFileSelect = useCallback((selectedFile: File) => {
    if (validateFile(selectedFile)) {
      setFile(selectedFile);
      setFileError(null);
    }
  }, [validateFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  }, [handleFileSelect]);

  const handleRemoveFile = useCallback(() => {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleUpload = useCallback(() => {
    if (!file) return;
    setPhase('loading');
    setLoadingMessageIndex(0);
    uploadMutation.mutate(file);
  }, [file, uploadMutation]);

  const handleReset = useCallback(() => {
    setFile(null);
    setFileError(null);
    setUploadResult(null);
    setPhase('upload');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const generateMutation = useMutation({
    mutationFn: async (articleId: number) => {
      const summary = await userApi.summarize(articleId) as { id: number };
      return summary;
    },
    onSuccess: (summary) => {
      navigate(`/summary/${summary.id}`);
    },
  });

  const handleGenerateSummary = useCallback(() => {
    if (!uploadResult) return;
    generateMutation.mutate(uploadResult.article.id);
  }, [uploadResult, generateMutation]);

  const hasErrors = (uploadResult?.validation.errors?.length ?? 0) > 0;
  const hasWarnings = (uploadResult?.validation.warnings?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      <div className="max-w-3xl mx-auto py-12 px-6">
        <div className="mb-6">
          <Link
            to="/dashboard"
            className="text-[#2563eb] hover:text-[#1d4ed8] text-sm font-medium transition-colors"
          >
            &larr; Voltar ao dashboard
          </Link>
        </div>

        {/* Phase 1: Upload */}
        {phase === 'upload' && (
          <div className="bg-white border border-gray-200 rounded-lg p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Upload de Artigo Científico
            </h1>
            <p className="text-gray-600 mb-8">
              Envie um artigo em PDF para receber um resumo personalizado
              de acordo com seu perfil de leitura.
            </p>

            {/* Drag and drop zone */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Área para arrastar e soltar arquivo PDF do artigo"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
                isDragOver
                  ? 'border-[#2563eb] bg-blue-50'
                  : 'border-gray-300 hover:border-[#2563eb]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleInputChange}
                className="hidden"
                aria-hidden="true"
              />
              <svg
                className="mx-auto h-12 w-12 text-gray-400 mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 16v-8m0 0l-3 3m3-3l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-gray-700 font-medium mb-1">
                Arraste o PDF ou clique para selecionar
              </p>
              <p className="text-sm text-gray-500">
                ou clique para selecionar o arquivo
              </p>
              <p className="text-xs text-gray-400 mt-2">PDF, máximo 10MB</p>
            </div>

            {/* File selected */}
            {file && (
              <div className="mt-4 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <svg
                    className="h-6 w-6 text-[#2563eb]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{file.name}</p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveFile();
                  }}
                  className="text-sm text-red-600 hover:text-red-800 font-medium transition-colors"
                  aria-label="Remover arquivo selecionado"
                >
                  Remover
                </button>
              </div>
            )}

            {/* File validation error */}
            {fileError && (
              <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg" role="alert">
                {fileError}
              </div>
            )}

            {/* Upload error from previous attempt */}
            {uploadMutation.error && phase === 'upload' && (
              <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg" role="alert">
                Erro ao processar o artigo: {(uploadMutation.error as Error).message}
              </div>
            )}

            {/* Upload button */}
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || uploadMutation.isPending}
              className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-6"
            >
              Enviar artigo
            </button>
          </div>
        )}

        {/* Phase 2: Loading */}
        {phase === 'loading' && (
          <div className="bg-white border border-gray-200 rounded-lg p-8">
            <div className="flex flex-col items-center justify-center py-16">
              <div
                className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mb-6"
                role="status"
                aria-label="Processando artigo"
              />
              <p
                className="text-lg text-gray-700 font-medium"
                aria-live="polite"
              >
                {LOADING_MESSAGES[loadingMessageIndex]}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Isso pode levar alguns segundos
              </p>
            </div>

            {/* Error during loading */}
            {uploadMutation.error && (
              <div className="mt-4">
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-4" role="alert">
                  Não foi possível processar o artigo. Tente novamente.
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="w-full py-3 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] transition-colors"
                >
                  Tentar novamente
                </button>
              </div>
            )}
          </div>
        )}

        {/* Phase 3: Results */}
        {phase === 'results' && uploadResult && (
          <div className="space-y-6">
            {/* Status header */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-1">
                {hasErrors ? (
                  <svg
                    className="h-7 w-7 text-red-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-7 w-7 text-green-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
                <h1 className="text-3xl font-bold text-gray-900">
                  {hasErrors ? 'Artigo rejeitado' : 'Artigo aceito'}
                </h1>
              </div>
              <p className="text-gray-600 ml-10">
                {hasErrors
                  ? 'O artigo não pôde ser processado. Corrija os erros e tente novamente.'
                  : 'O artigo foi processado com sucesso. Confira os detalhes abaixo.'}
              </p>
            </div>

            {/* Metadata card */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Metadados do artigo
              </h2>
              <dl className="space-y-3">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Título</dt>
                  <dd className="text-gray-900 mt-0.5">
                    {uploadResult.article.title || 'Não identificado'}
                  </dd>
                </div>
                {uploadResult.article.authors && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Autores</dt>
                    <dd className="text-gray-900 mt-0.5">
                      {uploadResult.article.authors}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm font-medium text-gray-500">Texto extraído</dt>
                  <dd className="text-gray-900 mt-0.5">
                    {uploadResult.article.rawText.length.toLocaleString('pt-BR')} caracteres extraídos
                  </dd>
                </div>
              </dl>
            </div>

            {/* Section detection panel suppressed: the LLM structurer is not
                reliable enough at the section level to surface a per-section
                "found / not found" list without misleading the reader. The
                structurer's output continues to feed factuality anchoring and
                metric selection internally. */}

            {/* Errors card */}
            {hasErrors && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
                <div className="flex items-center gap-2 mb-2">
                  <svg
                    className="h-5 w-5 text-red-600 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <h3 className="font-semibold text-red-800">
                    Erros encontrados
                  </h3>
                </div>
                <ul className="list-disc list-inside space-y-1 text-sm text-red-700 ml-7">
                  {uploadResult.validation.errors?.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings card */}
            {hasWarnings && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4" role="status">
                <div className="flex items-center gap-2 mb-2">
                  <svg
                    className="h-5 w-5 text-amber-600 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                  <h3 className="font-semibold text-amber-800">
                    Avisos
                  </h3>
                </div>
                <ul className="list-disc list-inside space-y-1 text-sm text-amber-700 ml-7">
                  {uploadResult.validation.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Generation error */}
            {generateMutation.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
                <div className="flex items-center gap-2 mb-1">
                  <svg
                    className="h-5 w-5 text-red-600 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-sm text-red-700">
                    Erro ao gerar resumo: {(generateMutation.error as Error).message}
                  </p>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleGenerateSummary}
                disabled={hasErrors || generateMutation.isPending}
                className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-describedby={hasErrors ? 'errors-tooltip' : undefined}
              >
                {generateMutation.isPending ? 'Gerando resumo...' : 'Gerar resumo'}
              </button>
              {hasErrors && (
                <p id="errors-tooltip" className="text-sm text-red-600 text-center">
                  Corrija os erros acima para gerar o resumo.
                </p>
              )}
              <button
                type="button"
                onClick={handleReset}
                disabled={generateMutation.isPending}
                className="w-full py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors text-center"
              >
                Enviar outro artigo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
