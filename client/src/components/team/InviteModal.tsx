import { useState } from 'react';
import { X, Loader, Check, Copy, Mail, Users } from 'lucide-react';
import { Button, IconButton } from '@/components/button';
import { TextInput, Textarea } from '@/components/text-input';
import { Dropdown } from '@/components/ds';
import { useToast } from '@/hooks/use-toast';

interface Space {
  id: string;
  name: string;
}

interface InviteModalProps {
  workspaceId: string;
  spaces: Space[];
  onClose: () => void;
  onInvited: () => void;
}

export function InviteModal({ workspaceId, spaces, onClose, onInvited }: InviteModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<'quick' | 'bulk' | 'sent'>('quick');
  const [email, setEmail] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [department, setDepartment] = useState('');
  const [selectedSpaces, setSelectedSpaces] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Array<{ email: string; success: boolean; error?: string }>>([]);

  const toggleSpace = (id: string) => {
    setSelectedSpaces(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sendQuickInvite = async () => {
    if (!email.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          role,
          department: department.trim() || undefined,
          spaceIds: Array.from(selectedSpaces),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Failed');
      setStep('sent');
      setResults([{ email: email.trim(), success: true }]);
      toast({ title: 'Invitation sent!', variant: 'success' });
    } catch (err) {
      toast({ title: (err as Error).message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const sendBulkInvite = async () => {
    const emails = bulkEmails.split(/[\n,]+/).map(e => e.trim()).filter(Boolean);
    if (emails.length === 0) return;
    setSending(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/bulk-invite`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails, role, department: department.trim() || undefined, spaceIds: Array.from(selectedSpaces) }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Failed');
      const data = await res.json();
      setResults(data.results);
      setStep('sent');
      toast({ title: `${data.succeeded} invitations sent!`, variant: 'success' });
    } catch (err) {
      toast({ title: (err as Error).message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background rounded-[20px] shadow-xl border border-border w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        {step === 'quick' && (
          <>
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-foreground">Invite Team Member</h3>
              <IconButton icon={X} size="xs" design="ghost" onClick={onClose} />
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-2">
                <Button design="primary" size="xs" onClick={() => setStep('quick')} className="flex-1">
                  <Mail size={12} className="mr-1" /> Quick Invite
                </Button>
                <Button design="ghost" size="xs" onClick={() => setStep('bulk')} className="flex-1">
                  <Users size={12} className="mr-1" /> Bulk Invite
                </Button>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-foreground mb-1">Email address</label>
                <TextInput value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="colleague@example.com" className="w-full" 
                  onKeyDown={e => { if (e.key === 'Enter') sendQuickInvite(); }} />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[12px] font-medium text-foreground mb-1">Role</label>
                  <Dropdown
                    value={role}
                    onChange={v => setRole(v as 'editor' | 'viewer')}
                    options={[
                      { value: 'editor', label: 'Editor' },
                      { value: 'viewer', label: 'Viewer' },
                    ]}
                    triggerClassName="w-full h-8 px-2.5 rounded-[10px] border border-border bg-transparent text-[12px] text-foreground cursor-pointer flex items-center gap-2"
                    menuAlign="left"
                    showChevron
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[12px] font-medium text-foreground mb-1">Department (optional)</label>
                  <TextInput value={department} onChange={e => setDepartment(e.target.value)}
                    placeholder="e.g. Support" className="w-full"  />
                </div>
              </div>

              {spaces.length > 0 && (
                <div>
                  <label className="block text-[12px] font-medium text-foreground mb-1.5">Space access (optional)</label>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {spaces.map(s => (
                      <button key={s.id} onClick={() => toggleSpace(s.id)}
                        className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                          selectedSpaces.has(s.id) ? 'bg-brand/10 text-brand border-brand/30' : 'bg-surface-hover text-fg-muted border-border hover:border-fg-muted'
                        }`}>
                        {selectedSpaces.has(s.id) ? '✓ ' : ''}{s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Button size="xs" onClick={sendQuickInvite} disabled={!email.trim() || sending} isLoading={sending}>
                  {sending ? <Loader size={12} className="animate-spin mr-1" /> : <Mail size={12} className="mr-1" />}
                  Send Invitation
                </Button>
                <Button design="ghost" size="xs" onClick={onClose}>Cancel</Button>
              </div>
            </div>
          </>
        )}

        {step === 'bulk' && (
          <>
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-foreground">Bulk Invite</h3>
              <IconButton icon={X} size="xs" design="ghost" onClick={onClose} />
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-2">
                <Button design="ghost" size="xs" onClick={() => setStep('quick')} className="flex-1">
                  <Mail size={12} className="mr-1" /> Quick Invite
                </Button>
                <Button design="primary" size="xs" onClick={() => setStep('bulk')} className="flex-1">
                  <Users size={12} className="mr-1" /> Bulk Invite
                </Button>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-foreground mb-1">Email addresses</label>
                <Textarea value={bulkEmails} onChange={e => setBulkEmails(e.target.value)}
                  placeholder="user1@example.com&#10;user2@example.com&#10;user3@example.com"
                  className="w-full h-24" />
                <p className="text-[10px] text-fg-faint mt-1">One email per line or comma-separated</p>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[12px] font-medium text-foreground mb-1">Role</label>
                  <Dropdown
                    value={role}
                    onChange={v => setRole(v as 'editor' | 'viewer')}
                    options={[
                      { value: 'editor', label: 'Editor' },
                      { value: 'viewer', label: 'Viewer' },
                    ]}
                    triggerClassName="w-full h-8 px-2.5 rounded-[10px] border border-border bg-transparent text-[12px] text-foreground cursor-pointer flex items-center gap-2"
                    menuAlign="left"
                    showChevron
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[12px] font-medium text-foreground mb-1">Department</label>
                  <TextInput value={department} onChange={e => setDepartment(e.target.value)}
                    placeholder="e.g. Support" className="w-full"  />
                </div>
              </div>

              <Button size="xs" onClick={sendBulkInvite} disabled={!bulkEmails.trim() || sending} isLoading={sending}>
                {sending ? <Loader size={12} className="animate-spin mr-1" /> : <Users size={12} className="mr-1" />}
                Send Invitations ({bulkEmails.split(/[\n,]+/).filter(Boolean).length})
              </Button>
            </div>
          </>
        )}

        {step === 'sent' && (
          <div className="p-6 space-y-4">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-3">
                <Check size={22} className="text-green-600" />
              </div>
              <h3 className="text-[16px] font-semibold text-foreground">Invitations sent!</h3>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {results.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px] px-3 py-1.5 rounded-lg bg-surface-muted">
                  {r.success ? <Check size={11} className="text-green-500 shrink-0" /> : <X size={11} className="text-red-500 shrink-0" />}
                  <span className="text-foreground">{r.email}</span>
                  {r.error && <span className="text-red-500 ml-auto">{r.error}</span>}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="xs" className="flex-1" onClick={() => { setStep('quick'); setEmail(''); setBulkEmails(''); setResults([]); onInvited(); }}>
                Done
              </Button>
              <Button design="ghost" size="xs" onClick={() => { setStep('quick'); setEmail(''); setBulkEmails(''); setResults([]); }}>
                Invite more
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
