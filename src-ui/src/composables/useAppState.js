import { ref, computed } from 'vue';

const currentMode = ref('sd');
const currentStep = ref('config');
const config = ref({
    sd: {
        source_dir: '',
        target_dir: '',
        overwrite_duplicates: false
    },
    dji: {
        source_dir: '',
        target_dir: '',
        overwrite_duplicates: false
    },
    favorites: {
        sd_sources: [],
        sd_targets: [],
        dji_sources: [],
        dji_targets: []
    },
    eagle: {
        base_url: 'http://localhost:41595',
        token: '',
        last_folder_id: ''
    },
    tether: {
        mode: 'ftp',
        watch_dir: '',
        target_dir: '',
        ftp_port: 2121,
        ftp_user: 'eos',
        ftp_pass: 'eos',
        delete_source: false
    }
});

// 联机会话状态放在模块级，切换页签不丢失（后端会话独立运行）
const tetherActive = ref(false);
const tetherInfo = ref({ lan_ip: '', ftp_port: null, inbox: '' });
const tetherFiles = ref([]); // { key, filename, status, target_path, size, date_ms, file_type, error }

export function useAppState() {
    return {
        currentMode,
        currentStep,
        config,
        tetherActive,
        tetherInfo,
        tetherFiles
    };
}
