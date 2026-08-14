import type { Agent } from './types';
import {
  addPostLogEntry,
  getAgentByHandle,
  updateAgent,
} from './kv-storage';
import { normalizeUsername } from './internal-accounts';
import { decodeKeys, getMe } from './twitter-client';
import { findExistingConnectedAgentByXUserId } from './x-account-conflicts';

export type AgentIdentityAuditStatus =
  | 'verified'
  | 'unverified'
  | 'drifted'
  | 'disconnected'
  | 'credentials_missing';

export type AgentIdentityReconciliationErrorCode =
  | 'agent_not_connected'
  | 'credentials_missing'
  | 'official_identity_invalid'
  | 'x_user_id_mismatch'
  | 'x_user_id_conflict'
  | 'x_handle_conflict'
  | 'canonical_index_inconsistent';

export class AgentIdentityReconciliationError extends Error {
  readonly code: AgentIdentityReconciliationErrorCode;
  readonly status: 409 | 422 | 500;

  constructor(
    code: AgentIdentityReconciliationErrorCode,
    message: string,
    status: 409 | 422 | 500,
  ) {
    super(message);
    this.name = 'AgentIdentityReconciliationError';
    this.code = code;
    this.status = status;
  }
}

function hasStoredCredentials(agent: Agent): agent is Agent & {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
} {
  return Boolean(agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret);
}

export function buildAgentIdentityAudit(agent: Agent, now = new Date()) {
  const storedHandle = normalizeUsername(agent.handle);
  const verifiedHandle = normalizeUsername(agent.xIdentityVerifiedHandle);
  const verifiedUserId = String(agent.xIdentityVerifiedUserId || '').trim() || null;
  const storedUserId = String(agent.xUserId || '').trim() || null;
  const verifiedAt = agent.xIdentityVerifiedAt || null;
  const handleMatchesVerification = Boolean(verifiedHandle && storedHandle === verifiedHandle);
  const userIdMatchesVerification = Boolean(verifiedUserId && storedUserId === verifiedUserId);
  const verificationAgeHours = verifiedAt && Number.isFinite(Date.parse(verifiedAt))
    ? Number(((now.getTime() - Date.parse(verifiedAt)) / (60 * 60 * 1000)).toFixed(1))
    : null;

  let status: AgentIdentityAuditStatus;
  if (agent.isConnected !== 1) {
    status = 'disconnected';
  } else if (!hasStoredCredentials(agent)) {
    status = 'credentials_missing';
  } else if (!verifiedAt || !verifiedHandle || !verifiedUserId) {
    status = 'unverified';
  } else if (!handleMatchesVerification || !userIdMatchesVerification) {
    status = 'drifted';
  } else {
    status = 'verified';
  }

  return {
    status,
    storedHandle: storedHandle ? `@${storedHandle}` : null,
    storedXUserId: storedUserId,
    connected: agent.isConnected === 1,
    credentialsPresent: hasStoredCredentials(agent),
    verifiedHandle: verifiedHandle ? `@${verifiedHandle}` : null,
    verifiedXUserId: verifiedUserId,
    verifiedAt,
    verificationAgeHours,
    verificationSource: agent.xIdentityVerificationSource || null,
    handleMatchesVerification,
    xUserIdMatchesVerification: userIdMatchesVerification,
    requiresReconciliation: status === 'unverified' || status === 'drifted',
  };
}

export async function reconcileAgentXIdentity(agent: Agent, now = new Date()) {
  if (agent.isConnected !== 1) {
    throw new AgentIdentityReconciliationError(
      'agent_not_connected',
      'The agent is not connected to X.',
      422,
    );
  }
  if (!hasStoredCredentials(agent)) {
    throw new AgentIdentityReconciliationError(
      'credentials_missing',
      'The connected agent does not have a complete credential set.',
      422,
    );
  }

  const official = await getMe(decodeKeys(agent));
  const officialHandle = normalizeUsername(official.username);
  const officialUserId = String(official.id || '').trim();
  const officialName = String(official.name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!officialHandle || !officialUserId || !officialName) {
    throw new AgentIdentityReconciliationError(
      'official_identity_invalid',
      'X returned an incomplete account identity.',
      422,
    );
  }

  const storedUserId = String(agent.xUserId || '').trim();
  if (storedUserId && storedUserId !== officialUserId) {
    throw new AgentIdentityReconciliationError(
      'x_user_id_mismatch',
      `Stored X user id ${storedUserId} does not match the connected account.`,
      409,
    );
  }

  const duplicateByUserId = await findExistingConnectedAgentByXUserId(officialUserId, agent.id);
  if (duplicateByUserId) {
    throw new AgentIdentityReconciliationError(
      'x_user_id_conflict',
      `The connected X account is already mapped to agent ${duplicateByUserId.id}.`,
      409,
    );
  }

  const duplicateByHandle = await getAgentByHandle(officialHandle);
  if (duplicateByHandle && String(duplicateByHandle.id) !== String(agent.id)) {
    throw new AgentIdentityReconciliationError(
      'x_handle_conflict',
      `The official X handle is already mapped to agent ${duplicateByHandle.id}.`,
      409,
    );
  }

  const previousHandle = normalizeUsername(agent.handle);
  const previousName = String(agent.name || '').trim();
  const verifiedAt = now.toISOString();
  await updateAgent(agent.id, {
    handle: officialHandle,
    name: officialName,
    xUserId: officialUserId,
    xIdentityVerifiedAt: null,
    xIdentityVerifiedHandle: null,
    xIdentityVerifiedUserId: null,
    xIdentityVerificationSource: null,
  });

  const currentCanonical = await getAgentByHandle(officialHandle);
  const previousCanonical = previousHandle && previousHandle !== officialHandle
    ? await getAgentByHandle(previousHandle)
    : currentCanonical;
  const indexesConsistent = String(currentCanonical?.id || '') === String(agent.id)
    && (previousHandle === officialHandle || previousCanonical === null);
  if (!indexesConsistent) {
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'x_identity_reconcile_error',
      topic: 'auth',
      postedAt: verifiedAt,
      source: 'manual',
      action: 'error',
      reason: `Official X identity @${officialHandle} was stored, but the canonical handle indexes did not verify.`,
    }).catch(() => null);
    throw new AgentIdentityReconciliationError(
      'canonical_index_inconsistent',
      'The X identity was stored, but canonical handle index verification failed.',
      500,
    );
  }

  const updated = await updateAgent(agent.id, {
    xIdentityVerifiedAt: verifiedAt,
    xIdentityVerifiedHandle: officialHandle,
    xIdentityVerifiedUserId: officialUserId,
    xIdentityVerificationSource: 'x_api_v2_me',
  });

  const auditLog = await addPostLogEntry(agent.id, {
    agentId: agent.id,
    tweetId: '',
    xTweetId: '',
    content: '',
    format: 'x_identity_reconciled',
    topic: 'auth',
    postedAt: verifiedAt,
    source: 'manual',
    action: 'job_executed',
    reason: previousHandle === officialHandle
      ? previousName === officialName
        ? `Verified internal identity against official X account @${officialHandle}.`
        : `Verified @${officialHandle} and updated the internal display name from ${previousName || '(empty)'} to ${officialName}.`
      : `Updated internal X handle from @${previousHandle} to @${officialHandle} after official identity verification.`,
  }).catch(() => null);

  return {
    status: previousHandle === officialHandle ? 'verified' : 'updated',
    agentId: agent.id,
    previousHandle: previousHandle ? `@${previousHandle}` : null,
    officialHandle: `@${officialHandle}`,
    officialName,
    officialXUserId: officialUserId,
    verifiedAt,
    verificationSource: 'x_api_v2_me' as const,
    canonicalIndexes: {
      currentHandleAgentId: currentCanonical?.id || null,
      previousHandleAgentId: previousCanonical?.id || null,
      consistent: indexesConsistent,
    },
    auditLogRecorded: Boolean(auditLog),
    identity: buildAgentIdentityAudit(updated, now),
  };
}
