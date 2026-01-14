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
    }
});

export function useAppState() {
    return {
        currentMode,
        currentStep,
        config
    };
}
