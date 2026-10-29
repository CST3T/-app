import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 产出可独立运行的 server.js，用于打包「双击即用」演示包
  output: 'standalone',
  reactStrictMode: true,
  eslint: {
    // 演示工程：构建阶段不因 lint 失败而中断（CI 单独跑 lint）
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
