import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload as UploadIcon } from 'lucide-react';
import { uploadsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import {
  Callout, Card, CardHeader, PageHeader, ProgressBar, Spinner, useToast,
} from '../components/ui';
import { num } from '../lib/format';
import type { ColumnMapping, StudentField, UploadPreview } from '../types/api';

type Step = 'select' | 'map' | 'review' | 'done';

export default function UploadPage() {
  const [step, setStep] = useState<Step>('select');
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [result, setResult] = useState<Awaited<ReturnType<typeof uploadsApi.commit>> | null>(null);

  const { notify } = useToast();
  const navigate = useNavigate();
  const fields = useQuery({ queryKey: ['upload-fields'], queryFn: uploadsApi.fields, staleTime: 600_000 });

  const upload = useMutation({
    mutationFn: (file: File) => uploadsApi.create(file),
    onSuccess: (data) => {
      setPreview(data);
      setMapping(data.suggestedMapping);
      setStep('map');
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const revalidate = useMutation({
    mutationFn: (next: ColumnMapping) => uploadsApi.validate(preview!.uploadId, next),
    onSuccess: (data) => {
      setPreview(data);
      setStep('review');
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const commit = useMutation({
    mutationFn: () =>
      uploadsApi.commit(preview!.uploadId, { mapping, startProcessing: true, force: true }),
    onSuccess: (data) => {
      setResult(data);
      setStep('done');
      notify(`Imported ${data.created} new and ${data.updated} existing students.`, 'success');
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const reset = () => {
    setPreview(null);
    setMapping({});
    setResult(null);
    setStep('select');
  };

  return (
    <>
      <PageHeader
        title="Upload students"
        subtitle="Import an Excel or CSV file of students and their coding profile handles."
        actions={step !== 'select' && <button type="button" className="btn-ghost" onClick={reset}>Start over</button>}
      />

      <StepIndicator step={step} />

      {step === 'select' && <SelectStep onFile={(file) => upload.mutate(file)} pending={upload.isPending} />}

      {step === 'map' && preview && (
        <MapStep
          preview={preview}
          mapping={mapping}
          fields={fields.data ?? []}
          onChange={setMapping}
          onBack={reset}
          onNext={() => revalidate.mutate(mapping)}
          pending={revalidate.isPending}
        />
      )}

      {step === 'review' && preview && (
        <ReviewStep
          preview={preview}
          onBack={() => setStep('map')}
          onCommit={() => commit.mutate()}
          pending={commit.isPending}
        />
      )}

      {step === 'done' && result && (
        <Card className="p-6">
          <div className="mb-5 flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-positive" aria-hidden />
            <div>
              <h2 className="text-base font-semibold text-ink">Import complete</h2>
              <p className="mt-0.5 text-sm text-ink-muted">
                {num(result.created)} students created, {num(result.updated)} updated, {num(result.profilesLinked)} platform
                profiles linked{result.skipped > 0 ? `, ${num(result.skipped)} rows skipped because of errors` : ''}.
              </p>
            </div>
          </div>

          {result.job ? (
            <Callout tone="info" title={`Processing job #${result.job.number} started`}>
              Fetching {num(result.job.totalItems)} profiles for {num(result.job.totalStudents)} students. Failures will not
              stop the run — you can retry them afterwards.
            </Callout>
          ) : (
            <Callout tone="warning" title="No processing job was started">
              {result.jobError ?? 'There was nothing to fetch for the imported students.'}
            </Callout>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {result.job && (
              <button type="button" className="btn-primary" onClick={() => navigate(`/jobs/${result.job!.jobId}`)}>
                Watch progress
              </button>
            )}
            <Link to="/students" className="btn-secondary">View students</Link>
            <button type="button" className="btn-ghost" onClick={reset}>Upload another file</button>
          </div>
        </Card>
      )}
    </>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'select', label: 'Choose file' },
    { id: 'map', label: 'Map columns' },
    { id: 'review', label: 'Review' },
    { id: 'done', label: 'Import' },
  ];
  const index = steps.findIndex((s) => s.id === step);

  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2 text-xs">
      {steps.map((entry, i) => (
        <li key={entry.id} className="flex items-center gap-2">
          <span
            className={clsx(
              'flex items-center gap-1.5 rounded-full px-3 py-1 font-medium',
              i < index && 'bg-positive/10 text-positive',
              i === index && 'bg-brand text-white',
              i > index && 'bg-surface-muted text-ink-subtle',
            )}
          >
            <span className="tabular">{i + 1}</span>
            {entry.label}
          </span>
          {i < steps.length - 1 && <span className="text-ink-subtle" aria-hidden>→</span>}
        </li>
      ))}
    </ol>
  );
}

function SelectStep({ onFile, pending }: { onFile: (file: File) => void; pending: boolean }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <Card>
      <div
        className={clsx(
          'flex flex-col items-center justify-center px-6 py-14 text-center transition-colors',
          dragging && 'bg-brand-soft/40',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <FileSpreadsheet className="mb-3 h-10 w-10 text-ink-subtle" aria-hidden />
        <p className="text-sm font-medium text-ink">Drag a spreadsheet here, or choose a file</p>
        <p className="mt-1 max-w-md text-sm text-ink-muted">
          Accepts .xlsx, .xlsm and .csv. The header row is detected automatically, and you can adjust the column mapping
          before anything is imported.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.csv"
          className="sr-only"
          onChange={(event) => handleFiles(event.target.files)}
        />
        <button type="button" className="btn-primary mt-5" disabled={pending} onClick={() => inputRef.current?.click()}>
          {pending ? <Spinner /> : <UploadIcon className="h-4 w-4" />}
          {pending ? 'Reading file…' : 'Choose file'}
        </button>

        <p className="mt-6 max-w-md text-2xs text-ink-subtle">
          Legacy .xls workbooks are not supported — open the file and re-save it as .xlsx or .csv first.
        </p>
      </div>
    </Card>
  );
}

function MapStep({
  preview,
  mapping,
  fields,
  onChange,
  onBack,
  onNext,
  pending,
}: {
  preview: UploadPreview;
  mapping: ColumnMapping;
  fields: { field: StudentField; label: string; required: boolean; description: string }[];
  onChange: (mapping: ColumnMapping) => void;
  onBack: () => void;
  onNext: () => void;
  pending: boolean;
}) {
  const usedFields = useMemo(
    () => new Set(Object.values(mapping).filter(Boolean) as StudentField[]),
    [mapping],
  );

  const missingRequired = fields.filter((f) => f.required && !usedFields.has(f.field));
  const platformsMapped = fields.filter((f) => f.field.endsWith('_username') && usedFields.has(f.field));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={`Map the columns in “${preview.originalName}”`}
          subtitle={`Sheet “${preview.sheetName}” · header detected on row ${preview.headerRowNumber} · ${num(preview.totalRows)} data rows`}
        />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Spreadsheet column</th>
                <th>Maps to</th>
                <th>Sample values</th>
              </tr>
            </thead>
            <tbody>
              {preview.headers.map((header) => {
                const samples = preview.previewRows.slice(0, 3).map((row) => row[header]).filter(Boolean);
                return (
                  <tr key={header}>
                    <td className="font-medium">{header}</td>
                    <td>
                      <select
                        className="input py-1.5 text-xs"
                        value={mapping[header] ?? ''}
                        onChange={(event) =>
                          onChange({ ...mapping, [header]: (event.target.value || null) as StudentField | null })
                        }
                      >
                        <option value="">— Ignore this column —</option>
                        {fields.map((field) => (
                          <option
                            key={field.field}
                            value={field.field}
                            disabled={usedFields.has(field.field) && mapping[header] !== field.field}
                          >
                            {field.label}{field.required ? ' (required)' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="max-w-sm truncate text-xs text-ink-muted" title={samples.join(', ')}>
                      {samples.length > 0 ? samples.join(', ') : <span className="text-ink-subtle">empty</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {missingRequired.length > 0 && (
        <Callout tone="danger" title="Required columns are not mapped">
          {missingRequired.map((f) => f.label).join(', ')} must be mapped before the file can be imported.
        </Callout>
      )}

      {platformsMapped.length === 0 && (
        <Callout tone="warning" title="No platform column is mapped">
          Students will be imported, but there will be no coding profile handles to fetch.
        </Callout>
      )}

      <div className="flex justify-between">
        <button type="button" className="btn-ghost" onClick={onBack}>Back</button>
        <button type="button" className="btn-primary" disabled={missingRequired.length > 0 || pending} onClick={onNext}>
          {pending && <Spinner />}
          Validate {num(preview.totalRows)} rows
        </button>
      </div>
    </div>
  );
}

function ReviewStep({
  preview,
  onBack,
  onCommit,
  pending,
}: {
  preview: UploadPreview;
  onBack: () => void;
  onCommit: () => void;
  pending: boolean;
}) {
  const validation = preview.validation;
  const errors = validation.issues.filter((issue) => issue.severity === 'error');
  const warnings = validation.issues.filter((issue) => issue.severity === 'warning');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryTile label="Rows in file" value={num(validation.totalRows)} />
        <SummaryTile label="Will import" value={num(validation.validRows)} tone="positive" />
        <SummaryTile label="Will be skipped" value={num(validation.invalidRows)} tone={validation.invalidRows > 0 ? 'negative' : undefined} />
        <SummaryTile label="Warnings" value={num(warnings.length)} tone={warnings.length > 0 ? 'caution' : undefined} />
      </div>

      <Card>
        <CardHeader title="Platform coverage" subtitle="How many rows carry a usable handle per platform" />
        <div className="space-y-3 p-5">
          {Object.entries(validation.summary.platformCounts).map(([platform, count]) => (
            <div key={platform} className="flex items-center gap-3">
              <span className="w-28 text-xs font-medium text-ink">{platform}</span>
              <div className="flex-1"><ProgressBar value={count} max={Math.max(1, validation.totalRows)} /></div>
              <span className="tabular w-24 text-right text-xs text-ink-muted">
                {num(count)} / {num(validation.totalRows)}
              </span>
            </div>
          ))}
          {validation.summary.rowsWithNoPlatform > 0 && (
            <p className="pt-1 text-2xs text-ink-subtle">
              {num(validation.summary.rowsWithNoPlatform)} rows have no usable handle. They will still be imported, but
              there will be nothing to fetch for them.
            </p>
          )}
        </div>
      </Card>

      {errors.length > 0 && (
        <Card>
          <CardHeader
            title={`${num(errors.length)} rows will be skipped`}
            subtitle="These rows have errors that prevent import"
            actions={<AlertTriangle className="h-4 w-4 text-negative" />}
          />
          <IssueTable issues={errors} />
        </Card>
      )}

      {validation.duplicateUsernames.length > 0 && (
        <Callout tone="warning" title="Duplicate handles detected">
          {validation.duplicateUsernames.slice(0, 5).map((duplicate) => (
            <p key={`${duplicate.platform}-${duplicate.username}`}>
              {duplicate.platform} handle <span className="font-medium">{duplicate.username}</span> is shared by rows{' '}
              {duplicate.rows.join(', ')}.
            </p>
          ))}
          <p className="mt-1">These rows will still be imported — the same handle will simply be fetched once per student.</p>
        </Callout>
      )}

      {warnings.length > 0 && (
        <Card>
          <CardHeader title={`${num(warnings.length)} warnings`} subtitle="These rows will still be imported" />
          <IssueTable issues={warnings.slice(0, 100)} />
        </Card>
      )}

      <Card>
        <CardHeader title="Preview" subtitle="First rows as they will be read" />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                {preview.headers.map((header) => (
                  <th key={header}>
                    {header}
                    <span className="mt-0.5 block font-normal normal-case text-ink-subtle">
                      {preview.suggestedMapping[header] ?? 'ignored'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.previewRows.map((row, index) => {
                const rowInfo = validation.rows[index];
                return (
                  <tr key={index} className={rowInfo && !rowInfo.valid ? 'bg-negative/5' : undefined}>
                    <td className="tabular text-xs text-ink-subtle">{index + 1}</td>
                    {preview.headers.map((header) => (
                      <td key={header} className="max-w-[12rem] truncate text-xs" title={row[header]}>
                        {row[header] || <span className="text-ink-subtle">—</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex justify-between">
        <button type="button" className="btn-ghost" onClick={onBack}>Back to mapping</button>
        <button type="button" className="btn-primary" disabled={validation.validRows === 0 || pending} onClick={onCommit}>
          {pending && <Spinner />}
          Import {num(validation.validRows)} students and start fetching
        </button>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' | 'caution' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className={clsx(
          'tabular mt-1.5 text-2xl font-semibold',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          tone === 'caution' && 'text-caution',
          !tone && 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function IssueTable({ issues }: { issues: { row: number; field?: string; code: string; message: string }[] }) {
  return (
    <div className="table-wrap max-h-80 overflow-y-auto">
      <table className="table">
        <thead>
          <tr><th>Row</th><th>Field</th><th>Issue</th></tr>
        </thead>
        <tbody>
          {issues.map((issue, index) => (
            <tr key={`${issue.row}-${issue.code}-${index}`}>
              <td className="tabular">{issue.row}</td>
              <td className="text-xs text-ink-muted">{issue.field ?? '—'}</td>
              <td className="text-xs">{issue.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
