import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_DETECT_INTERFACE_STORE_KEY, STAGE_VERSION_STORE_KEY } from '../types/definition';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn(() => 'windows') }));

vi.mock('@tauri-apps/api/path', () => ({
    appConfigDir: vi.fn().mockResolvedValue('/config'),
    join: vi.fn().mockImplementation((...parts: string[]) => Promise.resolve(parts.join('/'))),
}));

vi.mock('../action/db', () => ({
    getSubscriptionConfig: vi.fn().mockResolvedValue({ outbounds: [] }),
}));

vi.mock('../single/store', () => ({
    getInterfaceBindingMode: vi.fn(),
    getProxyTransportMode: vi.fn(),
    getAllowLan: vi.fn().mockResolvedValue(false),
    getClashApiSecret: vi.fn(),
    getCustomRuleSet: vi.fn(),
    getStoreValue: vi.fn(),
    isBypassRouterEnabled: vi.fn().mockResolvedValue(false),
    setStoreValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/merger/helper', () => ({
    configureMixedInbound: vi.fn().mockResolvedValue(undefined),
    configureTunInbound: vi.fn().mockResolvedValue(undefined),
    updateDHCPSettings2Config: vi.fn().mockResolvedValue(undefined),
    updateVPNServerConfigFromDB: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/templates', () => ({
    getBuiltInTemplate: vi.fn(),
}));

import { updateVPNServerConfigFromDB } from '../config/merger/helper';
import setGlobalTunConfig, { setGlobalMixedConfig, setMixedConfig, setTunConfig } from '../config/merger/main';
import { platform } from '@tauri-apps/plugin-os';
import { getClashApiSecret, getStoreValue, getCustomRuleSet, isBypassRouterEnabled, getInterfaceBindingMode, getProxyTransportMode } from '../single/store';

const mockGetClashApiSecret = vi.mocked(getClashApiSecret);
const mockGetStoreValue = vi.mocked(getStoreValue);
const mockWriteConfig = vi.mocked(updateVPNServerConfigFromDB);

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProxyTransportMode).mockResolvedValue('system');
    vi.mocked(getInterfaceBindingMode).mockResolvedValue('template');
    vi.mocked(platform).mockReturnValue('windows');
    vi.mocked(isBypassRouterEnabled).mockResolvedValue(false);
    vi.mocked(getCustomRuleSet).mockResolvedValue({ domain: [], domain_suffix: [], ip_cidr: [] });
    mockGetClashApiSecret.mockResolvedValue('secret');
    mockGetStoreValue.mockImplementation((key: string) => {
        if (key === STAGE_VERSION_STORE_KEY) return Promise.resolve('dev');
        return Promise.resolve(JSON.stringify({ log: {}, experimental: {} }));
    });
});

describe('config merger', () => {
    it.each([
        ['mixed disabled', setMixedConfig, 'windows', false, false, true, false],
        ['global mixed disabled', setGlobalMixedConfig, 'windows', false, false, true, false],
        ['enabled', setMixedConfig, 'windows', true, false, false, true],
        ['unset preserves template', setMixedConfig, 'windows', undefined, false, false, false],
        ['TUN unchanged', setTunConfig, 'windows', false, false, true, true],
        ['global TUN unchanged', setGlobalTunConfig, 'windows', false, false, true, true],
        ['bypass unchanged', setMixedConfig, 'windows', false, true, true, true],
        ['macOS unchanged', setMixedConfig, 'macos', false, false, true, true],
        ['Linux unchanged', setMixedConfig, 'linux', false, false, true, true],
    ] as const)('%s', async (_name, merge, os, preference, bypass, initial, expected) => {
        vi.mocked(platform).mockReturnValue(os);
        vi.mocked(getInterfaceBindingMode).mockResolvedValue(preference === true ? 'enabled' : preference === false ? 'disabled' : 'template');
        vi.mocked(isBypassRouterEnabled).mockResolvedValue(bypass);
        const template = JSON.stringify({
            log: {}, experimental: {},
            route: { auto_detect_interface: initial, rules: [] },
            outbounds: [{ type: 'direct', tag: 'direct', bind_interface: 'Ethernet' }],
        });
        mockGetStoreValue.mockImplementation((key: string) => Promise.resolve(
            key === AUTO_DETECT_INTERFACE_STORE_KEY ? preference
                : key === STAGE_VERSION_STORE_KEY ? 'dev' : template,
        ));
        await merge('config');
        const merged = mockWriteConfig.mock.calls[0][2];
        expect(merged.route.auto_detect_interface).toBe(expected);
        expect(merged.outbounds).toEqual(JSON.parse(template).outbounds);
        expect(merged.route.rules).toEqual([]);
    });

    it.each(['manual', 'tun'] as const)('preserves binding in %s transport with a mixed template', async (transport) => {
        vi.mocked(getProxyTransportMode).mockResolvedValue(transport);
        vi.mocked(getInterfaceBindingMode).mockResolvedValue('disabled');
        mockGetStoreValue.mockResolvedValue(JSON.stringify({ log: {}, experimental: {}, route: { auto_detect_interface: true } }));
        await setGlobalMixedConfig('config');
        expect(mockWriteConfig.mock.calls[0][2].route.auto_detect_interface).toBe(true);
    });

    it('preserves an embedded TUN inbound in a mixed template', async () => {
        vi.mocked(getInterfaceBindingMode).mockResolvedValue('disabled');
        mockGetStoreValue.mockResolvedValue(JSON.stringify({ log: {}, experimental: {}, inbounds: [{type: 'tun'}], route: {auto_detect_interface: true} }));
        await setGlobalMixedConfig('config');
        expect(mockWriteConfig.mock.calls[0][2].route.auto_detect_interface).toBe(true);
    });

    it('waits for the Clash secret and writes the 1.14 cache schema', async () => {
        let resolveSecret!: (secret: string) => void;
        mockGetClashApiSecret.mockReturnValue(new Promise((resolve) => {
            resolveSecret = resolve;
        }));

        const mergePromise = setGlobalMixedConfig('subscription');
        await vi.waitFor(() => expect(mockGetClashApiSecret).toHaveBeenCalledOnce());
        expect(mockWriteConfig).not.toHaveBeenCalled();

        resolveSecret('secret');
        await mergePromise;

        const mergedConfig = mockWriteConfig.mock.calls[0][2];
        expect(mergedConfig.experimental.clash_api.secret).toBe('secret');
        expect(mergedConfig.experimental.cache_file).toMatchObject({
            enabled: true,
            store_fakeip: true,
            store_dns: true,
            path: '/config/mixed-cache-global-v2.db',
        });
        expect(mergedConfig.experimental.cache_file).not.toHaveProperty('store_rdrc');
    });
});
