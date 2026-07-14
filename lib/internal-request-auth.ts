import { timingSafeEqual } from 'node:crypto';

export type InternalRequestAuthError = {
  status: 401 | 503;
  message: string;
};

export function getInternalRequestAuthError(
  request: Request,
  secret: string | null | undefined,
): InternalRequestAuthError | null {
  if (!secret) {
    return {
      status: 503,
      message: 'Internal request authentication is not configured.',
    };
  }

  const authorization = request.headers.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);
  const valid = expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);

  return valid ? null : { status: 401, message: 'Unauthorized' };
}
