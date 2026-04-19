import { redirect } from 'next/navigation';
import { ControlRoomShell } from '@/app/components/control-room-shell';
import { getCurrentUser } from '@/lib/auth';
import { getControlRoomSnapshot } from '@/lib/dashboard-data';

export default async function ControlRoomPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/');
  }

  const snapshot = await getControlRoomSnapshot(user);

  return (
    <ControlRoomShell
      initialUser={snapshot.user}
      initialAgents={snapshot.agents}
    />
  );
}
