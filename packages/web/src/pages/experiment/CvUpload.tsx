import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';


interface DimensionConfig {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

const DIMENSIONS: DimensionConfig[] = [
  {
    key: 'expertise',
    label: 'Nível de expertise',
    options: [
      { value: 'beginner', label: 'Iniciante' },
      { value: 'intermediate', label: 'Intermediário' },
      { value: 'advanced', label: 'Avançado' },
      { value: 'expert', label: 'Especialista' },
    ],
  },
  {
    key: 'focus',
    label: 'Foco de leitura',
    options: [
      { value: 'concepts', label: 'Conceitos' },
      { value: 'methodology', label: 'Metodologia' },
      { value: 'results', label: 'Resultados' },
      { value: 'applications', label: 'Aplicações' },
      { value: 'all', label: 'Todos' },
    ],
  },
  {
    key: 'depth',
    label: 'Profundidade',
    options: [
      { value: 'brief', label: 'Breve' },
      { value: 'moderate', label: 'Moderado' },
      { value: 'detailed', label: 'Detalhado' },
      { value: 'comprehensive', label: 'Abrangente' },
    ],
  },
  {
    key: 'context',
    label: 'Contexto de uso',
    options: [
      { value: 'quick_review', label: 'Revisão rápida' },
      { value: 'learning', label: 'Aprendizado' },
      { value: 'research', label: 'Pesquisa' },
      { value: 'teaching', label: 'Ensino' },
    ],
  },
];

interface CvProfileResponse {
  dimensions: Record<string, string>;
  experienceLevel: string;
  reasoning: Record<string, string>;
}

type Phase = 'upload' | 'loading' | 'results';

const LOADING_MESSAGES = [
  'Extraindo informações do currículo...',
  'Identificando áreas de atuação...',
  'Determinando nível de experiência...',
  'Montando seu perfil...',
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function CvUpload() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  // Results state
  const [cvResult, setCvResult] = useState<CvProfileResponse | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [structurePreference, setStructurePreference] = useState('');
  const [englishComfort, setEnglishComfort] = useState('');
  const [name, setName] = useState('');

  // Cycle loading messages every 2 seconds
  useEffect(() => {
    if (phase !== 'loading') return;
    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [phase]);

  const uploadMutation = useMutation({
    mutationFn: (selectedFile: File) => experimentApi.uploadCv(selectedFile),
    onSuccess: (data: CvProfileResponse) => {
      setCvResult(data);
      setSelections(data.dimensions || {});
      setPhase('results');
    },
    onError: () => {
      setPhase('upload');
    },
  });

  const registerMutation = useMutation({
    mutationFn: (data: {
      name: string;
      experienceLevel: string;
      structurePreference: string;
      englishComfort: string;
      dimensions: Record<string, string>;
    }) => experimentApi.registerFromCv({
      name: data.name,
      experienceLevel: data.experienceLevel,
      dimensions: data.dimensions,
      structurePreference: data.structurePreference,
      englishComfort: data.englishComfort,
    }),
    onSuccess: (participant) => {
      sessionStorage.setItem('experimentParticipantId', String(participant.id));
      sessionStorage.setItem('experimentParticipantName', participant.name);
      navigate('/dashboard');
    },
  });

  const validateFile = useCallback((selectedFile: File): boolean => {
    setFileError(null);
    if (selectedFile.type !== 'application/pdf') {
      setFileError('Apenas arquivos PDF são aceitos.');
      return false;
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      setFileError('O arquivo deve ter no máximo 5MB.');
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

  const handleAnalyze = useCallback(() => {
    if (!file) return;
    setPhase('loading');
    setLoadingMessageIndex(0);
    uploadMutation.mutate(file);
  }, [file, uploadMutation]);

  const handleRetry = useCallback(() => {
    setFile(null);
    setFileError(null);
    setPhase('upload');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleSelect = useCallback((dimensionKey: string, value: string) => {
    setSelections((prev) => ({ ...prev, [dimensionKey]: value }));
  }, []);

  const handleConfirm = useCallback(() => {
    if (!name.trim() || !structurePreference || !englishComfort) return;
    registerMutation.mutate({
      name: name.trim(),
      experienceLevel: cvResult?.experienceLevel || 'pleno',
      structurePreference,
      englishComfort,
      dimensions: selections,
    });
  }, [name, structurePreference, englishComfort, selections, registerMutation]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isResultsValid =
    name.trim().length > 0 &&
    structurePreference !== '' &&
    englishComfort !== '' &&
    Object.keys(selections).length >= 4;

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
              Análise de Currículo
            </h1>
            <p className="text-gray-600 mb-8">
              Envie seu currículo em PDF e identificaremos automaticamente seu perfil de
              leitura a partir das suas áreas de atuação e experiência.
            </p>

            {/* Drag and drop zone */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Área para arrastar e soltar arquivo PDF"
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
                Arraste seu currículo aqui
              </p>
              <p className="text-sm text-gray-500">
                ou clique para selecionar o arquivo
              </p>
              <p className="text-xs text-gray-400 mt-2">PDF, máximo 5MB</p>
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

            {/* File error */}
            {fileError && (
              <div className="mt-4 bg-red-50 text-red-700 p-4 rounded-lg" role="alert">
                {fileError}
              </div>
            )}

            {/* Upload error from mutation */}
            {uploadMutation.error && phase === 'upload' && (
              <div className="mt-4 bg-red-50 text-red-700 p-4 rounded-lg" role="alert">
                Erro ao processar o currículo: {(uploadMutation.error as Error).message}
              </div>
            )}

            {/* Analyze button */}
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!file || uploadMutation.isPending}
              className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-6"
            >
              Analisar currículo
            </button>

            {/* Link to questionnaire */}
            <p className="text-center mt-6">
              <Link
                to="/profile/setup"
                className="text-sm text-[#2563eb] hover:text-[#1d4ed8] font-medium transition-colors"
              >
                Prefere responder o questionário?
              </Link>
            </p>
          </div>
        )}

        {/* Phase 2: Loading */}
        {phase === 'loading' && (
          <div className="bg-white border border-gray-200 rounded-lg p-8">
            <div className="flex flex-col items-center justify-center py-16">
              <div
                className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mb-6"
                role="status"
                aria-label="Processando currículo"
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
                <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-4" role="alert">
                  Não foi possível processar o currículo. Tente novamente ou responda o
                  questionário manualmente.
                </div>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="w-full py-3 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] transition-colors"
                  >
                    Tentar novamente
                  </button>
                  <Link
                    to="/profile/setup"
                    className="w-full py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors text-center"
                  >
                    Responder questionário
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Phase 3: Results */}
        {phase === 'results' && cvResult && (
          <div className="bg-white border border-gray-200 rounded-lg p-8">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-gray-900">
                Perfil Identificado
              </h1>
              <span className="bg-purple-100 text-purple-700 text-xs rounded-full px-3 py-1">
                Inferido do currículo
              </span>
            </div>
            <p className="text-gray-600 mb-8">
              Confira as dimensões inferidas a partir do seu currículo. Você pode ajustar
              qualquer valor antes de confirmar.
            </p>

            {/* 4 dimension cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {DIMENSIONS.map((dimension) => {
                const currentValue = selections[dimension.key] || '';
                const reasoning = cvResult.reasoning?.[dimension.key];

                return (
                  <div
                    key={dimension.key}
                    className="bg-white border border-gray-200 rounded-lg p-6"
                  >
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {dimension.label}
                    </label>
                    {reasoning && (
                      <p className="text-xs text-gray-500 mb-3 italic">{reasoning}</p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {dimension.options.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleSelect(dimension.key, opt.value)}
                          className={`p-3 border rounded-lg text-center text-sm transition-all ${
                            currentValue === opt.value
                              ? 'bg-blue-50 border-[#2563eb] text-[#2563eb] font-medium'
                              : 'border-gray-300 hover:border-gray-400 text-gray-700'
                          }`}
                          aria-pressed={currentValue === opt.value}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Separator */}
            <div className="border-t border-gray-200 my-8" />

            {/* Additional questions */}
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Preferências adicionais
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              Essas preferências não podem ser inferidas do currículo. Por favor,
              selecione as opções mais adequadas.
            </p>

            <div className="space-y-6">
              {/* Structure preference */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Preferência de formato
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { value: 'prose', label: 'Prosa corrida' },
                    { value: 'bullets', label: 'Tópicos e bullet points' },
                    { value: 'mixed', label: 'Misto' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setStructurePreference(opt.value)}
                      className={`p-4 border rounded-lg text-center transition-all ${
                        structurePreference === opt.value
                          ? 'bg-blue-50 border-[#2563eb]'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                      aria-pressed={structurePreference === opt.value}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* English comfort */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Termos técnicos em inglês
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { value: 'keep_english', label: 'Manter em inglês' },
                    { value: 'translate', label: 'Traduzir para português' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEnglishComfort(opt.value)}
                      className={`p-4 border rounded-lg text-center transition-all ${
                        englishComfort === opt.value
                          ? 'bg-blue-50 border-[#2563eb]'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                      aria-pressed={englishComfort === opt.value}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Name input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome (pode ser anônimo)"
                  maxLength={255}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                />
              </div>
            </div>

            {/* Registration error */}
            {registerMutation.error && (
              <div className="bg-red-50 text-red-700 p-4 rounded-lg mt-6" role="alert">
                Erro ao criar participante: {(registerMutation.error as Error).message}
              </div>
            )}

            {/* Confirm button */}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!isResultsValid || registerMutation.isPending}
              className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-8"
            >
              {registerMutation.isPending
                ? 'Criando participante...'
                : 'Confirmar e iniciar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
