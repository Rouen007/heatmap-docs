# 引擎运行时与渲染系统速览

本篇用于快速回顾引擎中最重要的关系：数据由谁拥有、在哪个线程修改、何时能够读取、何时可以复用或销毁。

## 一、整体数据流

```text
输入 / 网络
    ↓
Game Thread 更新世界
    ↓
Physics / Animation Jobs
    ↓
Render Snapshot
    ↓
Culling → RenderPacket → RenderQueue
    ↓
RenderGraph → Command Buffer
    ↓
GPU Pipeline
```

资源管理器、任务系统和内存系统为这条主线提供基础能力。

## 二、数据和所有权

```text
GameObject：完整的游戏逻辑对象
Component：可独立管理的数据
System：处理一类组件或任务
Render Snapshot：某个时间点的稳定渲染输入
RenderPacket：从游戏对象提取的渲染数据
Handle：指向集中管理资源的可验证引用
```

判断一个设计时，优先问：

```text
谁拥有它？
谁可以修改它？
谁只读借用它？
它什么时候失效？
```

## 三、线程边界

常见职责划分：

```text
Game Thread：输入、逻辑、世界状态
Worker Threads：动画、物理、裁剪、资源处理
Render Thread：渲染数据整理和命令录制
GPU：异步执行图形命令
```

线程之间尽量通过稳定的数据快照、任务依赖或消息队列通信，减少多个线程直接修改同一对象。

如果两个线程共享可变数据：

```text
简单独立状态 → atomic
多个字段组成的不变量 → mutex
等待条件 → mutex + condition_variable
任务依赖 → task graph
```

## 四、渲染链路

```text
GameObject
    ↓ 提取渲染字段
RenderPacket
    ↓ 分类和排序
RenderQueue
    ↓ Pass 和资源依赖
RenderGraph
    ↓ 录制命令
Command Buffer
    ↓
GPU
```

`RenderPacket` 不是完整的游戏对象，也不是 RenderQueue；它是一个对象或一批对象的绘制描述，通常保存 Mesh、Material、Pipeline、Transform 和排序信息。

## 五、RenderGraph 的作用

RenderGraph 用图描述 Pass 对资源的读写：

```text
Shadow Pass → Opaque Pass → Post Process → UI Pass
```

它可以根据依赖关系统一管理：

- Pass 顺序；
- Barrier 和资源状态转换；
- 临时资源生命周期；
- 不重叠资源的显存复用；
- 无依赖 Pass 的并行机会。

RenderGraph 描述渲染过程，Scene Graph 描述场景对象和空间层级，两者不是同一个系统。

## 六、资源生命周期

```text
请求资源
    ↓
Loading
    ↓
CPU 数据准备
    ↓
GPU 上传
    ↓
Ready
    ↓
Handle 失效
    ↓
等待使用者和 GPU 完成
    ↓
物理释放
```

不同机制负责不同边界：

```text
unique_ptr：唯一 CPU 所有权
shared_ptr：共享 CPU 生命周期
weak_ptr：观察，不延长生命周期
Handle + generation：验证逻辑引用
mutex：保护 CPU 共享状态
Fence：确认 GPU 使用完成
```

锁住资源容器，不代表返回的裸指针在锁外仍然有效；CPU 对象存活，也不代表 GPU 已经不再使用底层资源。

## 七、GPU 渲染重点

Graphics Pipeline 可以简化为：

```text
Vertex Shader
    ↓
Rasterization
    ↓
Fragment Shader
    ↓
Depth / Blend
    ↓
Frame Buffer
```

常见渲染资源：

```text
Buffer：顶点、索引、常量、实例和骨骼数据
Texture：颜色、深度、阴影和中间结果
Descriptor：告诉 Shader 如何找到资源
Material：提供纹理和材质参数
Shader：定义计算方式
```

移动端重点关注：

- 外部内存带宽；
- 纹理压缩和 MipMap；
- Shader 采样次数；
- 透明物体和 Overdraw；
- 阴影和后处理；
- Render Target 的读写次数；
- 功耗和发热。

## 八、性能定位

先区分三类瓶颈：

```text
CPU-bound：命令、Draw、排序、裁剪、状态切换或任务调度
GPU-bound：Shader、像素、阴影、后处理、带宽或 Overdraw
Synchronization-bound：锁、Fence、资源、线程或任务等待
```

优化顺序通常是：

```text
采样和时间线确认瓶颈
    ↓
减少不可见工作
    ↓
减少重复绘制和状态切换
    ↓
改善数据布局与缓存
    ↓
针对 Shader、像素和带宽优化
```

## 九、常用数据结构

```text
vector：默认顺序容器，连续内存，注意扩容失效
unordered_map：平均 O(1)，注意 rehash 和 operator[] 插入
queue：任务队列、BFS
priority_queue：优先级调度、Top K
双指针：连续区间
二分：有单调性的答案范围
哈希：快速查找、去重和映射
```

## 十、最小知识主线

```text
对象是否活着？
    → 生命周期与所有权

数据是否被正确共享？
    → mutex、atomic、任务依赖

渲染数据是否稳定？
    → Snapshot、Packet、Queue

GPU 是否按正确顺序访问？
    → Barrier、RenderGraph

资源是否可以复用？
    → Fence、延迟销毁

帧为什么变慢？
    → CPU、GPU、内存带宽或同步分析
```

[← 上一章：图形渲染管线与性能基础](./rendering-pipeline-and-performance.md) · [返回学习地图](../cpp-engine-foundations.md)
