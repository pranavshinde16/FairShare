// Invite links: creation, the public preview, joining, claiming, expiry and revocation.

import {
  AcceptInviteResponse,
  ErrorEnvelope,
  Group,
  InviteCreated,
  InvitePreview,
} from '@fairshare/contracts';
import { invites } from '@fairshare/db';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../lib/ids';
import { createRateLimiter } from '../../lib/rate-limit';
import { integrationApp } from '../../testing/integration';
import { hashToken } from './service';

const ctx = await integrationApp({
  invitePreviewLimiter: createRateLimiter({ max: 1000, windowMs: 60_000 }),
});
afterAll(() => ctx.drop());

let n = 0;
const person = (name: string) => ctx.person(`${name}+${++n}@example.com`);
const code = (body: unknown) => ErrorEnvelope.parse(body).error.code;
const tokenOf = (invite: InviteCreated) => invite.url.split('/').pop()!;

async function groupWith(owner: { cookie: string }, placeholders: string[] = []) {
  const res = await ctx.call(owner, 'POST', '/api/v1/groups', {
    id: uuidv7(),
    name: 'Goa Trip',
    emoji: '🏖️',
    currency: 'INR',
    members: placeholders.map((name) => ({ name })),
  });
  return Group.parse(res.body);
}

async function invite(owner: { cookie: string }, groupId: string, target?: string) {
  const res = await ctx.call(owner, 'POST', `/api/v1/groups/${groupId}/invites`, {
    ...(target && { targetPlaceholderId: target }),
  });
  expect(res.status).toBe(201);
  return InviteCreated.parse(res.body);
}

describe('creating an invite', () => {
  it('returns a link with a 43-character token, stores only its hash, and expires in 30 days', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha);

    const created = await invite(asha, group.id);

    expect(created.url).toMatch(/^http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}$/);
    const days = (Date.parse(created.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    const [row] = await ctx.db.select().from(invites).where(eq(invites.id, created.id));
    expect(row!.tokenHash.equals(hashToken(tokenOf(created)))).toBe(true);
    expect(JSON.stringify(row)).not.toContain(tokenOf(created));
  });

  it('can target only an unclaimed placeholder in the group', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal']);
    const other = await groupWith(asha, ['Elsewhere']);

    for (const target of [asha.id, other.members[1]!.user.id, uuidv7()]) {
      const res = await ctx.call(asha, 'POST', `/api/v1/groups/${group.id}/invites`, {
        targetPlaceholderId: target,
      });
      expect(res.status).toBe(422);
      expect(code(res.body)).toBe('PLACEHOLDER_UNAVAILABLE');
    }
  });
});

describe('the public preview', () => {
  it('shows the group, the inviter, the unclaimed placeholders and the target, without signing in', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal', 'Chitra']);
    const chitra = group.members[2]!.user.id;
    const created = await invite(asha, group.id, chitra);

    const res = await ctx.call(null, 'GET', `/api/v1/invites/${tokenOf(created)}`);

    expect(res.status).toBe(200);
    expect(InvitePreview.parse(res.body)).toEqual({
      group: { name: 'Goa Trip', emoji: '🏖️', memberCount: 3 },
      invitedBy: { name: 'Asha' },
      placeholders: [
        { id: group.members[1]!.user.id, name: 'Bilal' },
        { id: chitra, name: 'Chitra' },
      ],
      targetPlaceholderId: chitra,
      expired: false,
    });
  });

  it('answers 404 for a malformed, unknown or revoked token', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha);
    const created = await invite(asha, group.id);
    await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/invites/${created.id}`);

    for (const token of ['short', 'A'.repeat(43), tokenOf(created)]) {
      expect((await ctx.call(null, 'GET', `/api/v1/invites/${token}`)).status).toBe(404);
    }
  });

  it('says when the link has expired', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha);
    const created = await invite(asha, group.id);
    await ctx.pool.query(
      `UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [created.id],
    );

    const res = await ctx.call(null, 'GET', `/api/v1/invites/${tokenOf(created)}`);

    expect(InvitePreview.parse(res.body).expired).toBe(true);
  });

  it('is rate-limited per IP, with Retry-After', async () => {
    const limited = await integrationApp({
      invitePreviewLimiter: createRateLimiter({ max: 2, windowMs: 60_000 }),
    });
    try {
      const statuses: number[] = [];
      let retryAfter: string | null = null;
      for (let i = 0; i < 3; i++) {
        const res = await limited.request(`/api/v1/invites/${'A'.repeat(43)}`, {
          headers: { 'X-Real-IP': '203.0.113.7' },
        });
        statuses.push(res.status);
        retryAfter = res.headers.get('Retry-After');
      }
      expect(statuses).toEqual([404, 404, 429]);
      expect(Number(retryAfter)).toBeGreaterThan(0);
      const other = await limited.request(`/api/v1/invites/${'A'.repeat(43)}`, {
        headers: { 'X-Real-IP': '203.0.113.8' },
      });
      expect(other.status).toBe(404);
    } finally {
      await limited.drop();
    }
  });
});

describe('accepting', () => {
  it('joins as a new member, and refuses a second time', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const group = await groupWith(asha);
    const token = tokenOf(await invite(asha, group.id));

    const res = await ctx.call(bilal, 'POST', `/api/v1/invites/${token}/accept`, {});

    expect(AcceptInviteResponse.parse(res.body)).toEqual({ groupId: group.id });
    const seen = Group.parse((await ctx.call(bilal, 'GET', `/api/v1/groups/${group.id}`)).body);
    expect(seen.members.map((m) => m.user.id)).toContain(bilal.id);
    const again = await ctx.call(bilal, 'POST', `/api/v1/invites/${token}/accept`, {});
    expect(again.status).toBe(409);
    expect(code(again.body)).toBe('ALREADY_MEMBER');
  });

  it('claims a placeholder: the person takes its place', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const group = await groupWith(asha, ['Bilal']);
    const placeholder = group.members[1]!.user.id;
    const token = tokenOf(await invite(asha, group.id, placeholder));

    const res = await ctx.call(bilal, 'POST', `/api/v1/invites/${token}/accept`, {
      claimPlaceholderId: placeholder,
    });

    expect(res.status).toBe(200);
    const seen = Group.parse((await ctx.call(asha, 'GET', `/api/v1/groups/${group.id}`)).body);
    expect(seen.members.map((m) => [m.user.id, m.user.isPlaceholder])).toEqual([
      [asha.id, false],
      [bilal.id, false],
    ]);
    const preview = await ctx.call(null, 'GET', `/api/v1/invites/${token}`);
    expect(InvitePreview.parse(preview.body)).toMatchObject({
      placeholders: [],
      targetPlaceholderId: null,
    });
  });

  it('refuses to claim a placeholder twice', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal']);
    const placeholder = group.members[1]!.user.id;
    const token = tokenOf(await invite(asha, group.id));
    const first = await person('first');
    const second = await person('second');

    await ctx.call(first, 'POST', `/api/v1/invites/${token}/accept`, {
      claimPlaceholderId: placeholder,
    });
    const res = await ctx.call(second, 'POST', `/api/v1/invites/${token}/accept`, {
      claimPlaceholderId: placeholder,
    });

    expect(res.status).toBe(422);
    expect(code(res.body)).toBe('PLACEHOLDER_UNAVAILABLE');
  });

  it('answers 410 INVITE_EXPIRED once the link has expired', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const group = await groupWith(asha);
    const created = await invite(asha, group.id);
    await ctx.pool.query(`UPDATE invites SET expires_at = now() WHERE id = $1`, [created.id]);

    const res = await ctx.call(bilal, 'POST', `/api/v1/invites/${tokenOf(created)}/accept`, {});

    expect(res.status).toBe(410);
    expect(code(res.body)).toBe('INVITE_EXPIRED');
  });

  it('needs a session', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha);
    const token = tokenOf(await invite(asha, group.id));
    expect((await ctx.call(null, 'POST', `/api/v1/invites/${token}/accept`, {})).status).toBe(401);
  });
});

describe('revoking', () => {
  it('lets the creator or the owner revoke, and nobody else', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const chitra = await person('chitra');
    const group = await groupWith(asha);
    const join = tokenOf(await invite(asha, group.id));
    for (const who of [bilal, chitra]) {
      await ctx.call(who, 'POST', `/api/v1/invites/${join}/accept`, {});
    }
    const bilals = await invite(bilal, group.id);
    const ashas = await invite(asha, group.id);

    const byOther = await ctx.call(
      chitra,
      'DELETE',
      `/api/v1/groups/${group.id}/invites/${bilals.id}`,
    );
    expect(byOther.status).toBe(403);
    expect(code(byOther.body)).toBe('NOT_PERMITTED');
    expect(
      (await ctx.call(bilal, 'DELETE', `/api/v1/groups/${group.id}/invites/${bilals.id}`)).status,
    ).toBe(204);
    expect(
      (await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/invites/${ashas.id}`)).status,
    ).toBe(204);
    expect(
      (await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/invites/${ashas.id}`)).status,
    ).toBe(404);
  });
});

describe('friendship invites', () => {
  async function friendship(owner: { cookie: string }) {
    const res = await ctx.call(owner, 'POST', '/api/v1/friends', { name: 'Bilal' });
    const { groupId, friend } = res.body as { groupId: string; friend: { id: string } };
    return { groupId, placeholder: friend.id };
  }

  it('can only target the placeholder friend, and only that friend can be claimed', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const { groupId, placeholder } = await friendship(asha);
    const created = await invite(asha, groupId, placeholder);
    const token = tokenOf(created);

    const preview = InvitePreview.parse(
      (await ctx.call(null, 'GET', `/api/v1/invites/${token}`)).body,
    );
    expect(preview).toMatchObject({
      group: { name: null, memberCount: 2 },
      placeholders: [{ id: placeholder, name: 'Bilal' }],
      targetPlaceholderId: placeholder,
    });

    const plainJoin = await ctx.call(bilal, 'POST', `/api/v1/invites/${token}/accept`, {});
    expect(code(plainJoin.body)).toBe('CANNOT_MODIFY_DIRECT_GROUP');

    const claimed = await ctx.call(bilal, 'POST', `/api/v1/invites/${token}/accept`, {
      claimPlaceholderId: placeholder,
    });
    expect(claimed.status).toBe(200);
    const group = Group.parse((await ctx.call(bilal, 'GET', `/api/v1/groups/${groupId}`)).body);
    expect(group.members.map((m) => m.user.id).sort()).toEqual([asha.id, bilal.id].sort());
  });
});
