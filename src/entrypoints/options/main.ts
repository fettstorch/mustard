import { createApp } from 'vue'
import '@/styles/main.css'
import MustardOptionsPage from '@/ui/options/MustardOptionsPage.vue'
import { initSurfaceFont } from '@/shared/fonts'
import { initSurfaceTheme } from '@/shared/themes'

initSurfaceFont(document, document.documentElement)
initSurfaceTheme(document.documentElement)
createApp(MustardOptionsPage).mount('#app')
