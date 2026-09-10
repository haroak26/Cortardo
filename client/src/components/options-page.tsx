import React from 'react';
import { AppLayout } from '@/components/AppLayout';
import { AppPage, AppBodyNarrow, PageHeader } from '@/components/ds';
import { Button, IconButton } from '@/components/button';
import { Plus, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export type OptionsView = 'list' | 'create' | 'edit';

export function OptionsPage({
  title,
  icon: Icon,
  iconColor,
  view,
  onBack,
  addLabel = 'New',
  onAdd,
  standalone = true,
  children,
  className,
}: {
  title?: string;
  icon?: React.ElementType;
  iconColor?: string;
  view: OptionsView;
  onBack?: () => void;
  addLabel?: string;
  onAdd?: () => void;
  standalone?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const actions = view !== 'list' && onBack ? (
    <IconButton icon={ArrowLeft} onClick={onBack} size="xs" title="Back" />
  ) : undefined;

  if (standalone) {
    return (
      <AppLayout>
        <AppPage>
          <PageHeader title={title} icon={Icon} iconColor={iconColor} actions={actions} />
          <AppBodyNarrow className={className}>
            {children}
          </AppBodyNarrow>
          {view === 'list' && onAdd && (
            <Button design="primary" size="sm" onClick={onAdd} className="fixed right-4 z-40" style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom) + 0.75rem)' }}>
              <Plus size={14} />
              {addLabel}
            </Button>
          )}
        </AppPage>
      </AppLayout>
    );
  }

  return (
    <>
      {children}
      {view === 'list' && onAdd && (
        <Button design="primary" size="sm" onClick={onAdd} className="fixed right-4 z-40" style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom) + 0.75rem)' }}>
          <Plus size={14} />
          {addLabel}
        </Button>
      )}
    </>
  );
}
