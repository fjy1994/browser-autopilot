import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  base: './',  // 关键：使用相对路径，适配 Chrome 扩展
  build: {
    outDir: 'extension/dashboard',  // 直接输出到 Chrome 扩展目录
    emptyOutDir: true,                // 每次先清空旧文件
  },
});
