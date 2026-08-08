import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages(プロジェクトページ配下)でも動くよう相対パスで出力する
  base: './',
  plugins: [preact()],
})
