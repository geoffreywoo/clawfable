import { PublicSoulsLibrary } from '@/app/components/public-souls-library';
import { getPublicSoulSummaries } from '@/lib/dashboard-data';

export const revalidate = 300;

export default async function SoulsPage() {
  return <PublicSoulsLibrary souls={await getPublicSoulSummaries()} />;
}
