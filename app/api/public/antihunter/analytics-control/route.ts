import { analyticsControl, getOperatorGrowth } from '@/lib/antihunter-operator-state';

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, s-maxage=60', Vary: 'Origin' };
  if (origin && ['https://antihunter.com', 'https://www.antihunter.com'].includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  try {
    return new Response(JSON.stringify(analyticsControl(await getOperatorGrowth())), { headers });
  } catch {
    headers['Cache-Control'] = 'no-store';
    return new Response(JSON.stringify({ day: '', sampleRate: 0, expiresAt: new Date().toISOString() }), { headers });
  }
}
