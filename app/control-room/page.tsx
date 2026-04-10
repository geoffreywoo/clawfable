import { redirect } from 'next/navigation';
import { HomeMissionControl } from '@/app/components/home-mission-control';
import { getCurrentUser } from '@/lib/auth';
import { getControlRoomSnapshot } from '@/lib/dashboard-data';

export default async function ControlRoomPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/');
  }

  const snapshot = await getControlRoomSnapshot(user);

  return (
    <HomeMissionControl
      initialUser={snapshot.user}
      initialAgents={snapshot.agents}
    />
  );
}
