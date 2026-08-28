import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Link2, Send } from 'lucide-react';
import { shareApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useFilterOptions } from './FilterBar';
import { Callout, Card, CardHeader, EmptyState, LoadingBlock, useToast } from './ui';
import { num, relativeTime } from '../lib/format';
import type { IssuedShareLink } from '../types/api';

/**
 * Cohort-wide link management.
 *
 * Issuing is deliberately additive by default: a student who already has a live
 * link keeps it, because regenerating would silently break links already sitting
 * in inboxes. Regenerating everybody is a separate, explicit choice.
 */
export function ShareLinksSettings({ editable }: { editable: boolean }) {
  const { notify } = useToast();
  const { data: options } = useFilterOptions();
  const queryClient = useQueryClient();

  const [scope, setScope] = useState({ college: '', batch: '', branch: '' });
  const [regenerate, setRegenerate] = useState(false);
  const [issued, setIssued] = useState<IssuedShareLink[] | null>(null);

  const list = useQuery({ queryKey: ['share-links', scope], queryFn: () => shareApi.list(scope) });

  const issue = useMutation({
    mutationFn: () =>
      shareApi.issueMany({
        scope: scope.college || scope.batch || scope.branch ? 'filtered' : 'all',
        ...scope,
        regenerateExisting: regenerate,
      }),
    onSuccess: (result) => {
      setIssued(result.data);
      notify(`Issued ${result.issued} link${result.issued === 1 ? '' : 's'}, skipped ${result.skipped}.`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['share-links'] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  /**
   * The links exist in this browser tab and nowhere else — the server stored
   * only their hashes — so the export has to happen here.
   */
  const downloadCsv = () => {
    if (!issued?.length) return;
    const header = 'Student ID,Name,Email,Link';
    const escape = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const csv = [header, ...issued.map((l) => [l.rollNumber, l.name, l.email, l.url].map(escape).join(','))].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `student-links-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const rows = list.data?.data ?? [];
  const active = rows.filter((r) => r.active).length;
  const opened = rows.filter((r) => r.viewCount > 0).length;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-ink">Student view links</h3>
        <p className="mb-4 mt-0.5 text-xs text-ink-muted">
          A read-only page each student can open without an account, showing their own stats, weak topics and goals.
          Links are stored hashed, so they are shown once when issued and can only be replaced, never recovered.
        </p>

        {!list.data?.configuredBaseUrl && (
          <div className="mb-4">
            <Callout tone="info" title="Links are being built from the CORS origin">
              Set <code className="font-mono text-2xs">APP_BASE_URL</code> to the address students actually reach the app
              on. Right now links point at <span className="font-mono text-2xs">{list.data?.baseUrl || '(unset)'}</span>.
            </Callout>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['college', options?.colleges ?? []],
              ['batch', options?.batches ?? []],
              ['branch', options?.branches ?? []],
            ] as const
          ).map(([field, values]) => (
            <label key={field} className="block">
              <span className="label capitalize">{field}</span>
              <select
                className="input"
                value={scope[field]}
                onChange={(e) => setScope({ ...scope, [field]: e.target.value })}
              >
                <option value="">All</option>
                {values.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        {editable && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={issue.isPending} onClick={() => issue.mutate()}>
              <Send className="h-4 w-4" />
              Issue links
            </button>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input type="checkbox" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} />
              Also replace links already in circulation
            </label>
          </div>
        )}

        {issued && issued.length > 0 && (
          <div className="mt-4">
            <Callout tone="success" title={`${issued.length} link${issued.length === 1 ? '' : 's'} issued — export them now`}>
              These are held in this page only. Once you navigate away they cannot be recovered, only regenerated.
            </Callout>
            <button type="button" className="btn-secondary mt-2" onClick={downloadCsv}>
              <Download className="h-4 w-4" />
              Download CSV for mail merge
            </button>
          </div>
        )}

        {issued && issued.length === 0 && (
          <div className="mt-4">
            <Callout tone="info" title="Nothing to issue">
              Everyone in this selection already has a live link. Tick the replace box if you meant to reissue them.
            </Callout>
          </div>
        )}
      </section>

      <section className="border-t border-line pt-6">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h3 className="text-sm font-semibold text-ink">Who has a link</h3>
          <p className="text-xs text-ink-muted">
            {num(active)} active of {num(rows.length)} students · {num(opened)} opened at least once
          </p>
        </div>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-ink-muted" />
                Link status
              </span>
            }
            subtitle="Whether a link exists and whether it has been used, so an unopened batch is visible."
          />
          {list.isLoading ? (
            <LoadingBlock rows={4} />
          ) : rows.length === 0 ? (
            <EmptyState title="No students match" description="Widen the selection above." />
          ) : (
            <div className="table-wrap max-h-[26rem] overflow-y-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Cohort</th>
                    <th>Link</th>
                    <th>Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link to={`/students/${row.id}`} className="font-medium text-ink hover:text-brand">
                          {row.name}
                        </Link>
                        <span className="block text-2xs text-ink-subtle">{row.studentId}</span>
                      </td>
                      <td className="text-xs text-ink-muted">{[row.batch, row.branch].filter(Boolean).join(' · ')}</td>
                      <td className="text-xs">
                        {!row.hasLink ? (
                          <span className="text-ink-subtle">None</span>
                        ) : row.active ? (
                          <span className="text-positive">Active</span>
                        ) : (
                          <span className="text-ink-muted">{row.revokedAt ? 'Revoked' : 'Expired'}</span>
                        )}
                      </td>
                      <td className="tabular text-xs text-ink-muted">
                        {row.viewCount === 0 ? '—' : `${num(row.viewCount)} · ${relativeTime(row.lastViewedAt)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
