import { createApp } from 'vue'
import '@/styles/main.css'
import MustardPopupMenu from '@/ui/popup/MustardPopupMenu.vue'
import { initSurfaceFont } from '@/shared/fonts'
import { initSurfaceTheme } from '@/shared/themes'

initSurfaceFont(document, document.documentElement)
initSurfaceTheme(document.documentElement)
createApp(MustardPopupMenu).mount('#app')
