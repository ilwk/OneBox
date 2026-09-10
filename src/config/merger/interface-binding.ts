import { platform } from '@tauri-apps/plugin-os';
import { getInterfaceBindingMode, getProxyTransportMode } from '../../single/store';

interface NetworkConfig {
    inbounds?: { type: string }[];
    route?: { auto_detect_interface?: boolean };
}

export async function configureInterfaceBinding(config: NetworkConfig, bypassRouter: boolean): Promise<void> {
    // Manual proxies and TUN retain their own routing behavior, even when
    // they share the mixed template or include a mixed inbound.
    if (platform() !== 'windows' || bypassRouter
        || config.inbounds?.some((inbound) => inbound.type === 'tun')
        || await getProxyTransportMode() !== 'system') return;

    const mode = await getInterfaceBindingMode();
    if (mode === 'template') return;
    config.route ??= {};
    config.route.auto_detect_interface = mode === 'enabled';
}
