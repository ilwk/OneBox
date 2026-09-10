import { platform } from '@tauri-apps/plugin-os';
import { useEffect, useState } from 'react';
import { Ethernet } from 'react-bootstrap-icons';
import { toast } from 'sonner';
import { getInterfaceBindingMode, setInterfaceBindingMode, type InterfaceBindingMode } from '../../single/store';
import { t } from '../../utils/helper';
import { RadioOptionList } from '../common/radio-option-list';
import { SettingsModal } from '../common/settings-modal';
import { SettingItem } from './common';

export default function AutoDetectInterfaceSetting() {
    const [mode, setMode] = useState<InterfaceBindingMode>('template');
    const [draft, setDraft] = useState<InterfaceBindingMode>('template');
    const [busy, setBusy] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (platform() !== 'windows') return;
        let active = true;
        getInterfaceBindingMode().then((value) => {
            if (active) { setMode(value); setLoaded(true); }
        }).catch(() => {
            if (active) toast.error(t('auto_detect_interface_load_failed'));
        }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, []);

    const save = async () => {
        if (busy || !loaded) return;
        setBusy(true);
        try {
            await setInterfaceBindingMode(draft);
            setMode(draft);
            setOpen(false);
            toast.success(t('auto_detect_interface_saved'));
        } catch {
            toast.error(t('auto_detect_interface_save_failed'));
        } finally { setBusy(false); }
    };

    if (platform() !== 'windows') return null;
    return <>
        <SettingItem
            icon={<Ethernet className="text-[#5856D6]" size={22} />}
            title={t('auto_detect_interface')}
            subTitle={t('auto_detect_interface_desc')}
            badge={t(`interface_binding_${mode}`)}
            disabled={busy || !loaded}
            onPress={() => { setDraft(mode); setOpen(true); }}
        />
        <SettingsModal
            isOpen={open}
            onClose={() => { if (!busy) setOpen(false); }}
            title={t('auto_detect_interface')}
            subtitle={t('auto_detect_interface_desc')}
            confirmLabel={t('confirm')}
            confirmDisabled={busy}
            confirmLoading={busy}
            onConfirm={save}
        >
            <RadioOptionList
                value={draft}
                onChange={setDraft}
                options={(['template', 'enabled', 'disabled'] as const).map((key) => ({
                    key, label: t(`interface_binding_${key}`), disabled: busy,
                }))}
            />
        </SettingsModal>
    </>;
}
