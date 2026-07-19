import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "圣书 (Godspeed)",
  description: "Trading, Tech, and Life notes",
  themeConfig: {
    logo: '/assets/logo.webp',
    nav: [
      { text: '首页', link: '/' },
      { text: '交易 📈', link: '/trading/' },
      { text: '技术 💻', link: '/tech/' },
      { text: '生活 ☕', link: '/life/' },
      { text: '关于我 👤', link: '/about' }
    ],
    
    sidebar: {
      '/trading/': [
        {
          text: '导读',
          items: [
            { text: '交易主页', link: '/trading/' }
          ]
        },
        {
          text: '专题研究',
          items: [
            { text: 'Heatmap 五层框架', link: '/trading/heatmap/five-layer' },
            { text: 'GEX 日内操作手册', link: '/trading/gex-intraday-guide' }
          ]
        }
      ],
      '/tech/': [
        {
          text: '导读',
          items: [
            { text: '技术主页', link: '/tech/' }
          ]
        },
        {
          text: 'C++ 学习地图',
          items: [
            { text: '现代 C++ 与游戏引擎基础', link: '/tech/cpp-engine-foundations' }
          ]
        },
        {
          text: 'C++ 基础篇章',
          items: [
            { text: '1. 生命周期、RAII 与所有权', link: '/tech/cpp/lifetime-raii-ownership' },
            { text: '2. 复制、移动与 noexcept', link: '/tech/cpp/copy-move-noexcept' },
            { text: '3. 对象模型与多态', link: '/tech/cpp/object-model-polymorphism' },
            { text: '4. vector、list 与迭代器', link: '/tech/cpp/containers-vector-list' },
            { text: '5. map 与 unordered_map', link: '/tech/cpp/map-unordered-map' },
            { text: '6. 栈、堆与虚拟内存', link: '/tech/cpp/memory-stack-heap-virtual' },
            { text: '7. 内存安全与诊断', link: '/tech/cpp/memory-safety-debugging' }
          ]
        }
      ],
      '/life/': [
        {
          text: '随笔',
          items: [
            { text: '生活主页', link: '/life/' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Rouen007/rouen-docs-site' }
    ]
  }
})
