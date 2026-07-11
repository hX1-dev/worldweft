import { assertLocalGodotFixtureAccess, legacyXianxiaAccessDecision } from './access';

describe('xianxia access policy', () => {
  test('allows legacy writes only for explicit local debug or configured admin identity', () => {
    expect(
      legacyXianxiaAccessDecision({
        CONVEX_CLOUD_URL: 'http://127.0.0.1:3210',
        XIANXIA_LOCAL_DEBUG_WRITES_ENABLED: 'true',
      }),
    ).toEqual({ allowed: true, mode: 'local_debug' });

    expect(
      legacyXianxiaAccessDecision(
        {
          CONVEX_CLOUD_URL: 'https://production.convex.cloud',
          XIANXIA_ADMIN_TOKEN_IDENTIFIER: 'issuer|admin-subject',
        },
        'issuer|admin-subject',
      ),
    ).toEqual({ allowed: true, mode: 'admin_identity' });

    expect(
      legacyXianxiaAccessDecision({
        CONVEX_CLOUD_URL: 'https://production.convex.cloud',
        XIANXIA_LOCAL_DEBUG_WRITES_ENABLED: 'true',
      }),
    ).toMatchObject({ allowed: false });
  });

  test('never permits smoke fixtures outside explicit local bridge debug mode', () => {
    expect(() =>
      assertLocalGodotFixtureAccess('prime', {
        CONVEX_CLOUD_URL: 'http://127.0.0.1:3210',
        GODOT_BRIDGE_DEBUG_ENABLED: 'true',
      }),
    ).not.toThrow();
    expect(() =>
      assertLocalGodotFixtureAccess('prime', {
        CONVEX_CLOUD_URL: 'https://production.convex.cloud',
        GODOT_BRIDGE_DEBUG_ENABLED: 'true',
      }),
    ).toThrow('godot_fixture_forbidden');
    expect(() =>
      assertLocalGodotFixtureAccess('prime', {
        CONVEX_CLOUD_URL: 'http://127.0.0.1:3210',
      }),
    ).toThrow('godot_fixture_forbidden');
  });
});
