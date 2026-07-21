import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "圣书 (Godspeed)",
  description: "Trading, Tech, and Life notes",
  base: '/',
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
          text: '日内交易基础课',
          items: [
            { text: '课程导读', link: '/trading/intraday-entry/' },
            { text: '1. 科学建仓', link: '/trading/intraday-entry/01-scientific-entry-framework' },
            { text: '2. 盘前地图与开盘环境', link: '/trading/intraday-entry/02-premarket-map-and-opening-regimes' },
            { text: '3. 突破回踩与失败突破', link: '/trading/intraday-entry/03-breakout-retest-and-failed-breakout' },
            { text: '4. 止损、风险与仓位', link: '/trading/intraday-entry/04-risk-stop-and-position-sizing' },
            { text: '5. 多周期过滤与辅助确认', link: '/trading/intraday-entry/05-multi-timeframe-and-confirmation' },
            { text: '6. ③、资金流与持仓管理', link: '/trading/intraday-entry/06-flow-and-position-management' }
          ]
        },
        {
          text: '专题研究',
          items: [
            { text: 'Heatmap 五层框架', link: '/trading/heatmap/five-layer' },
            { text: 'GEX 日内操作手册', link: '/trading/gex-intraday-guide' },
            { text: 'SPX 已验证规则终稿', link: '/trading/gex-spx-rules-data' }
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
            { text: '7. 内存安全与诊断', link: '/tech/cpp/memory-safety-debugging' },
            { text: '8. 多线程与同步原语', link: '/tech/cpp/multithreading-synchronization' },
            { text: '9. Atomic 与任务系统', link: '/tech/cpp/atomics-memory-order-task-system' },
            { text: '10. 网络、动画与物理概览', link: '/tech/cpp/game-runtime-systems-overview' }
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
