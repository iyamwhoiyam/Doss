import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Avatar, Badge, Card, CardHead, CopyButton, DataTable, Field, Flag, KeyValue,
  Loading, Modal, Section, Select, Tabs, TextInput, Toggle, type Column,
} from '../components/ui';
import { api, qs, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useRealtime } from '../lib/realtime';
import { dateTime, fileSize, number, relative } from '../lib/format';
import { ROLE_KEYS, ROLES } from '@shared/domain';
import type { Setting, User } from '../lib/types';

interface Health {
  database: {
    dir: string; totalRecords: number; bytes: number; bytesHuman: string;
    pendingWrites: number; writesSinceBoot: number; engine: string; durability: string;
    collections: Record<string, { records: number; live: number; deleted: number; bytes: number }>;
    backups: { count: number; latest: string | null };
  };
  files: { files: number; bytes: number; bytesHuman: string; path: string };
  audit: { files: number; bytes: number; bytesHuman: string; path: string };
  backups: { files: number; bytesHuman: string; path: string };
  realtime: { connections: number; online: number };
  process: { uptimeSeconds: number; nodeVersion: string; memoryMb: number; pid: number };
}

interface AuditEntry {
  at: string; collection: string; op: string; id: string;
  actorId: string; actorName: string; reason: string | null;
  changes?: { field: string; from: unknown; to: unknown }[];
}

export function Admin() {
  const queryClient = useQueryClient();
  const { error, success, confirm } = useUi();
  const { user } = useSession();
  const { online } = useRealtime();
  useViewing('the admin console');

  const [tab, setTab] = useState('health');
  const [auditCollection, setAuditCollection] = useState('');
  const [newUserOpen, setNewUserOpen] = useState(false);

  const { data: health, isLoading } = useQuery<Health>({
    queryKey: ['admin', 'health'],
    queryFn: () => api.get<Health>('/admin/health'),
    refetchInterval: 20_000,
  });

  const { data: users } = useList<User>('users', { sort: 'name', limit: 200 });
  const { data: settings } = useList<Setting>('settings', { sort: 'key', limit: 200 });

  const { data: audit } = useQuery<{ entries: AuditEntry[] }>({
    queryKey: ['admin', 'audit', auditCollection],
    queryFn: () => api.get(`/admin/audit${qs({ days: 30, limit: 300, collection: auditCollection || undefined })}`),
    enabled: tab === 'audit',
  });

  const { data: sessions } = useQuery<{ rows: { id: string; userName: string; ip: string; userAgent: string; lastSeenAt: string; expiresAt: string }[] }>({
    queryKey: ['admin', 'sessions'],
    queryFn: () => api.get('/auth/sessions'),
    enabled: tab === 'access',
  });

  const backup = async () => {
    try {
      const result = await api.post<{ stamp: string; collections: number }>('/admin/backup', {});
      success('Backup taken', `${result.collections} collections copied to ${result.stamp}`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'health'] });
    } catch (err) { error(err); }
  };

  const checkpoint = async () => {
    try {
      await api.post('/admin/checkpoint', {});
      success('Checkpoint written', 'Every pending write is now on disk.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'health'] });
    } catch (err) { error(err); }
  };

  const resetPassword = async (target: User) => {
    const confirmed = await confirm({
      title: `Reset ${target.name}'s password`,
      body: 'A temporary password is issued and every session they have open is signed out. They must choose a new password at their next sign-in.',
      confirmLabel: 'Reset it',
      tone: 'warning',
    });
    if (!confirmed) return;
    try {
      const result = await api.post<{ temporaryPassword: string }>(`/auth/users/${target.id}/reset-password`, {});
      success('Password reset', `Temporary password: ${result.temporaryPassword}`);
    } catch (err) { error(err); }
  };

  const toggleActive = async (target: User) => {
    try {
      await api.post(`/admin/users/${target.id}/${target.active ? 'deactivate' : 'activate'}`, {});
      queryClient.invalidateQueries({ queryKey: ['collection', 'users'] });
    } catch (err) { error(err); }
  };

  const userColumns: Column<User>[] = [
    { key: 'name', header: 'Person', sortValue: (row) => row.name, render: (row) => (
      <div className="row-tight">
        <Avatar name={row.name} color={row.accentColor} />
        <div style={{ minWidth: 0 }}>
          <div className="cell-primary truncate">{row.name}</div>
          <div className="cell-sub truncate">{row.email}</div>
        </div>
        {online.some((person) => person.id === row.id) && <span className="live-dot" title="Online now" />}
      </div>
    ) },
    { key: 'role', header: 'Role', sortValue: (row) => row.role, render: (row) => <Badge tone="info">{ROLES[row.role]?.label ?? row.role}</Badge> },
    { key: 'title', header: 'Title', sortValue: (row) => row.title, render: (row) => row.title },
    { key: 'department', header: 'Department', sortValue: (row) => row.department, render: (row) => row.department },
    { key: 'active', header: 'Active', render: (row) => <Badge tone={row.active ? 'success' : 'neutral'}>{row.active ? 'active' : 'deactivated'}</Badge> },
    { key: 'lastLogin', header: 'Last sign-in', sortValue: (row) => row.lastLoginAt ?? '', render: (row) => (row.lastLoginAt ? relative(row.lastLoginAt) : <span className="faint">never</span>) },
    { key: 'actions', header: '', align: 'right', render: (row) => (
      <span className="row-tight" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => resetPassword(row)}>Reset password</button>
        {row.id !== user?.id && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => toggleActive(row)}>
            {row.active ? 'Deactivate' : 'Activate'}
          </button>
        )}
      </span>
    ) },
  ];

  if (isLoading || !health) return <div className="page"><Loading rows={8} /></div>;

  const collections = Object.entries(health.database.collections)
    .map(([name, stats]) => ({ id: name, name, ...stats }))
    .sort((a, b) => b.records - a.records);

  return (
    <div className="page page-wide">
      <PageHeader
        title="Admin"
        subtitle={`${number(health.database.totalRecords)} records · ${health.database.bytesHuman} on disk · ${health.realtime.online} ${health.realtime.online === 1 ? 'person' : 'people'} online`}
        actions={
          <>
            <button type="button" className="btn" onClick={checkpoint}><Icon name="save" size={13} /> Checkpoint</button>
            <button type="button" className="btn btn-primary" onClick={backup}><Icon name="archive" size={13} /> Back up now</button>
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'health', label: 'Database', icon: 'database' },
          { value: 'people', label: 'People', count: users?.total ?? null, icon: 'users' },
          { value: 'access', label: 'Sessions', count: sessions?.rows.length ?? null, icon: 'lock' },
          { value: 'settings', label: 'Settings', count: settings?.total ?? null, icon: 'sliders' },
          { value: 'audit', label: 'Audit trail', icon: 'history' },
        ]}
      />

      <div style={{ marginTop: 'var(--s-4)' }}>
        {tab === 'health' && (
          <div className="split">
            <div className="col">
              <Card>
                <CardHead
                  title="Collections"
                  subtitle="Each one is a plain JSON file you can open, diff and copy"
                  icon="database"
                />
                <DataTable
                  columns={[
                    { key: 'name', header: 'Collection', sortValue: (row) => row.name, render: (row) => <span className="mono">{row.name}</span> },
                    { key: 'live', header: 'Live', numeric: true, sortValue: (row) => row.live, render: (row) => number(row.live) },
                    { key: 'deleted', header: 'Archived', numeric: true, sortValue: (row) => row.deleted, render: (row) => (row.deleted ? number(row.deleted) : <span className="faint">—</span>) },
                    { key: 'bytes', header: 'On disk', numeric: true, sortValue: (row) => row.bytes, render: (row) => fileSize(row.bytes) },
                    { key: 'export', header: '', align: 'right', render: (row) => (
                      <a className="btn btn-sm btn-ghost" href={`/api/admin/export/${row.name}`}><Icon name="download" size={12} /> Export</a>
                    ) },
                  ] as Column<{ id: string; name: string; records: number; live: number; deleted: number; bytes: number }>[]}
                  rows={collections}
                />
              </Card>
            </div>

            <div className="col">
              <Section title="Storage engine" icon="database">
                <Flag
                  tone="info"
                  title={health.database.engine}
                  detail={health.database.durability}
                />
                <div style={{ marginTop: 'var(--s-4)' }}>
                  <KeyValue
                    items={[
                      { label: 'Data directory', value: <span className="mono cell-sub">{health.database.dir}</span> },
                      { label: 'Records', value: number(health.database.totalRecords) },
                      { label: 'Snapshot size', value: health.database.bytesHuman },
                      { label: 'Pending writes', value: health.database.pendingWrites },
                      { label: 'Writes since boot', value: number(health.database.writesSinceBoot) },
                      { label: 'Uploaded files', value: `${number(health.files.files)} · ${health.files.bytesHuman}` },
                      { label: 'Audit log', value: `${number(health.audit.files)} ${health.audit.files === 1 ? 'day' : 'days'} · ${health.audit.bytesHuman}` },
                      { label: 'Backups', value: `${health.database.backups.count} ${health.database.backups.count === 1 ? 'set' : 'sets'} · ${health.backups.bytesHuman}` },
                      { label: 'Latest backup', value: health.database.backups.latest ? relative(health.database.backups.latest.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z')) : 'none yet' },
                    ]}
                  />
                </div>
              </Section>

              <Section title="Process" icon="activity">
                <KeyValue
                  items={[
                    { label: 'Uptime', value: `${Math.floor(health.process.uptimeSeconds / 3600)}h ${Math.floor((health.process.uptimeSeconds % 3600) / 60)}m` },
                    { label: 'Node', value: health.process.nodeVersion },
                    { label: 'Heap', value: `${health.process.memoryMb} MB` },
                    { label: 'Live connections', value: health.realtime.connections },
                    { label: 'People online', value: health.realtime.online },
                  ]}
                />
              </Section>

              <Section title="Who is here" icon="users">
                <div className="col-tight">
                  {online.map((person) => (
                    <div key={person.id} className="row-tight">
                      <Avatar name={person.name} color={person.accentColor} size="sm" />
                      <span className="grow truncate">{person.name}</span>
                      {person.viewing && <span className="cell-sub truncate">{person.viewing}</span>}
                    </div>
                  ))}
                  {online.length === 0 && <div className="cell-sub">Nobody is connected right now.</div>}
                </div>
              </Section>
            </div>
          </div>
        )}

        {tab === 'people' && (
          <Card>
            <CardHead
              title="People"
              subtitle={`${(users?.rows ?? []).filter((row) => row.active).length} active of ${users?.total ?? 0}`}
              icon="users"
              actions={<button type="button" className="btn btn-sm btn-primary" onClick={() => setNewUserOpen(true)}><Icon name="plus" size={12} /> Add someone</button>}
            />
            <DataTable columns={userColumns} rows={users?.rows ?? []} />
          </Card>
        )}

        {tab === 'access' && (
          <Card>
            <CardHead title="Live sessions" subtitle="Every signed-in browser, with the option to sign it out" icon="lock" />
            <div className="card-body-flush">
              {(sessions?.rows ?? []).map((session) => (
                <div key={session.id} className="list-row">
                  <Avatar name={session.userName} size="sm" />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="cell-primary" style={{ display: 'block' }}>{session.userName}</span>
                    <span className="cell-sub truncate">{session.ip} · {session.userAgent}</span>
                  </span>
                  <span className="cell-sub nowrap">seen {relative(session.lastSeenAt)}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      try {
                        await api.del(`/auth/sessions/${session.id}`);
                        queryClient.invalidateQueries({ queryKey: ['admin', 'sessions'] });
                      } catch (err) { error(err); }
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ))}
              {(sessions?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>No live sessions.</div>}
            </div>
          </Card>
        )}

        {tab === 'settings' && (
          <div className="grid grid-2">
            {Object.entries(
              (settings?.rows ?? []).reduce<Record<string, Setting[]>>((groups, setting) => {
                (groups[setting.category] ??= []).push(setting);
                return groups;
              }, {}),
            ).map(([category, rows]) => (
              <Section key={category} title={category} icon="sliders">
                <div className="col">
                  {rows.map((setting) => (
                    <SettingRow key={setting.id} setting={setting} onSaved={() => queryClient.invalidateQueries({ queryKey: ['collection', 'settings'] })} />
                  ))}
                </div>
              </Section>
            ))}
          </div>
        )}

        {tab === 'audit' && (
          <Card>
            <CardHead
              title="Audit trail"
              subtitle="Append-only, one file per day, every field change attributed to a person"
              icon="history"
              actions={
                <Select
                  value={auditCollection}
                  onChange={setAuditCollection}
                  allowEmpty
                  placeholder="Every collection"
                  options={collections.map((collection) => ({ value: collection.name, label: collection.name }))}
                  className="select input-sm"
                  style={{ width: 190 }}
                />
              }
            />
            <div className="card-body-flush" style={{ maxHeight: 640, overflowY: 'auto' }}>
              {(audit?.entries ?? []).map((entry, index) => (
                <div key={index} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <Badge tone={entry.op === 'insert' ? 'success' : entry.op === 'purge' ? 'danger' : 'info'}>{entry.op}</Badge>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row-tight">
                      <span className="mono cell-primary">{entry.collection}</span>
                      <span className="mono cell-sub truncate">{entry.id}</span>
                    </span>
                    {entry.changes && entry.changes.length > 0 && (
                      <span className="cell-sub" style={{ display: 'block' }}>
                        {entry.changes.slice(0, 4).map((change) => `${change.field}: ${String(change.from ?? '—')} → ${String(change.to ?? '—')}`).join(' · ')}
                        {entry.changes.length > 4 ? ` · +${entry.changes.length - 4} more` : ''}
                      </span>
                    )}
                    {entry.reason && <span className="cell-sub" style={{ display: 'block' }}>Reason: {entry.reason}</span>}
                  </span>
                  <span className="cell-sub nowrap">{entry.actorName}</span>
                  <span className="cell-sub nowrap" title={dateTime(entry.at)}>{relative(entry.at)}</span>
                </div>
              ))}
              {(audit?.entries ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>No audit entries in the selected window.</div>}
            </div>
          </Card>
        )}
      </div>

      <NewUser
        open={newUserOpen}
        onClose={() => setNewUserOpen(false)}
        onCreated={() => { setNewUserOpen(false); queryClient.invalidateQueries({ queryKey: ['collection', 'users'] }); }}
      />
    </div>
  );
}

function SettingRow({ setting, onSaved }: { setting: Setting; onSaved: () => void }) {
  const { error, success } = useUi();
  const [value, setValue] = useState(setting.value);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(setting.value);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/admin/settings/${encodeURIComponent(setting.key)}`, { value });
      success(`${setting.label} saved`);
      onSaved();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <div className="grow">
        <Field label={setting.label} hint={setting.description || setting.key}>
          {typeof setting.value === 'boolean' ? (
            <Toggle checked={Boolean(value)} onChange={setValue} label={value ? 'Enabled' : 'Disabled'} />
          ) : Array.isArray(setting.value) ? (
            <TextInput
              value={(value as string[]).join(', ')}
              onChange={(next) => setValue(next.split(',').map((part) => part.trim()).filter(Boolean))}
            />
          ) : typeof setting.value === 'number' ? (
            <input
              className="input input-mono right"
              type="number"
              value={String(value ?? '')}
              onChange={(event) => setValue(Number(event.target.value))}
            />
          ) : (
            <TextInput value={String(value ?? '')} onChange={setValue} />
          )}
        </Field>
      </div>
      {dirty && (
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>Save</button>
      )}
    </div>
  );
}

function NewUser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { error } = useUi();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('production');
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [temporary, setTemporary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ temporaryPassword: string }>('/admin/users', { name, email, role, title, department });
      setTemporary(result.temporaryPassword);
      onCreated();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={() => { setTemporary(null); setName(''); setEmail(''); onClose(); }}
      title={temporary ? 'Account created' : 'Add someone to Enova Ops'}
      footer={
        temporary ? (
          <button type="button" className="btn btn-primary" onClick={() => { setTemporary(null); setName(''); setEmail(''); onClose(); }}>Done</button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!name || !email || busy} onClick={create}>Create account</button>
          </>
        )
      }
    >
      {temporary ? (
        <div className="col">
          <Flag
            tone="success"
            title={`${name} can sign in now`}
            detail="Give them this temporary password. They will be asked to choose their own the first time they sign in."
          />
          <div className="row">
            <code className="mono grow" style={{ padding: 'var(--s-3)', background: 'var(--surface-inset)', borderRadius: 'var(--r-sm)' }}>{temporary}</code>
            <CopyButton text={temporary} />
          </div>
        </div>
      ) : (
        <div className="col">
          <div className="field-row">
            <Field label="Full name"><TextInput value={name} onChange={setName} autoFocus /></Field>
            <Field label="Email"><TextInput type="email" value={email} onChange={setEmail} placeholder="name@enovascience.com" /></Field>
          </div>
          <Field label="Role" hint={ROLES[role]?.blurb}>
            <Select value={role} onChange={setRole} options={ROLE_KEYS.map((key) => ({ value: key, label: ROLES[key].label }))} />
          </Field>
          <div className="field-row">
            <Field label="Job title"><TextInput value={title} onChange={setTitle} /></Field>
            <Field label="Department"><TextInput value={department} onChange={setDepartment} /></Field>
          </div>
        </div>
      )}
    </Modal>
  );
}
