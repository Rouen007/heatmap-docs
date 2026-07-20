# Atomic、内存序与任务系统

原子操作解决的是单个共享状态的无数据竞争访问，任务系统解决的是工作如何被切分、调度、等待和取消。两者都建立在明确的数据依赖和生命周期之上。

---

## 一、`atomic` 保证什么

```cpp
std::atomic<int> counter = 0;
counter.fetch_add(1);
```

原子操作不会被其他线程观察到“只完成了一半”。多个线程对同一原子对象执行支持的操作，不会形成普通数据竞争。

但原子性只针对该原子对象，不会自动维护多个字段之间的不变量：

```cpp
std::atomic<int> x = 0;
std::atomic<int> y = 0;
```

即使 x 和 y 分别原子，其他线程仍可能观察到两者处于业务上不一致的组合。需要一起更新的复杂状态通常更适合 mutex，或需要专门设计的状态协议。

## 二、常见原子操作

```cpp
std::atomic<int> value = 0;

value.load();
value.store(10);
value.exchange(20);
value.fetch_add(1);
value.fetch_sub(1);
```

`exchange` 返回旧值并原子地写入新值。`fetch_add` 返回加法前的旧值。

## 三、Compare-and-swap

CAS 在当前值仍等于预期值时才写入新值：

```cpp
int expected = 10;
bool changed = value.compare_exchange_strong(expected, 20);
```

概念语义：

```text
如果 value == expected：
    value = desired
    返回 true
否则：
    expected = value 当前值
    返回 false
```

CAS 常用于状态转换：

```cpp
enum class State {
    Idle,
    Loading,
    Ready,
    Failed
};

std::atomic<State> state = State::Idle;

State expected = State::Idle;
if (state.compare_exchange_strong(expected, State::Loading)) {
    startLoading();
}
```

这样只有一个线程能成功把 Idle 改为 Loading。

### `weak` 与 `strong`

`compare_exchange_weak` 允许在值相等时发生虚假失败，因此通常放在重试循环中；某些架构上它可以更高效。

```cpp
int current = value.load();
while (!value.compare_exchange_weak(current, current + 1)) {
    // 失败时 current 已更新为最新值
}
```

`strong` 不允许这种虚假失败，适合不希望无原因重试的单次状态转换。

## 四、内存序解决什么

原子性回答“这次操作是否被撕裂”；内存序回答“这个原子操作与其他普通内存访问之间建立什么可见顺序”。

常见内存序：

| 内存序 | 作用概览 |
|---|---|
| `relaxed` | 只保证该原子对象操作原子，不建立跨变量发布关系 |
| `acquire` | 成功读取同步状态后，看到发布线程之前的写入 |
| `release` | 发布当前线程在此之前的写入 |
| `acq_rel` | 读改写操作同时承担 acquire 与 release |
| `seq_cst` | 提供最直观的全局顺序模型，也是默认值 |

## 五、`relaxed` 计数器

如果只要求计数本身不丢失，不用它发布其他数据：

```cpp
std::atomic<std::uint64_t> completedJobs = 0;

completedJobs.fetch_add(1, std::memory_order_relaxed);
```

适合统计、诊断和独立计数。它不能表达：看到计数变化后，其他普通数据一定已经可见。

## 六、Release/Acquire 发布数据

```cpp
int data = 0;
std::atomic<bool> ready = false;
```

生产者：

```cpp
data = 42;
ready.store(true, std::memory_order_release);
```

消费者：

```cpp
if (ready.load(std::memory_order_acquire)) {
    use(data); // 可以看到发布前写入的 42
}
```

成功观察到 release store 的 acquire load，与之前的普通写入建立 happens-before 关系：

```text
生产者写 data
    ↓
release store ready=true
    ↓ synchronize-with
acquire load 看到 true
    ↓
消费者读取 data
```

如果把双方都改成 relaxed，只能保证 ready 自身原子，不能用它可靠发布 data。

## 七、为什么默认先用 `seq_cst`

默认原子操作采用 `memory_order_seq_cst`，更接近所有线程共同观察到一个一致的原子操作顺序。

较弱内存序可以降低部分架构上的约束，但协议更难证明。除非：

- 已经确认同步是瓶颈；
- 能画出完整的发布与获取关系；
- 有并发测试和平台覆盖；
- 能说明每个原子操作为何使用该内存序；

否则优先 mutex 或默认原子顺序。错误的内存序代码可能在 x86 测试正常，却在更弱内存模型的平台暴露。

## 八、Lock-free 不等于 Wait-free

- Lock-free：系统整体持续取得进展，但单个线程可能长期重试；
- Wait-free：每个线程都能在有限步骤内完成操作；
- Obstruction-free：线程独占执行足够久时能完成。

“没有 mutex”也不等于更快。CAS 在高竞争下会反复失败：

```text
读取旧值
    ↓
其他线程先修改
    ↓
CAS 失败
    ↓
重新读取并重试
```

这会产生缓存行争用、重试和高尾延迟。低竞争下的简单 mutex 有时更高效、更容易维护。

## 九、ABA 问题

线程 A 读取状态 A，暂停；线程 B 把状态从 A 改成 B，再改回 A。线程 A 恢复后 CAS 只看到值仍是 A，误以为期间没有变化：

```text
线程 A：读取 A ───────────────┐
线程 B：A → B → A             │
线程 A：CAS 发现仍为 A，成功 ──┘
```

在无锁栈或 freelist 中，节点可能已被移除、释放并复用。常见缓解方法包括：

- 指针附带版本计数；
- Tagged Pointer；
- Hazard Pointer；
- Epoch-based Reclamation；
- 延迟回收；
- 使用经过验证的并发容器。

无锁数据结构最困难的部分往往不是 CAS，而是安全回收节点内存。

## 十、False Sharing

两个线程修改不同变量，如果变量位于同一缓存行，缓存一致性协议仍会让整条缓存行在核心之间反复转移：

```text
同一 Cache Line
┌──────────────────────────────────┐
│ Thread A counter │ Thread B counter │
└──────────────────────────────────┘
```

这就是 False Sharing。数据在逻辑上不共享，硬件缓存行却被共享写入。

缓解方式：

- 把高频写状态按线程分离；
- 每线程本地累计，再低频合并；
- 让热点字段落在不同缓存行；
- 避免多个线程持续写紧邻的全局计数器。

```cpp
struct alignas(std::hardware_destructive_interference_size) Counter {
    std::atomic<std::uint64_t> value = 0;
};
```

对齐值和实际收益应结合目标平台验证，不能盲目为所有对象填充缓存行。

---

## 十一、线程池为什么优于频繁创建线程

为每个小任务创建操作系统线程会产生创建、栈空间、调度和销毁成本。线程池预先创建固定工作线程：

```text
Task Queue
   ↓
Worker 0
Worker 1
Worker 2
Worker 3
```

提交任务只需要把工作描述放入队列，由已有线程执行。

线程数量通常围绕可用核心、主线程/渲染线程占用、任务阻塞特征和平台调度行为设计，而不是越多越好。

## 十二、任务粒度

任务太小：

- 入队与出队成本占比高；
- 原子和队列争用增加；
- 依赖管理成本超过计算；
- 指令与数据局部性变差。

任务太大：

- 核心负载不均；
- 最慢任务决定阶段结束时间；
- 依赖者等待时间长；
- 难以利用空闲核心。

可以通过批量大小、任务耗时分布和工作线程利用率调整粒度。

## 十三、共享队列与 Work Stealing

单一全局队列简单，但所有线程争用同一个同步点。

Work Stealing 通常让每个工作线程拥有本地双端队列：

```text
Worker A：优先从自己的队列取任务
Worker B：本地队列为空时，从 A 的另一端偷任务
```

本地操作减少竞争，偷取机制改善负载不均。但实现需要处理队列并发、任务所有权、内存回收和睡眠唤醒策略。

## 十四、Task Graph

任务不只是一组独立函数，还可以构成依赖图：

```text
Animation Sampling ─┐
                    ├→ Build Bone Matrices → Skinning
Physics Step ───────┘

Culling → Build Draw Commands → Render Submit
```

只有依赖完成后任务才进入可运行状态。相比整阶段 barrier，任务图可以让无关工作继续执行，减少所有线程等待最慢任务。

任务图需要明确：

- 前置依赖计数；
- 完成后唤醒哪些任务；
- 错误和取消如何传播；
- 谁拥有任务捕获的数据；
- 等待时工作线程是否帮助执行其他任务。

## 十五、等待时不要浪费工作线程

如果工作线程提交子任务后直接阻塞等待：

```text
所有 Worker 都在等待自己的子任务
    ↓
没有 Worker 可以执行子任务
    ↓
线程池死锁或饥饿
```

任务系统常采用“等待时帮助执行其他可运行任务”的策略，或使用 continuation，把后续工作表示为依赖完成后的新任务。

## 十六、游戏引擎线程模型

一种常见但非唯一的结构：

```text
Main/Game Thread
    ├── 输入、世界状态、玩法调度
    ├── 提交动画/物理/可见性任务
    └── 生成渲染数据

Worker Threads
    ├── 动画采样
    ├── 物理子任务
    ├── 可见性和资源处理
    └── 其他并行 Job

Render Thread
    ├── 消费渲染快照
    ├── 构建图形命令
    └── 提交给 GPU

GPU
    └── 执行更早提交的命令
```

实际引擎可能合并或拆分这些线程。核心是明确每份数据在哪个阶段可写、何时转为只读，以及哪一个 Fence 表示可以复用。

## 十七、CPU 完成、提交完成与 GPU 完成

三个时刻不能混为一谈：

```text
CPU 构建命令完成
    ↓
命令提交到图形 API
    ↓
GPU 稍后真正执行完成
```

CPU 提交结束不代表 GPU 已经不再读取 Buffer。资源销毁和帧分配器复用必须等待正确的 GPU Fence 或使用多缓冲。

### CPU 对象存活不代表 GPU 已经使用完毕

`shared_ptr<Texture>` 可以保证 C++ 包装对象在 CPU 代码使用期间不被析构，但图形命令提交通常是异步的：

```text
CPU 持有 shared_ptr 并提交 Draw
    ↓
CPU 释放最后一个 shared_ptr
    ↓
GPU 可能尚未执行 Draw
```

如果析构函数此时立即释放底层 GPU Texture，GPU 仍可能访问已经回收的资源。引擎通常把真正的图形资源销毁放入延迟队列，并记录提交时对应的 Fence；只有 Fence 表明相关 GPU 工作完成后，资源才进入可回收状态。

因此需要区分两个生命周期：

- CPU 生命周期：C++ 对象、任务和指针是否仍然有效；
- GPU 生命周期：之前提交的图形命令是否还可能访问底层资源。

引用计数可以参与第一层管理，却不能代替第二层的 GPU 完成信号。

## 十八、任务捕获与生命周期

危险代码：

```cpp
taskSystem.enqueue([this] {
    updateResource();
});
```

对象可能在任务执行前销毁。任务需要明确选择：

- 任务完成前所有者不能销毁；
- 捕获稳定 Handle，并在执行时验证；
- 使用 `weak_ptr` 取得临时所有权；
- 捕获任务需要的独立数据副本；
- 销毁时取消并等待任务；
- 把资源回收延迟到安全 Epoch 或 Fence。

## 十九、停止与退出协议

线程池关闭不能只设置一个布尔值。需要回答：

- 停止后是否接收新任务；
- 队列中已有任务是执行、取消还是丢弃；
- 正在运行的任务如何取消；
- 谁唤醒睡眠线程；
- 谁等待所有线程退出；
- 回调和完成事件是否仍会触发；
- 被任务引用的资源何时释放。

可靠顺序通常类似：

```text
停止接收新任务
    ↓
请求取消或排空队列
    ↓
唤醒所有工作线程
    ↓
等待线程退出
    ↓
释放队列和共享资源
```

## 二十、并发性能分析

关注：

- 工作线程利用率；
- Ready 但未运行的任务数量；
- 锁等待和 CAS 重试；
- 队列长度与任务耗时分布；
- False Sharing 与缓存抖动；
- 最慢任务形成的阶段尾部；
- 线程唤醒延迟；
- 主线程、渲染线程和 GPU 的互相等待。

不要只看总 CPU 使用率。高使用率可能来自自旋和争用，低使用率也可能是任务依赖或错误同步造成的空闲。

---

## 本章结论

1. atomic 保证单个对象操作的原子性，不自动维护多字段不变量。
2. Release/Acquire 用于发布普通数据，relaxed 只保证原子对象本身。
3. 内存序是可证明的同步协议，不应为了“更快”随意减弱。
4. Lock-free 不代表单线程必然有进展，也不代表比 mutex 快。
5. 无锁结构的核心难题通常是节点生命周期和安全回收。
6. False Sharing 是缓存行层面的共享写入竞争。
7. 任务系统需要平衡调度成本、负载均衡和数据局部性。
8. Task Graph 比全阶段 barrier 更能表达局部依赖。
9. CPU 工作完成、图形命令提交和 GPU 执行完成是不同时间点。
10. 停止、取消、等待和资源释放必须形成完整退出协议。

[← 上一章：多线程、数据竞争与同步原语](./multithreading-synchronization.md) · [返回学习地图](../cpp-engine-foundations.md)
