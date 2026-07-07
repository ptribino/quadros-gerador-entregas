import { describe, it, expect } from 'vitest';
import { appRouter } from './routers';
import { getSessionCookieOptions } from './_core/cookies';
import { COOKIE_NAME, UNAUTHED_ERR_MSG, NOT_ADMIN_ERR_MSG } from '../shared/const';
import type { TrpcContext } from './_core/context';
import type { Request } from 'express';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext['user']>;

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    openId: 'google-sub-abc123',
    email: 'charles@qtokquadros.com.br',
    name: 'Charles',
    loginMethod: 'google',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function makeCtx(user: AuthenticatedUser | null = null): TrpcContext {
  const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];

  return {
    user,
    req: {
      protocol: 'https',
      headers: {},
    } as TrpcContext['req'],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options });
      },
      clearCookie: () => {},
    } as unknown as TrpcContext['res'],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// auth.me
// ──────────────────────────────────────────────────────────────────────────────

describe('auth.me', () => {
  it('retorna null para usuário não autenticado', async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it('retorna os dados do usuário quando autenticado', async () => {
    const user = makeUser();
    const caller = appRouter.createCaller(makeCtx(user));
    const result = await caller.auth.me();

    expect(result).not.toBeNull();
    expect(result?.email).toBe('charles@qtokquadros.com.br');
    expect(result?.name).toBe('Charles');
    expect(result?.loginMethod).toBe('google');
  });

  it('não expõe dados sensíveis além do tipo User', async () => {
    const user = makeUser();
    const caller = appRouter.createCaller(makeCtx(user));
    const result = await caller.auth.me();

    // O endpoint retorna exatamente o objeto User do contexto
    expect(result).toMatchObject({
      id: user.id,
      openId: user.openId,
      email: user.email,
      name: user.name,
      loginMethod: user.loginMethod,
      role: user.role,
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// auth.logout (fluxo complementar ao auth.login)
// ──────────────────────────────────────────────────────────────────────────────

describe('auth.logout', () => {
  it('limpa o cookie de sessão com maxAge: -1', async () => {
    const clearedCookies: Array<{ name: string; options: Record<string, unknown> }> = [];

    const ctx: TrpcContext = {
      user: makeUser(),
      req: { protocol: 'https', headers: {} } as TrpcContext['req'],
      res: {
        clearCookie: (name: string, options: Record<string, unknown>) => {
          clearedCookies.push({ name, options });
        },
      } as TrpcContext['res'],
    };

    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({ maxAge: -1 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Middleware de proteção (protectedProcedure)
// ──────────────────────────────────────────────────────────────────────────────

describe('protectedProcedure — controle de acesso', () => {
  it('lança UNAUTHORIZED ao acessar rota protegida sem autenticação', async () => {
    const caller = appRouter.createCaller(makeCtx(null));

    // drive.listImages usa protectedProcedure
    await expect(caller.drive.listImages()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: UNAUTHED_ERR_MSG,
    });
  });

  it('lança UNAUTHORIZED para saveImage sem autenticação', async () => {
    const caller = appRouter.createCaller(makeCtx(null));

    await expect(
      caller.drive.saveImage({
        imageUrl: 'data:image/png;base64,abc',
        fileName: 'test.png',
        type: 'mockup',
        frameType: 'light_wood',
      })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: UNAUTHED_ERR_MSG,
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getSessionCookieOptions — configuração de cookies por ambiente
// ──────────────────────────────────────────────────────────────────────────────

describe('getSessionCookieOptions', () => {
  function makeReq(protocol: string, forwardedProto?: string): Request {
    return {
      protocol,
      headers: forwardedProto
        ? { 'x-forwarded-proto': forwardedProto }
        : {},
    } as unknown as Request;
  }

  it('usa sameSite=none e secure=true em HTTPS direto', () => {
    const opts = getSessionCookieOptions(makeReq('https'));
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe('none');
    expect(opts.httpOnly).toBe(true);
    expect(opts.path).toBe('/');
  });

  it('usa sameSite=lax e secure=false em HTTP local', () => {
    const opts = getSessionCookieOptions(makeReq('http'));
    expect(opts.secure).toBe(false);
    expect(opts.sameSite).toBe('lax');
  });

  it('usa secure=true quando x-forwarded-proto é https (proxy reverso)', () => {
    const opts = getSessionCookieOptions(makeReq('http', 'https'));
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe('none');
  });

  it('usa secure=true quando x-forwarded-proto contém https em lista (múltiplos proxies)', () => {
    const opts = getSessionCookieOptions(makeReq('http', 'http, https'));
    expect(opts.secure).toBe(true);
  });

  it('o cookie sempre é httpOnly (prevenção de XSS)', () => {
    const optsHttp = getSessionCookieOptions(makeReq('http'));
    const optsHttps = getSessionCookieOptions(makeReq('https'));
    expect(optsHttp.httpOnly).toBe(true);
    expect(optsHttps.httpOnly).toBe(true);
  });

  it('o path do cookie é sempre /', () => {
    const opts = getSessionCookieOptions(makeReq('http'));
    expect(opts.path).toBe('/');
  });
});
