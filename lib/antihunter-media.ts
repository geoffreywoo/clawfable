import { createHash } from 'node:crypto';
import { ANTIHUNTER_AGENT_ID, getOperatorGrowth, mutateOperatorGrowth, parseOperatorBrief, type MediaReceipt, type OperatorAsset } from './antihunter-operator-state';
import type { Tweet } from './types';
import { createClient, type TwitterKeys } from './twitter-client';
import { hasOperatorXBudget } from './antihunter-x-budget';

export const MAX_OPERATOR_IMAGE_BYTES = 5 * 1024 * 1024;
export function describeOperatorImage(bytes: Buffer, altText: string): OperatorAsset {
  if (!bytes.length || bytes.length > MAX_OPERATOR_IMAGE_BYTES) throw new Error('Single image must be at most 5 MiB');
  if (typeof altText !== 'string' || !altText.trim() || altText.length > 1000) throw new Error('Image alt text is required, at most 1000 characters');
  const png = bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if (!png && !jpeg) throw new Error('Only PNG or JPEG image bytes are supported');
  return { sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: png ? 'image/png' : 'image/jpeg', byteLength: bytes.length, altText: altText.trim() };
}
export function assertAssetMatches(asset: OperatorAsset, bytes: Buffer) {
  const actual = describeOperatorImage(bytes, asset.altText);
  if (actual.sha256 !== asset.sha256 || actual.mimeType !== asset.mimeType || actual.byteLength !== asset.byteLength) throw new Error('Image bytes differ from reviewed draft');
}
export function usableMediaReceipt(receipt: MediaReceipt | undefined, asset: OperatorAsset, now = new Date()): MediaReceipt {
  const expiry = Date.parse(receipt?.expiresAt || '');
  if (!receipt || receipt.state !== 'uploaded' || receipt.sha256 !== asset.sha256 || !receipt.mediaId || !receipt.mediaKey || !receipt.altTextApplied
    || !Number.isFinite(expiry) || expiry <= now.getTime() + 60_000) throw new Error('Image needs a confirmed unexpired upload and alt text receipt');
  return receipt;
}
export async function mediaForOperatorTweet(tweet: Tweet): Promise<MediaReceipt | null> {
  const brief = parseOperatorBrief(tweet.sourceBrief);
  if (!brief?.asset) return null;
  if (String(tweet.agentId) !== ANTIHUNTER_AGENT_ID || !hasOperatorXBudget()) throw new Error('Bound operator required for native images');
  return usableMediaReceipt((await getOperatorGrowth()).media[tweet.id], brief.asset);
}
export async function uploadOperatorImage(keys: TwitterKeys, tweet: Tweet, bytes: Buffer): Promise<MediaReceipt> {
  if (String(tweet.agentId) !== ANTIHUNTER_AGENT_ID || !hasOperatorXBudget()) throw new Error('Bound operator required for native images');
  const asset = parseOperatorBrief(tweet.sourceBrief)?.asset;
  if (!asset || tweet.status !== 'draft' || tweet.quarantinedAt) throw new Error('Reviewed image draft required');
  assertAssetMatches(asset, bytes);
  const state = await getOperatorGrowth();
  const prior = state.media[tweet.id];
  if (prior) {
    if (prior.state === 'uploaded' && !prior.altTextApplied && prior.mediaId && prior.sha256 === asset.sha256
      && Date.parse(prior.expiresAt || '') > Date.now() + 60_000) {
      // Metadata is idempotent: resume only this known media ID, never upload
      // a second copy after an uncertain metadata response.
      await createClient(keys).v2.createMediaMetadata(prior.mediaId, { alt_text: { text: asset.altText } });
      await mutateOperatorGrowth(current => { current.media[tweet.id].altTextApplied = true; });
      return { ...prior, altTextApplied: true };
    }
    if (prior.state !== 'uploaded') throw new Error('Existing image upload is unresolved; inspect receipts before retrying');
    if (!Number.isFinite(Date.parse(prior.expiresAt || '')) || Date.parse(prior.expiresAt!) > Date.now()) return usableMediaReceipt(prior, asset);
    // A known, fully expired ID can be replaced without risking duplicate X
    // posts. The previous upload receipt remains available for inspection.
  }
  // Fail before creating a pending upload when price evidence is absent.
  const { priceOperatorXRequest } = await import('./antihunter-x-budget');
  priceOperatorXRequest('POST', new URL('https://api.x.com/2/media/upload'), {}, {}, state);
  await mutateOperatorGrowth(current => {
    const existing = current.media[tweet.id];
    if (existing && (existing.state !== 'uploaded' || existing.at !== prior?.at || !Number.isFinite(Date.parse(existing.expiresAt || '')) || Date.parse(existing.expiresAt!) > Date.now())) throw new Error('Another image upload exists');
    if (existing) {
      current.mediaHistory ||= {};
      (current.mediaHistory[tweet.id] ||= []).push(existing);
    }
    current.media[tweet.id] = { sha256: asset.sha256, at: new Date().toISOString(), state: 'pending' };
  });
  try {
    const client = createClient(keys);
    const response: any = await client.v2.post('media/upload', { media: bytes.toString('base64'), media_category: 'tweet_image' });
    const data = response?.data;
    if (!data?.id || !data.media_key || !Number.isFinite(data.expires_after_secs) || data.expires_after_secs <= 60) throw new Error('Upload did not return a usable image receipt');
    const receipt: MediaReceipt = { sha256: asset.sha256, at: new Date().toISOString(), state: 'uploaded',
      mediaId: String(data.id), mediaKey: data.media_key, expiresAt: new Date(Date.now() + data.expires_after_secs * 1000).toISOString(), altTextApplied: false };
    // Persist the actual upload result before the separate metadata write.
    await mutateOperatorGrowth(current => { current.media[tweet.id] = receipt; });
    await client.v2.createMediaMetadata(receipt.mediaId!, { alt_text: { text: asset.altText } });
    receipt.altTextApplied = true;
    await mutateOperatorGrowth(current => { current.media[tweet.id] = receipt; });
    return receipt;
  } catch (error) {
    await mutateOperatorGrowth(current => {
      const receipt = current.media[tweet.id];
      if (receipt && receipt.state === 'pending') receipt.state = 'uncertain';
    });
    throw error;
  }
}

/** Compare expanded URL text, not X's t.co normalization; exact media key required. */
export function verifyOperatorPost(tweet: Tweet, data: any, media?: MediaReceipt | null): void {
  if (data?.author_id !== '2019634783962226688') throw new Error('Published author mismatch');
  const references = Array.isArray(data.referenced_tweets) ? data.referenced_tweets : [];
  const parents = references.filter((reference: any) => reference.type === 'replied_to');
  if (tweet.type === 'reply') {
    const reply = parseOperatorBrief(tweet.sourceBrief)?.reply;
    if (!reply || parents.length !== 1 || parents[0].id !== reply.targetTweetId
      || data.conversation_id !== reply.conversationId || data.in_reply_to_user_id !== reply.targetAuthorId) {
      throw new Error('Published reply target or conversation mismatch');
    }
  } else if (parents.length) throw new Error('Original post unexpectedly published as a reply');
  let text = data.note_tweet?.text || data.text;
  for (const url of (data.note_tweet?.entities || data.entities)?.urls || []) {
    if (url.url && url.expanded_url) {
      const attachmentUrl = media && new RegExp(`^https://(?:www\\.)?(?:x|twitter)\\.com/[^/]+/status/${data.id}/photo/1$`).test(url.expanded_url);
      text = String(text).split(url.url).join(attachmentUrl ? '' : url.expanded_url);
    }
  }
  if (String(text).trim() !== tweet.content.trim()) throw new Error('Published content mismatch');
  const keys: string[] = data.attachments?.media_keys || [];
  if (media ? keys.length !== 1 || keys[0] !== media.mediaKey : keys.length !== 0) throw new Error('Published image attachment mismatch');
}
