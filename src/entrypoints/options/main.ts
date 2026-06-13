import { createApp } from 'vue'
import '@/styles/main.css'
import MustardOptionsPage from '@/ui/options/MustardOptionsPage.vue'
import { initSurfaceFont } from '@/shared/fonts'

initSurfaceFont(document, document.documentElement)
createApp(MustardOptionsPage).mount('#app')
