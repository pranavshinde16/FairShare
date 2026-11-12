import { createFileRoute } from '@tanstack/react-router';
import { Activity } from 'lucide-react';
import { EmptyState } from '../../components/common/empty-state';

export const Route = createFileRoute('/_authed/activity')({
  component: () => (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
      <EmptyState icon={Activity} title="Nothing here yet">
        Changes in your groups will appear here.
      </EmptyState>
    </div>
  ),
});
