import DefaultTheme from 'vitepress/theme'
import type { EnhanceAppContext } from 'vitepress'

import ExpressMagicMove from './components/ExpressMagicMove.vue'
import ApiTable from './components/ApiTable.vue'
import LivePlayground from './components/LivePlayground.vue'

import './style.css'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }: EnhanceAppContext) {
    app.component('ExpressMagicMove', ExpressMagicMove)
    app.component('ApiTable', ApiTable)
    app.component('LivePlayground', LivePlayground)
  }
}
