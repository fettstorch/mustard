import { createApp } from 'vue'
import '@/styles/main.css'
import MustardPopupMenu from '@/ui/popup/MustardPopupMenu.vue'
import { initSurfaceFont } from '@/shared/fonts'

initSurfaceFont(document, document.documentElement)
createApp(MustardPopupMenu).mount('#app')
