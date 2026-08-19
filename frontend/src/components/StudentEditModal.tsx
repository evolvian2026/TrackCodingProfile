import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { studentsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { Callout, Modal, Spinner, useToast } from './ui';
import type { Platform, StudentDetail } from '../types/api';

const PLATFORMS: { key: Platform; label: string; placeholder: string }[] = [
  { key: 'LEETCODE', label: 'LeetCode', placeholder: 'username or profile URL' },
  { key: 'CODECHEF', label: 'CodeChef', placeholder: 'username or profile URL' },
  { key: 'HACKERRANK', label: 'HackerRank', placeholder: 'username or profile URL' },
  { key: 'CODEFORCES', label: 'Codeforces', placeholder: 'handle or profile URL' },
];

const TEXT_FIELDS = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['university', 'University'],
  ['college', 'College'],
  ['batch', 'Batch'],
  ['branch', 'Branch'],
  ['section', 'Section'],
] as const;

/**
 * Edit a student's details and platform handles, or delete them.
 *
 * Clearing a handle removes that platform profile and everything fetched for
 * it; changing a handle marks the profile as needing a fresh fetch, because the
 * stored statistics belong to the old account.
 */
export function StudentEditModal({
  student,
  open,
  onClose,
}: {
  student: StudentDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(TEXT_FIELDS.map(([key]) => [key, (student[key] as string | null) ?? ''])),
  );
  const [handles, setHandles] = useState<Record<string, string>>(() =>
    Object.fromEntries(PLATFORMS.map((p) => [p.key, student.platforms.find((x) => x.platform === p.key)?.username ?? ''])),
  );

  const save = useMutation({
    mutationFn: () =>
      studentsApi.update(student.id, {
        ...Object.fromEntries(
          TEXT_FIELDS.map(([key]) => [key, key === 'name' ? fields.name!.trim() : (fields[key]?.trim() || null)]),
        ),
        handles: Object.fromEntries(PLATFORMS.map((p) => [p.key, handles[p.key]?.trim() || null])),
      }),
    onSuccess: () => {
      notify('Student updated. Changed handles will be fetched on the next refresh.', 'success');
      queryClient.invalidateQueries({ queryKey: ['student', student.id] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const remove = useMutation({
    mutationFn: () => studentsApi.remove(student.id),
    onSuccess: () => {
      notify(`${student.name} deleted.`, 'success');
      queryClient.invalidateQueries({ queryKey: ['students'] });
      navigate('/students');
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const changedHandles = PLATFORMS.filter(
    (p) => (handles[p.key]?.trim() ?? '') !== (student.platforms.find((x) => x.platform === p.key)?.username ?? ''),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${student.name}`}
      wide
      footer={
        <>
          <button
            type="button"
            className="btn-danger mr-auto"
            disabled={remove.isPending}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete student
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={save.isPending || !fields.name?.trim()} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />}
            Save changes
          </button>
        </>
      }
    >
      {confirmingDelete ? (
        <div className="space-y-4">
          <Callout tone="danger" title={`Delete ${student.name}?`}>
            This permanently removes the student and everything fetched for them — platform profiles, solved problems,
            contest results, rating history and snapshots. It cannot be undone.
          </Callout>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirmingDelete(false)}>Keep student</button>
            <button type="button" className="btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending && <Spinner />}
              Yes, delete permanently
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink">Details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">Student ID</span>
                <input className="input" value={student.studentId} disabled />
                <span className="mt-1 block text-2xs text-ink-subtle">
                  The identifier rows are matched on during import — it cannot be changed here.
                </span>
              </label>
              {TEXT_FIELDS.map(([key, label]) => (
                <label key={key} className="block">
                  <span className="label">
                    {label}
                    {key === 'name' && <span className="ml-1 text-negative">*</span>}
                  </span>
                  <input
                    className="input"
                    type={key === 'email' ? 'email' : 'text'}
                    value={fields[key] ?? ''}
                    onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="border-t border-line pt-5">
            <h3 className="text-sm font-semibold text-ink">Platform handles</h3>
            <p className="mb-3 mt-0.5 text-xs text-ink-muted">
              A username or a full profile URL. Leave blank to remove the platform for this student.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {PLATFORMS.map((platform) => (
                <label key={platform.key} className="block">
                  <span className="label">{platform.label}</span>
                  <input
                    className="input"
                    placeholder={platform.placeholder}
                    value={handles[platform.key] ?? ''}
                    onChange={(event) => setHandles({ ...handles, [platform.key]: event.target.value })}
                  />
                </label>
              ))}
            </div>

            {changedHandles.length > 0 && (
              <div className="mt-4">
                <Callout tone="warning" title="Changed handles need a fresh fetch">
                  {changedHandles.map((p) => p.label).join(', ')} will be marked as not fetched. Statistics already stored
                  belong to the previous account, so run a refresh after saving.
                </Callout>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
