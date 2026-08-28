import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Link2Off, RefreshCw } from 'lucide-react';
import { shareApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Callout, Card, CardHeader, useToast } from './ui';
import { num, relativeTime } from '../lib/format';

/**
 * Issues and revokes the read-only link a student uses to see their own record.
 *
 * The link is shown exactly once, because it is stored hashed — the same
 * treatment refresh tokens get. That is a deliberate friction: the alternative
 * is a table full of live credentials that any database read hands over.
 */
export function ShareLinkPanel({ studentId, studentName }: { studentId: string; studentName: string }) {
  const { can } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const status = useQuery({ queryKey: ['share-link', studentId], queryFn: () => shareApi.status(studentId) });

  const issue = useMutation({
    mutationFn: () => shareApi.issue(studentId),
    onSuccess: (result) => {
      setIssued(result.data.url);
      setCopied(false);
      notify('Link created. Copy it now — it cannot be shown again.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['share-link', studentId] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const revoke = useMutation({
    mutationFn: () => shareApi.revoke(studentId),
    onSuccess: () => {
      setIssued(null);
      notify('Link revoked. It no longer opens.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['share-link', studentId] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const link = status.data;
  const editable = can('TRAINER');

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued);
      setCopied(true);
    } catch {
      notify('Could not copy automatically — select the link and copy it.', 'error');
    }
  };

  return (
    <Card className="mb-5">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-ink-muted" />
            Student view link
          </span>
        }
        subtitle={`A read-only page ${studentName.split(' ')[0]} can open without an account. No contact details or internal notes are on it.`}
        actions={
          editable && (
            <>
              <button type="button" className="btn-secondary" disabled={issue.isPending} onClick={() => issue.mutate()}>
                <RefreshCw className={`h-4 w-4 ${issue.isPending ? 'animate-spin' : ''}`} />
                {link?.active ? 'Regenerate' : 'Create link'}
              </button>
              {link?.active && (
                <button type="button" className="btn-ghost text-negative" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
                  <Link2Off className="h-4 w-4" />
                  Revoke
                </button>
              )}
            </>
          )
        }
      />

      <div className="px-5 py-4">
        {issued && (
          <div className="mb-4">
            <Callout tone="success" title="Copy this now — it will not be shown again">
              The link is stored hashed, so it cannot be recovered later. If it is lost, regenerate — which replaces the
              old one.
            </Callout>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input readOnly value={issued} className="input flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
              <button type="button" className="btn-primary" onClick={() => void copy()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {status.isLoading ? (
          <p className="text-xs text-ink-muted">Checking…</p>
        ) : !link ? (
          <p className="text-sm text-ink-muted">
            No link has been created for this student yet.
            {editable ? '' : ' A trainer or administrator can create one.'}
          </p>
        ) : (
          <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-ink-subtle">Status</dt>
              <dd className={link.active ? 'font-medium text-positive' : 'font-medium text-ink-muted'}>
                {link.revokedAt ? 'Revoked' : link.active ? 'Active' : 'Expired'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Created</dt>
              <dd className="text-ink">
                {relativeTime(link.createdAt)}
                {link.createdBy ? ` by ${link.createdBy}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Opened</dt>
              <dd className="text-ink">
                {link.viewCount === 0
                  ? 'Never opened'
                  : `${num(link.viewCount)} times · last ${relativeTime(link.lastViewedAt)}`}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </Card>
  );
}
