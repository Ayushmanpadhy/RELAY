import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Sparkles,
  UploadCloud,
  FileText,
  FileSpreadsheet,
  FileArchive,
  AlertCircle,
  HelpCircle,
  Cpu,
  CheckCircle2,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, type RequestDraftResponse } from '../api/client';
import { useRelayStore } from '../store/relayStore';

interface NewJobModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewJobModal({ isOpen, onClose }: NewJobModalProps) {
  const navigate = useNavigate();
  const { workloads } = useRelayStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab: 'v3_pipeline' (AI Pipeline) | 'legacy_benchmark'
  const [activeTab, setActiveTab] = useState<'v3_pipeline' | 'legacy_benchmark'>('v3_pipeline');

  // V3 Pipeline State
  const [step, setStep] = useState<'input' | 'plan_review'>('input');
  const [brief, setBrief] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [virtualSampleType, setVirtualSampleType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plan Review State
  const [draft, setDraft] = useState<RequestDraftResponse | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [confirmCost, setConfirmCost] = useState(false);
  const [replanBrief, setReplanBrief] = useState('');
  const [isReplanning, setIsReplanning] = useState(false);

  // Legacy Workload State
  const [selectedType, setSelectedType] = useState<'primes' | 'pi' | 'wordcount'>('primes');
  const [selectedSize, setSelectedSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [priority, setPriority] = useState<number>(1);
  const [customText, setCustomText] = useState<string>('');

  if (!isOpen) return null;

  // Handle sample chips
  const handleApplyChip = (type: 'reviews' | 'csv' | 'images') => {
    setVirtualSampleType(type);
    setError(null);

    if (type === 'reviews') {
      setBrief('Read all 40 customer reviews, extract sentiment, key themes, and top complaints, then synthesize an executive summary report in Markdown.');
      // Create synthetic review files for demo upload
      const syntheticFiles = Array.from({ length: 40 }, (_, i) => {
        const content = `Customer Review #${i + 1}\nProduct: PulseMetrics Platform\nSentiment: ${i % 3 === 0 ? 'Critical' : 'Positive'}\nComments: System reliability and dashboard response times have been exceptional.`;
        return new File([content], `customer_review_${String(i + 1).padStart(2, '0')}.txt`, { type: 'text/plain' });
      });
      setFiles(syntheticFiles);
    } else if (type === 'csv') {
      setBrief('Clean and deduplicate 5,000 messy lead rows, trim whitespace from text columns, drop empty records, and format as CSV.');
      const syntheticCsv = 'id,first_name,last_name,email,company,country\n1, John , Smith , john.smith@acme.com , Acme Corp , US \n2, Mary , Johnson , mary.j@fintech.io , FinTech Labs , UK \n';
      const file = new File([syntheticCsv], 'messy_leads.csv', { type: 'text/csv' });
      setFiles([file]);
    } else if (type === 'images') {
      setBrief('Resize all 12 uploaded product photos to standard 800px width maintaining aspect ratio and package into a ZIP archive.');
      const syntheticImages = Array.from({ length: 12 }, (_, i) => {
        return new File(['fake_image_bytes'], `product_photo_${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' });
      });
      setFiles(syntheticImages);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      setFiles(prev => [...prev, ...selected]);
      setVirtualSampleType(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const dropped = Array.from(e.dataTransfer.files);
      setFiles(prev => [...prev, ...dropped]);
      setVirtualSampleType(null);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    if (files.length <= 1) setVirtualSampleType(null);
  };

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const formattedSize = totalBytes > 1024 * 1024
    ? `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(totalBytes / 1024)} KB`;

  // Step 1: Submit Request for Planning
  const handleGeneratePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brief.trim()) {
      setError('Please provide a brief describing what you want done.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('brief', brief.trim());
      files.forEach((f) => {
        formData.append('files', f);
      });

      const response = await api.createRequestMultipart(formData);
      setDraft(response);
      setReplanBrief(brief);
      setAnswers(response.plan.questions?.map(() => '') || []);
      setStep('plan_review');
    } catch (err: any) {
      setError(err.message || 'Failed to generate plan');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Approve & Launch
  const handleApprovePlan = async () => {
    if (!draft) return;
    setLoading(true);
    setError(null);

    try {
      await api.approvePlan(draft.jobId, confirmCost);
      onClose();
      navigate(`/app/jobs/${draft.jobId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to approve plan');
    } finally {
      setLoading(false);
    }
  };

  // Handle Re-plan
  const handleReplan = async () => {
    if (!draft || !replanBrief.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await api.replan(draft.jobId, replanBrief.trim());
      setDraft({
        ...draft,
        plan: res.plan,
        estCost: res.estCost,
        estTasks: res.estTasks,
      });
      setIsReplanning(false);
      setAnswers(res.plan.questions?.map(() => '') || []);
    } catch (err: any) {
      setError(err.message || 'Failed to re-plan');
    } finally {
      setLoading(false);
    }
  };

  // Handle Answers submission
  const handleSubmitAnswers = async () => {
    if (!draft) return;
    setLoading(true);
    setError(null);

    try {
      const res = await api.submitAnswers(draft.jobId, answers);
      setDraft({
        ...draft,
        plan: res.plan,
        estCost: res.estCost,
        estTasks: res.estTasks,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to update plan with answers');
    } finally {
      setLoading(false);
    }
  };

  // Handle Legacy Workload Submit
  const handleLegacySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const currentWorkload = workloads.find((w) => w.type === selectedType);
      const presetParams = currentWorkload?.presets[selectedSize] || {};
      const finalParams = { ...presetParams };
      if (selectedType === 'wordcount' && customText.trim().length > 0) {
        finalParams.text = customText.trim();
      }

      const job = await api.createJob(selectedType, finalParams, priority);
      onClose();
      navigate(`/app/jobs/${job.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to submit job');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-bg/85 backdrop-blur-sm"
        />

        {/* Modal Dialog */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-card bg-surface border border-line shadow-2xl p-6 z-10 flex flex-col gap-5 text-text-base"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-btn bg-accent/10 text-accent">
                <Sparkles size={20} />
              </div>
              <div>
                <h2 className="text-heading font-medium text-text-base">
                  {step === 'plan_review' ? 'Review Execution Plan' : 'New Distributed Request'}
                </h2>
                <p className="text-tiny text-text-dim">
                  {step === 'plan_review'
                    ? 'Inspect the AI breakdown and estimated cost before launching workers.'
                    : 'Upload files and describe what you want done.'}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1 rounded-btn text-text-dim hover:text-text-base hover:bg-surface-2 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Navigation Tabs (only on input step) */}
          {step === 'input' && (
            <div className="flex rounded-btn bg-surface-2 p-1 border border-line">
              <button
                type="button"
                onClick={() => { setActiveTab('v3_pipeline'); setError(null); }}
                className={`flex-1 py-1.5 px-3 text-caption font-medium rounded-btn transition-colors flex items-center justify-center gap-2 ${
                  activeTab === 'v3_pipeline' ? 'bg-surface text-accent shadow-sm' : 'text-text-dim hover:text-text-base'
                }`}
              >
                <Sparkles size={14} /> AI Pipeline (V3)
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('legacy_benchmark'); setError(null); }}
                className={`flex-1 py-1.5 px-3 text-caption font-medium rounded-btn transition-colors flex items-center justify-center gap-2 ${
                  activeTab === 'legacy_benchmark' ? 'bg-surface text-accent shadow-sm' : 'text-text-dim hover:text-text-base'
                }`}
              >
                <Cpu size={14} /> Compute Benchmark
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 bg-bad/10 border border-bad/30 rounded-btn flex items-center gap-2.5 text-bad text-caption font-mono">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Tab 1: AI Pipeline Input */}
          {activeTab === 'v3_pipeline' && step === 'input' && (
            <form onSubmit={handleGeneratePlan} className="flex flex-col gap-5">
              {/* Prompt Textarea */}
              <div className="flex flex-col gap-2">
                <label className="text-caption font-medium text-text-base">
                  What do you want to accomplish?
                </label>
                <textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="Tell us what you want to do with these files... (e.g. Read all customer reviews, extract sentiment and top 3 complaints, output an executive summary markdown document)"
                  rows={3}
                  className="w-full bg-surface-2 border border-line rounded-btn p-3 text-body font-sans text-text-base placeholder:text-text-dim/60 focus:outline-none focus:border-accent transition-colors resize-none"
                />

                {/* Example Chips */}
                <div className="flex flex-col gap-1.5 mt-1">
                  <span className="text-[11px] text-text-dim font-mono uppercase tracking-wider">Example Templates:</span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleApplyChip('reviews')}
                      className={`text-tiny px-2.5 py-1 rounded-full border transition-all text-left ${
                        virtualSampleType === 'reviews'
                          ? 'border-accent bg-accent/10 text-accent font-medium'
                          : 'border-line bg-surface-2 text-text-dim hover:border-text-dim/50'
                      }`}
                    >
                      📄 Summarize 40 customer reviews → MD Report
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyChip('csv')}
                      className={`text-tiny px-2.5 py-1 rounded-full border transition-all text-left ${
                        virtualSampleType === 'csv'
                          ? 'border-accent bg-accent/10 text-accent font-medium'
                          : 'border-line bg-surface-2 text-text-dim hover:border-text-dim/50'
                      }`}
                    >
                      📊 Clean 5,000 messy lead rows → CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyChip('images')}
                      className={`text-tiny px-2.5 py-1 rounded-full border transition-all text-left ${
                        virtualSampleType === 'images'
                          ? 'border-accent bg-accent/10 text-accent font-medium'
                          : 'border-line bg-surface-2 text-text-dim hover:border-text-dim/50'
                      }`}
                    >
                      🖼️ Resize 12 product photos to 800px → ZIP
                    </button>
                  </div>
                </div>
              </div>

              {/* File Dropzone */}
              <div className="flex flex-col gap-2">
                <label className="text-caption font-medium text-text-base flex items-center justify-between">
                  <span>Attached Files / Archives</span>
                  {files.length > 0 && (
                    <span className="text-tiny font-mono text-text-dim">
                      {files.length} file{files.length === 1 ? '' : 's'} ({formattedSize})
                    </span>
                  )}
                </label>

                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-line hover:border-accent/60 bg-surface-2/60 rounded-btn p-5 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <UploadCloud size={28} className="text-text-dim" />
                  <p className="text-caption text-text-base text-center">
                    Drag and drop files or ZIP archives here, or <span className="text-accent underline">browse</span>
                  </p>
                  <p className="text-tiny text-text-dim text-center">
                    Supports TXT, CSV, JSON, MD, DOCX, PDF, PNG, JPG (up to 500 MB)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>

                {/* File Pills */}
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-1">
                    {files.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 bg-surface-2 border border-line px-2.5 py-1 rounded-btn text-tiny font-mono text-text-base"
                      >
                        <FileText size={14} className="text-accent shrink-0" />
                        <span className="truncate max-w-[200px]">{file.name}</span>
                        <span className="text-text-dim text-[11px]">
                          ({file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(file.size / 1024)} KB`})
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(idx);
                          }}
                          className="text-text-dim hover:text-bad ml-1"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <div className="flex justify-end pt-2 border-t border-line">
                <button
                  type="submit"
                  disabled={loading || !brief.trim()}
                  className="bg-accent text-bg px-5 py-2.5 rounded-btn font-medium text-caption hover:bg-accent/90 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {loading ? (
                    <>Analyzing files & planning...</>
                  ) : (
                    <>
                      <span>Generate Plan</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Tab 1: Step 2 Plan Review */}
          {activeTab === 'v3_pipeline' && step === 'plan_review' && draft && (
            <div className="flex flex-col gap-5">
              {/* Understanding Banner */}
              <div className="p-4 bg-accent/10 border border-accent/20 rounded-btn flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-accent font-medium text-caption">
                  <Sparkles size={16} />
                  <span>AI Understanding</span>
                </div>
                <p className="text-body text-text-base font-sans">
                  {draft.plan.understanding}
                </p>
                <p className="text-tiny text-text-dim font-sans mt-1">
                  {draft.plan.userSummary}
                </p>
              </div>

              {/* Strategy & Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-caption font-mono">
                <div className="bg-surface-2 p-3 rounded-btn border border-line">
                  <span className="text-text-dim text-[11px] block">Strategy</span>
                  <span className="text-text-base font-medium capitalize mt-1 block">
                    {draft.plan.strategy.replace('_', ' ')}
                  </span>
                </div>
                <div className="bg-surface-2 p-3 rounded-btn border border-line">
                  <span className="text-text-dim text-[11px] block">Estimated Tasks</span>
                  <span className="text-text-base font-medium mt-1 block">
                    ~{draft.estTasks} tasks
                  </span>
                </div>
                <div className="bg-surface-2 p-3 rounded-btn border border-line">
                  <span className="text-text-dim text-[11px] block">Map Operation</span>
                  <span className="text-accent font-medium uppercase mt-1 block">
                    {draft.plan.map.op} {draft.plan.map.tool ? `(${draft.plan.map.tool})` : ''}
                  </span>
                </div>
                <div className="bg-surface-2 p-3 rounded-btn border border-line">
                  <span className="text-text-dim text-[11px] block">Estimated Cost</span>
                  <span className="text-ok font-medium mt-1 block">
                    ${draft.estCost.toFixed(4)} USD
                  </span>
                </div>
              </div>

              {/* Deliverable Info */}
              <div className="bg-surface-2 p-3.5 rounded-btn border border-line flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface rounded-btn text-accent">
                    {draft.plan.deliverable.format === 'csv' || draft.plan.deliverable.format === 'xlsx' ? (
                      <FileSpreadsheet size={18} />
                    ) : draft.plan.deliverable.format === 'zip' ? (
                      <FileArchive size={18} />
                    ) : (
                      <FileText size={18} />
                    )}
                  </div>
                  <div>
                    <span className="font-mono text-caption text-text-base font-medium">
                      {draft.plan.deliverable.filename}
                    </span>
                    <span className="text-tiny text-text-dim block">
                      {draft.plan.deliverable.description}
                    </span>
                  </div>
                </div>
                <span className="font-mono text-tiny px-2.5 py-1 bg-surface rounded-full text-accent uppercase font-medium border border-line">
                  {draft.plan.deliverable.format}
                </span>
              </div>

              {/* Questions (if planner returned any) */}
              {Array.isArray(draft.plan.questions) && draft.plan.questions.length > 0 && (
                <div className="p-4 bg-surface-2 border border-line rounded-btn flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-text-base font-medium text-caption">
                    <HelpCircle size={16} className="text-accent" />
                    <span>Clarifying Questions</span>
                  </div>
                  {draft.plan.questions.map((q, idx) => (
                    <div key={idx} className="flex flex-col gap-1.5">
                      <label className="text-tiny text-text-dim">{q}</label>
                      <input
                        type="text"
                        value={answers[idx] || ''}
                        onChange={(e) => {
                          const updated = [...answers];
                          updated[idx] = e.target.value;
                          setAnswers(updated);
                        }}
                        placeholder="Your answer..."
                        className="bg-surface border border-line rounded-btn px-3 py-1.5 text-caption font-sans text-text-base focus:outline-none focus:border-accent"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleSubmitAnswers}
                    disabled={loading}
                    className="self-end px-3 py-1 bg-surface border border-line hover:border-accent rounded-btn text-tiny text-accent font-medium transition-colors"
                  >
                    Update Plan with Answers
                  </button>
                </div>
              )}

              {/* Cost Confirmation if > $5 */}
              {draft.estCost > 5.0 && (
                <div className="p-3 bg-warn/10 border border-warn/30 rounded-btn flex items-center gap-3 text-caption">
                  <input
                    type="checkbox"
                    id="confirmCostCheck"
                    checked={confirmCost}
                    onChange={(e) => setConfirmCost(e.target.checked)}
                    className="w-4 h-4 rounded text-accent"
                  />
                  <label htmlFor="confirmCostCheck" className="text-warn font-medium cursor-pointer">
                    I confirm the estimated cost of ${draft.estCost.toFixed(2)} USD exceeds the standard $5.00 limit.
                  </label>
                </div>
              )}

              {/* Re-plan Drawer */}
              {isReplanning && (
                <div className="p-3 bg-surface-2 border border-line rounded-btn flex flex-col gap-2">
                  <label className="text-tiny font-medium text-text-dim">Adjust Brief:</label>
                  <textarea
                    value={replanBrief}
                    onChange={(e) => setReplanBrief(e.target.value)}
                    rows={2}
                    className="w-full bg-surface border border-line rounded-btn p-2 text-caption font-sans text-text-base focus:outline-none focus:border-accent resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsReplanning(false)}
                      className="px-2.5 py-1 text-tiny text-text-dim hover:text-text-base"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleReplan}
                      disabled={loading || !replanBrief.trim()}
                      className="px-3 py-1 bg-accent text-bg rounded-btn text-tiny font-medium"
                    >
                      Regenerate Plan
                    </button>
                  </div>
                </div>
              )}

              {/* Review Actions */}
              <div className="flex items-center justify-between pt-3 border-t border-line">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('input')}
                    className="px-3 py-2 border border-line bg-surface hover:bg-surface-2 rounded-btn text-caption text-text-dim hover:text-text-base transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsReplanning(!isReplanning)}
                    className="px-3 py-2 border border-line bg-surface hover:bg-surface-2 rounded-btn text-caption text-text-dim hover:text-text-base transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw size={14} />
                    <span>Re-plan</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleApprovePlan}
                  disabled={loading || (draft.estCost > 5.0 && !confirmCost)}
                  className="bg-ok text-bg font-medium px-5 py-2.5 rounded-btn text-caption hover:bg-ok/90 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {loading ? (
                    <>Launching tasks...</>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      <span>Approve & Run</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Tab 2: Legacy Benchmark Form */}
          {activeTab === 'legacy_benchmark' && (
            <form onSubmit={handleLegacySubmit} className="flex flex-col gap-5">
              <div>
                <label className="text-tiny uppercase tracking-wider text-text-dim font-medium block mb-2">
                  Workload Type
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { type: 'primes', title: 'Primes', desc: 'Interval search' },
                    { type: 'pi', title: 'Monte Carlo π', desc: 'Sampling' },
                    { type: 'wordcount', title: 'Word Count', desc: 'Text partitioning' },
                  ].map((w) => (
                    <button
                      key={w.type}
                      type="button"
                      onClick={() => setSelectedType(w.type as any)}
                      className={`p-3 rounded-btn border text-left transition-all ${
                        selectedType === w.type
                          ? 'border-accent bg-accent/10 text-accent font-medium'
                          : 'border-line bg-surface-2 text-text-dim hover:border-text-dim/50'
                      }`}
                    >
                      <div className="font-mono text-caption text-text-base">{w.title}</div>
                      <div className="text-[11px] text-text-dim mt-0.5">{w.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-tiny uppercase tracking-wider text-text-dim font-medium block mb-2">
                  Size Preset
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {(['small', 'medium', 'large'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSelectedSize(s)}
                      className={`py-2 px-3 rounded-btn border text-center font-mono text-caption capitalize transition-all ${
                        selectedSize === s
                          ? 'border-accent bg-accent/10 text-accent font-medium'
                          : 'border-line bg-surface-2 text-text-dim hover:border-text-dim/50'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {selectedType === 'wordcount' && (
                <div>
                  <label className="text-tiny uppercase tracking-wider text-text-dim font-medium block mb-1">
                    Custom Text (Optional)
                  </label>
                  <textarea
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="Paste custom text to analyze frequencies..."
                    rows={3}
                    className="w-full bg-surface-2 border border-line rounded-btn p-3 text-caption font-mono text-text-base placeholder:text-text-dim/60 focus:outline-none focus:border-accent"
                  />
                </div>
              )}

              <div>
                <label className="text-tiny uppercase tracking-wider text-text-dim font-medium block mb-2">
                  Priority
                </label>
                <div className="flex gap-2 font-mono text-caption">
                  {[
                    { val: 0, label: 'Low (0)' },
                    { val: 1, label: 'Normal (1)' },
                    { val: 2, label: 'High (2)' },
                  ].map((p) => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setPriority(p.val)}
                      className={`flex-1 py-1.5 px-3 rounded-btn border text-center transition-all ${
                        priority === p.val
                          ? 'border-accent bg-accent text-bg font-medium'
                          : 'border-line bg-surface-2 text-text-dim hover:border-text-dim/50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-line">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-accent text-bg px-5 py-2 rounded-btn font-medium text-caption hover:bg-accent/90 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  <Cpu size={16} />
                  <span>Launch Benchmark Job</span>
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
