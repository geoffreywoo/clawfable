import { notFound } from 'next/navigation';
import { PublicSoulProfile } from '@/app/components/public-soul-profile';
import { getPublicSoulProfile, getPublicSoulSummaries } from '@/lib/dashboard-data';

export const revalidate = 300;

interface AgentProfilePageProps {
  params: Promise<{ handle: string }>;
}

export async function generateStaticParams() {
  const souls = await getPublicSoulSummaries();
  return souls.map((soul) => ({ handle: soul.handle }));
}

export default async function AgentProfilePage({ params }: AgentProfilePageProps) {
  const { handle } = await params;
  const profile = await getPublicSoulProfile(handle);

  if (!profile) {
    notFound();
  }

  return <PublicSoulProfile agent={profile} />;
}
