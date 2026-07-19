import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "神速 (Godspeed)",
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
            { text: '期权基础入门', link: '/trading/options-basic' },
            { text: 'Heatmap 五层框架', link: '/trading/heatmap/five-layer' }
          ]
        }
      ],
      '/tech/': [
        {
          text: '技术笔记',
          items: [
            { text: '技术主页', link: '/tech/' }
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
