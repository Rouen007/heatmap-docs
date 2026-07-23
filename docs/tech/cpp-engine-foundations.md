# 现代 C++ 与游戏引擎基础：学习地图

游戏引擎是一个长期运行、持续分配资源、并在严格时间预算内完成工作的系统。现代 C++ 提供了足够接近硬件的控制能力，也把对象生命周期、内存布局和线程同步的责任交给了开发者。

理解引擎中的 C++，可以围绕三个问题展开：

1. **谁拥有资源，资源活多久？**
2. **数据如何存放，处理它需要付出多少成本？**
3. **工作在哪个线程发生，线程之间如何建立正确的顺序？**

这三个问题分别对应生命周期、数据布局和并发模型，也是大多数稳定性与性能问题的根源。

## 已整理的专题篇章

1. [对象生命周期、RAII 与所有权](./cpp/lifetime-raii-ownership.md)
   - 对象生命周期与资源
   - `unique_ptr`、`shared_ptr`、`weak_ptr`
   - 控制块与 `make_shared` 的一次分配
   - 资源管理器、Handle 与 generation
2. [复制、移动、Rule of Five 与 `noexcept`](./cpp/copy-move-noexcept.md)
   - Rule of Three、Five 和 Zero
   - 复制构造、移动构造与 moved-from 状态
   - `vector` 扩容的异常保证
   - `std::move_if_noexcept` 与实时系统成本
3. [对象模型、虚函数与多态](./cpp/object-model-polymorphism.md)
   - 对象布局、对齐与 `this`
   - vptr、vtable 与虚调用
   - 虚析构、对象切片与构造期间的虚调用
   - 虚函数在引擎边界和热路径中的取舍
4. [`vector`、`list` 与迭代器失效](./cpp/containers-vector-list.md)
   - `size`、`capacity`、`reserve` 与 `resize`
   - 扩容、插入和删除的失效规则
   - 连续内存、CPU Cache 与节点式容器
   - swap-and-pop、erase-remove 与容量复用
5. [`map`、`unordered_map` 与 rehash](./cpp/map-unordered-map.md)
   - 平衡树、哈希、Bucket 与冲突
   - Load Factor、rehash 和迭代器失效
   - 查询与插入接口的隐藏行为
   - Flat Hash Map、字符串键与引擎选择
6. [栈、堆、虚拟内存与 Page Fault](./cpp/memory-stack-heap-virtual.md)
   - 线程栈、动态分配与堆分配器
   - 虚拟地址、Page、页表与 TLB
   - Demand Paging、Copy-on-Write 与 Page Fault
   - 内外碎片、专用分配器和移动端约束
7. [内存安全、OOM 与诊断方法](./cpp/memory-safety-debugging.md)
   - 泄漏、越界、Use After Free 与 Double Free
   - OOM、峰值内存和延迟崩溃
   - 异步生命周期与并发内存破坏
   - Sanitizer、Guard Page 与系统化排查
8. [多线程、数据竞争与同步原语](./cpp/multithreading-synchronization.md)
   - 进程、线程、上下文切换与数据竞争
   - mutex、死锁、读写锁与条件变量
   - semaphore、latch、barrier 与阻塞队列
   - 锁粒度、正确性和并发可扩展性
9. [Atomic、内存序与任务系统](./cpp/atomics-memory-order-task-system.md)
   - CAS、Release/Acquire 与 `seq_cst`
   - Lock-free、ABA 与 False Sharing
   - 线程池、Work Stealing 与 Task Graph
   - 引擎线程模型、GPU Fence 与退出协议
10. [网络、动画与物理概览](./cpp/game-runtime-systems-overview.md)
   - TCP/UDP、状态同步、预测、校正与插值
   - Tick、固定时间步与 Render Snapshot
   - 动画状态机、混合、IK 与蒙皮
   - Broad Phase、Narrow Phase、Solver 与穿透
11. [图形渲染管线与性能基础](./cpp/rendering-pipeline-and-performance.md)
   - Render Snapshot、RenderPacket、RenderQueue 与 Command Buffer
   - RenderGraph、资源依赖、Descriptor 与 GPU 资源生命周期
   - Graphics Pipeline、纹理、阴影与后处理
   - CPU/GPU 瓶颈、移动端带宽与 Overdraw
12. [引擎运行时与渲染系统速览](./cpp/engine-runtime-quick-reference.md)
   - 数据所有权、线程边界与资源生命周期
   - 游戏线程、任务系统、渲染线程与 GPU 数据流
   - Render Snapshot、RenderPacket、RenderGraph 与 Fence
   - 性能定位和常用数据结构

## 后续专题路线

下面的主题将继续按独立篇章整理：

13. 编译、链接、ABI、构建系统与 Python 工具链；
14. Lua 虚拟机、Table、GC 与 C++ 绑定。

本页保留为知识总览。专题篇章按学习顺序展开，并记录讨论中补充的细节。

---

## 一、对象生命周期与资源所有权

### 1. RAII：把资源生命周期绑定到对象生命周期

RAII（Resource Acquisition Is Initialization）的核心不是“使用智能指针”，而是：**资源在对象构造时进入有效状态，在对象析构时确定性释放。**

资源不只包括内存，还包括：

- 文件句柄与网络连接
- 互斥锁
- GPU Buffer、Texture 和 Pipeline
- 音频设备与系统对象
- 临时映射的内存区域

```cpp
class File final {
public:
    explicit File(const char* path)
        : handle_(std::fopen(path, "rb")) {
        if (!handle_) {
            throw std::runtime_error("failed to open file");
        }
    }

    ~File() {
        std::fclose(handle_);
    }

    File(const File&) = delete;
    File& operator=(const File&) = delete;

private:
    std::FILE* handle_{};
};
```

当控制流因为提前返回或异常离开作用域时，析构函数仍会执行。资源释放因此不再依赖调用者记得执行某段清理代码。

### 2. 优先表达所有权，而不是只传递地址

裸指针只表示一个地址，本身不能说明对象是否可空、由谁释放、能够存活多久。接口应该尽量表达所有权语义：

| 表达方式 | 通常表示 |
|---|---|
| `T&` | 必须存在的借用，不转移所有权 |
| `const T&` | 只读借用 |
| `T*` | 可空借用，或与外部系统交互的非拥有地址 |
| `std::unique_ptr<T>` | 唯一所有权，可以移动，不能复制 |
| `std::shared_ptr<T>` | 共享所有权，最后一个拥有者释放资源 |
| `std::weak_ptr<T>` | 观察共享对象，但不延长其生命周期 |

`shared_ptr` 不是默认答案。它需要维护控制块和引用计数；引用计数的更新通常是原子的，但这并不意味着它指向的对象自动具备线程安全。共享所有权还容易掩盖系统边界，甚至形成引用环。

#### `shared_ptr` 的控制块和“一次分配”

一次内存分配，指的是向堆分配器申请一块内存，不等于这块内存中只能放一个 C++ 对象。程序可以申请一块较大的内存，再在其中分别构造多个内部对象。

`shared_ptr` 除了目标对象，还需要一个控制块。控制块通常保存：

- 强引用计数：还有多少个 `shared_ptr` 拥有目标对象；
- 弱引用计数：还有多少个 `weak_ptr` 观察控制块；
- 删除器和分配器等信息。

下面的写法通常需要两次独立的堆分配：

```cpp
std::shared_ptr<Texture> texture(new Texture());
```

可以从概念上理解为：

```text
第一次分配                     第二次分配
┌──────────────┐              ┌─────────────────────┐
│   Texture    │              │ Control Block       │
│ 目标对象本身  │              │ strong / weak / ... │
└──────────────┘              └─────────────────────┘
        ▲                              ▲
        └──────── shared_ptr ──────────┘
```

而 `make_shared` 通常一次申请一块足够大的内存，再在其中同时构造控制块和 `Texture`：

```cpp
auto texture = std::make_shared<Texture>();
```

```text
一次堆分配得到的整块内存
┌─────────────────────┬──────────────┐
│ Control Block       │   Texture    │
│ strong / weak / ... │  目标对象本身 │
└─────────────────────┴──────────────┘
          ▲                  ▲
          └──── shared_ptr ──┘
```

这里的图只表达“共同存放在一次分配得到的内存中”，具体先后顺序、间距和布局由标准库实现决定，并不是 C++ 标准规定的固定内存布局。

减少一次分配通常意味着更少的分配器开销和更好的局部性。但它也带来一个细节：强引用归零时 `Texture` 会立即析构；如果仍有 `weak_ptr`，控制块必须继续存在，而和它一起分配的整块内存也可能暂时不能归还给分配器。也就是说，**对象已经析构**和**承载对象的内存已经释放**并不总是同一时刻。

更稳定的设计通常是：

- 默认使用值语义；
- 需要动态生命周期时优先使用 `unique_ptr`；
- 只有真正存在多个独立拥有者时才使用 `shared_ptr`；
- 用 `weak_ptr` 或非拥有句柄断开所有权环。

### 3. Rule of Zero 与移动语义

如果成员本身能够正确管理资源，类就不需要手写析构、拷贝或移动操作，这就是 Rule of Zero。

当类直接持有系统资源时，需要明确决定：

- 能否复制；
- 复制是深复制还是共享；
- 能否移动；
- 移动后原对象保持什么有效状态。

### 4. 移动为什么不是“永远零成本”

`std::move` 本身并不移动任何数据。它只是把表达式转换成右值，使编译器可以选择移动构造或移动赋值；真正的资源转移发生在类型的移动函数里。

以一个持有堆内存的对象为例，复制通常需要重新分配内存并复制全部内容；移动通常只需要转移指针、长度等少量状态，再把源对象置于可析构的状态：

```cpp
class Buffer {
public:
    explicit Buffer(std::size_t size)
        : data_(std::make_unique<std::byte[]>(size)), size_(size) {}

    Buffer(Buffer&& other) noexcept
        : data_(std::move(other.data_)),
          size_(std::exchange(other.size_, 0)) {}

private:
    std::unique_ptr<std::byte[]> data_;
    std::size_t size_ = 0;
};
```

这里没有复制 Buffer 的底层字节，但仍然需要：

- 读取并写入目标对象的成员；
- 修改源对象；
- 销毁目标对象原先持有的资源（移动赋值时）；
- 维护分配器、引用计数或系统句柄可能附带的状态。

因此，移动通常比深复制便宜，但不是抽象意义上的零成本。某些类型的“移动”甚至仍可能执行分配或退化为接近复制的工作。

移动后的源对象仍然必须**有效且可析构**，但其具体值通常未指定。除非类型的接口明确承诺，否则对 moved-from 对象最稳妥的操作是销毁它，或重新赋予一个新值。

### 5. 为什么 `noexcept` 会影响 `vector` 扩容

假设一个 `vector<T>` 已经存有三个元素，现在容量不足，需要扩容。容器不能在原地扩大一块已经分配的内存，只能先申请新区域，再逐个构造新区域中的元素：

```text
旧内存：[A][B][C]
             │ 复制或移动
             ▼
新内存：[A'][B'][C'][空余空间……]
```

标准容器通常希望提供**强异常保证**：如果扩容过程中出现异常，操作失败，但原来的 `vector` 仍保持扩容前的内容。

使用复制时，这个保证比较容易做到：

1. 在新内存中复制 A、B、C；
2. 如果复制 B 时抛出异常，销毁已经复制成功的 A'；
3. 释放新内存；
4. 旧内存中的 A、B、C 从未被修改，容器可以原样继续使用。

使用**可能抛异常的移动构造**时，回滚会困难得多：

1. A 成功移动到新内存，旧 A 已进入 moved-from 状态；
2. B 成功移动，旧 B 也被修改；
3. 移动 C 时抛出异常；
4. 新内存可以清理，但旧内存中的 A 和 B 已经不是原值；
5. 容器无法用一种通用方法把它们恢复到移动前的状态。

所以，当类型同时满足以下条件时：

- 移动构造**可能抛异常**；
- 复制构造可用；

标准库实现通常会选择复制旧元素，以便在失败时保留原容器。这种选择可以用 `std::move_if_noexcept` 的规则理解：

```cpp
// 概念上的选择逻辑，不是 vector 的实际源码
if constexpr (std::is_nothrow_move_constructible_v<T> ||
              !std::is_copy_constructible_v<T>) {
    construct_in_new_storage(std::move(old_element));
} else {
    construct_in_new_storage(old_element); // copy
}
```

其决策可以归纳为：

| 类型能力 | 扩容时的典型选择 | 原因 |
|---|---|---|
| 移动为 `noexcept` | 移动 | 更便宜，并且不会在中途抛出 |
| 移动可能抛出，复制可用 | 复制 | 便于维持强异常保证 |
| 移动可能抛出，复制不可用 | 只能尝试移动 | 元素可以放进容器，但异常保证可能减弱 |

这就是一个类型明明定义了移动构造，`vector` 扩容时却仍可能调用复制构造的原因。

### 6. 如何正确声明 `noexcept`

只有当移动函数确实不会抛出异常时，才应该承诺 `noexcept`：

```cpp
class TextureHandle {
public:
    TextureHandle(TextureHandle&&) noexcept = default;
    TextureHandle& operator=(TextureHandle&&) noexcept = default;

private:
    std::unique_ptr<Resource> resource_;
    std::uint32_t id_ = 0;
};

static_assert(std::is_nothrow_move_constructible_v<TextureHandle>);
```

对于默认生成的移动函数，编译器会根据成员和基类的移动能力推导异常说明。显式写出 `noexcept` 可以表达设计意图，但前提是所有相关操作都确实不会抛出。

如果一个声明为 `noexcept` 的函数仍然抛出异常，异常不能传播给调用者，程序会调用 `std::terminate`。因此不能为了让容器使用移动而虚假标记 `noexcept`；正确做法是重新检查移动实现，避免其中发生分配、复制或其他可能失败的工作。

在性能敏感的容器元素类型中，可以用下面这组检查建立清晰约束：

```cpp
static_assert(std::is_move_constructible_v<T>);
static_assert(std::is_nothrow_move_constructible_v<T>);
```

最终需要记住的不是“移动一定快”，而是：

> 移动是否便宜，由类型实现决定；容器是否敢移动，还取决于移动操作能否提供可靠的异常边界。

---

## 二、C++ 对象模型与多态

### 1. 虚函数调用的常见实现

C++ 标准规定的是行为，不强制具体 ABI。主流编译器通常为含虚函数的对象保存一个虚表指针，虚表中记录可调用函数地址。通过基类指针调用虚函数时，程序会间接查表并跳转到最终实现。

这种机制带来几项成本：

- 对象通常多一个虚表指针；
- 调用需要一次间接寻址；
- 动态目标可能降低内联机会；
- 大量异构对象遍历时，数据与指令缓存都可能变差。

这些成本并不意味着应该排斥虚函数。关键是区分：

- **低频、边界清晰的系统接口**：运行时多态通常简单可靠；
- **每帧处理数十万对象的热路径**：连续数据、批处理或数据导向设计往往更合适。

### 2. 基类析构函数为什么常常需要是虚函数

如果对象会通过基类指针删除，基类析构函数必须是虚函数：

```cpp
class Component {
public:
    virtual ~Component() = default;
    virtual void update(float dt) = 0;
};
```

否则通过 `Component*` 删除派生对象会产生未定义行为，派生类拥有的资源可能无法正确释放。

并不是所有基类都需要虚析构。如果类型明确禁止多态删除，可以把析构函数设为受保护的非虚函数，使错误用法在编译期暴露。

### 3. 对象切片

把派生对象按值赋给基类对象时，派生部分会被截掉：

```cpp
Derived derived;
Base base = derived; // 只复制 Base 子对象
```

需要保留动态类型时，应通过引用、指针或显式的多态值封装传递，而不是按基类值传递。

---

## 三、容器、迭代器与缓存局部性

### 1. `vector` 扩容到底发生了什么

`std::vector` 使用连续内存。当 `size()` 达到 `capacity()` 后继续插入元素，通常会发生：

1. 申请一块更大的连续内存；
2. 将旧元素移动或复制到新区域；
3. 构造新元素；
4. 销毁旧元素并释放旧内存。

增长因子是具体实现的策略，不应依赖某个固定倍数。扩容会使旧内存中的迭代器、引用和指针失效，还可能同时持有新旧两块内存，形成瞬时内存峰值。

在实时系统中，平均复杂度为 `O(1)` 不代表每次操作都稳定。一次 `O(n)` 的扩容如果发生在关键帧，仍可能形成明显卡顿。

常见策略包括：

- 已知上限时提前 `reserve()`；
- 不跨越可能扩容的操作保存元素地址；
- 使用稳定的 ID 或带代数的 Handle，而不是长期保存裸指针；
- 对固定上限的小集合使用栈内或定容容器；
- 对高频临时数据使用帧分配器或预分配缓冲区。

### 2. 根据访问模式选择容器

| 容器 | 优势 | 主要代价 | 常见场景 |
|---|---|---|---|
| `vector` | 连续、遍历快、额外开销小 | 中间插入和扩容可能搬迁 | 高频遍历、批处理数据 |
| `deque` | 两端插入稳定，不要求整块连续内存 | 分段存储，局部性弱于 vector | 双端队列、工作队列 |
| `list` | 节点位置稳定，已知位置时删除方便 | 每节点分配，缓存局部性差 | 仅在确有稳定节点需求时使用 |
| `map` | 有序，最坏 `O(log n)` | 节点开销与指针跳转 | 有序查询、范围操作 |
| `unordered_map` | 平均 `O(1)` 查询 | rehash、桶开销、最坏情况退化 | 无序键值索引 |

复杂度只是选择容器的一部分。对于现代 CPU，连续内存带来的缓存命中和预取优势，经常比理论上的少数操作更重要。

### 3. AoS 与 SoA

传统对象数组（Array of Structures）把一个对象的所有字段放在一起：

```cpp
struct Particle {
    Vec3 position;
    Vec3 velocity;
    Color color;
    float lifetime;
};

std::vector<Particle> particles;
```

如果更新阶段只读取位置、速度和生命周期，颜色数据也会被一起加载进缓存。结构数组（Structure of Arrays）把相同字段连续存放：

```cpp
struct Particles {
    std::vector<Vec3> positions;
    std::vector<Vec3> velocities;
    std::vector<Color> colors;
    std::vector<float> lifetimes;
};
```

SoA 更适合批处理、SIMD 和 GPU 上传；AoS 更适合频繁访问单个对象的全部字段。实际系统也可以采用分块 AoSoA，在局部性、维护成本和向量化之间折中。

---

## 四、内存系统：从虚拟内存到分配器

### 1. 虚拟内存不是“磁盘上的备用内存”

每个进程看到的是虚拟地址空间。操作系统通过页表把虚拟页映射到物理页，并用权限位控制读、写和执行。

访问一个尚未建立有效映射的页面会触发 page fault。它可能只是按需分配一个新物理页，也可能需要从存储设备读取数据；两者成本差异很大。页表转换本身通常由 TLB 缓存，随机访问大量页面可能增加 TLB miss。

因此，内存性能不只取决于“分配了多少字节”，也取决于：

- 实际触碰了多少页面；
- 访问是否连续；
- 工作集能否留在缓存与物理内存中；
- 页面是否被频繁换入换出。

### 2. 泄漏、越界、悬空访问与内存耗尽

这些问题表现可能相似，但根因不同：

- **内存泄漏**：失去对已分配资源的有效释放路径；
- **越界访问**：读取或写入对象有效范围之外；
- **Use After Free**：对象已结束生命周期，代码仍通过旧地址访问；
- **Double Free**：同一资源被重复释放；
- **OOM**：当前申请无法得到满足，可能来自泄漏、峰值过高或系统预算过小。

“崩溃发生在释放处”不代表释放函数是根因。堆元数据可能早已被其他越界写破坏，直到后续分配或释放才被检测出来。

### 3. 碎片与专用分配器

通用堆分配器需要服务不同大小、不同生命周期的对象。大量交错分配与释放可能造成：

- 外部碎片：空闲空间总量足够，却缺少需要的连续块；
- 内部碎片：分配块因对齐或大小类别而大于实际需求；
- 多线程竞争：多个线程争用分配器内部状态；
- 不稳定延迟：慢路径在不可预测的时刻发生。

引擎中常见的专用策略：

- **Arena/Linear Allocator**：顺序分配，整体重置，适合一帧或一次加载过程；
- **Pool Allocator**：固定大小对象复用，适合粒子、组件和命令节点；
- **Stack Allocator**：按后进先出释放，适合作用域嵌套的临时数据；
- **Slab/Size Class**：按大小类别管理对象，降低碎片并提高复用率。

专用分配器的价值不仅是“更快”，更重要的是让内存预算、生命周期和延迟变得可预测。

---

## 五、并发：正确性先于并行度

### 1. 数据竞争与 happens-before

两个线程并发访问同一内存位置，其中至少一个是写操作，并且它们之间没有适当同步，就会产生数据竞争。C++ 中的数据竞争属于未定义行为。

线程安全的关键不是“操作在时间上看起来没有撞到”，而是通过同步建立 happens-before 关系，使写入结果按语言内存模型对其他线程可见。

常见同步工具：

- `mutex`：保护一组必须保持一致的不变量；
- `shared_mutex`：读多写少且临界区足够大时允许并发读；
- `condition_variable`：等待某个受锁保护的条件成立；
- `semaphore`：表达有限数量的可用许可；
- `atomic`：对单个原子状态进行无数据竞争访问。

### 2. 条件变量必须和谓词一起使用

条件变量可能发生虚假唤醒。等待者必须在持锁状态下重新检查条件：

```cpp
std::unique_lock lock(mutex_);
condition_.wait(lock, [this] {
    return stopped_ || !queue_.empty();
});
```

通知不是状态本身。真正的状态是 `stopped_` 和 `queue_`，它们由同一把锁保护。这样即使通知早于等待发生，等待者也不会永久错过事件。

### 3. 一个有关闭语义的阻塞队列

```cpp
template <typename T>
class BlockingQueue {
public:
    bool push(T value) {
        {
            std::lock_guard lock(mutex_);
            if (stopped_) {
                return false;
            }
            queue_.push_back(std::move(value));
        }
        condition_.notify_one();
        return true;
    }

    std::optional<T> pop() {
        std::unique_lock lock(mutex_);
        condition_.wait(lock, [this] {
            return stopped_ || !queue_.empty();
        });

        if (queue_.empty()) {
            return std::nullopt;
        }

        T value = std::move(queue_.front());
        queue_.pop_front();
        return value;
    }

    void stop() {
        {
            std::lock_guard lock(mutex_);
            stopped_ = true;
        }
        condition_.notify_all();
    }

private:
    std::mutex mutex_;
    std::condition_variable condition_;
    std::deque<T> queue_;
    bool stopped_ = false;
};
```

这个例子最重要的不是队列本身，而是完整的生命周期协议：停止后拒绝新任务，唤醒所有消费者，消费者在队列排空后退出。

### 4. `atomic` 与内存序

`atomic` 保证特定对象的原子访问，但不能自动维护多个字段之间的不变量。

- `memory_order_relaxed`：只保证原子性，适合不承担发布关系的计数器；
- release/acquire：发布线程之前的写入，对成功获取同一状态的线程可见；
- `memory_order_seq_cst`：提供最直观的全局顺序，也是默认选项。

除非已经证明同步成本是瓶颈，并且能严格说明状态发布协议，否则优先使用锁或默认内存序。错误的无锁代码通常比一次互斥锁竞争更昂贵。

### 5. False Sharing

两个线程即使修改不同变量，只要变量落在同一缓存行中，缓存一致性协议仍可能让该缓存行在核心之间反复转移。这就是 false sharing。

常见缓解方式：

- 把高频写入的线程局部状态分开存放；
- 使用 `alignas(std::hardware_destructive_interference_size)` 做适当填充；
- 先在线程局部累计，再低频合并；
- 避免多个工作线程持续写入紧邻的全局计数器。

---

## 六、实时系统中的性能思维

### 1. 平均值无法描述卡顿

60 FPS 的单帧预算约为 16.67 ms。平均帧时间达标，并不代表体验稳定：如果少量帧达到 50 ms，用户仍会感受到明显卡顿。

应同时观察：

- 中位数和平均帧时间；
- P95、P99 等长尾分位数；
- 最坏帧及其发生场景；
- CPU 与 GPU 各阶段耗时；
- 内存峰值和分配频率；
- 温度上升后的持续性能。

### 2. 先建立证据链，再优化

可靠的性能工作可以按以下顺序进行：

1. 明确指标和目标设备；
2. 使用可复现的场景采样；
3. 判断瓶颈位于 CPU、GPU、I/O、同步还是内存；
4. 找到占主导成本的具体阶段；
5. 提出可证伪的优化假设；
6. 修改后使用同一场景对比；
7. 检查画质、稳定性、功耗和内存回归。

没有前后对照数据的“优化”，很容易只是把成本从一个线程、阶段或设备转移到了另一个地方。

### 3. 常见的帧时间尖峰来源

- 容器扩容或大块内存分配；
- 同步加载与同步 Shader/Pipeline 创建；
- 锁竞争或等待工作线程；
- 主线程集中处理大量对象创建和销毁；
- GPU readback 或 CPU/GPU 强制同步；
- 日志、文件系统和网络操作进入关键路径；
- 垃圾式批量清理在单帧发生。

优化目标往往不是让平均工作量最小，而是让每帧工作量更可预测。分帧、预热、预算化处理和异步化都是控制长尾的重要手段。

---

## 七、把基础知识映射到引擎系统

### 1. 资源系统

一个资源通常经历：

```text
Unloaded → Loading → Ready → Failed
               ↓
            Cancelled
```

资源系统需要明确：

- 谁持有 CPU 数据和 GPU 对象；
- 异步任务结束时目标对象是否仍存在；
- 资源替换或卸载后，旧句柄如何失效；
- 后台线程能做什么，哪些操作必须回到渲染线程；
- 失败、取消和设备丢失如何收敛状态。

常见做法是用 `index + generation` 组成 Handle。索引定位槽位，generation 用于识别槽位被释放后重新使用的情况，从而避免旧句柄错误访问新对象。

#### 为什么集中资源管理比到处传递 `shared_ptr` 更容易控制

假设场景中有一张球场草地纹理，同时被材质、UI 预览和异步加载任务使用。如果三个系统都保存 `shared_ptr<Texture>`，所有权会分散到各处：

```text
MaterialSystem ──shared_ptr──┐
UISystem       ──shared_ptr──┼──→ Texture
AsyncTask      ──shared_ptr──┘
```

这种结构能够保证 Texture 在最后一个所有者离开前不被销毁，但资源管理器很难精确控制销毁时机。即使场景已经退出，只要某个异步任务忘记释放 `shared_ptr`，纹理就会继续占用 CPU 内存和 GPU 内存。要定位“谁还持有它”，也需要追踪散落在各系统中的所有者。

集中资源管理采用不同的责任划分：

```text
TextureManager ──唯一拥有──→ Texture Storage
       ▲
       │ 查询 Handle
       │
Material / UI / Entity / Task
```

只有 `TextureManager` 负责创建和销毁纹理。其他系统不拥有 Texture，只保存一个轻量 Handle：

```cpp
struct TextureHandle {
    std::uint32_t index;
    std::uint32_t generation;
};
```

资源管理器内部可以维护槽位数组：

```text
slot 0: generation=2, Texture A
slot 1: generation=7, 空
slot 2: generation=4, Texture B
```

如果 `Texture B` 位于 `slot 2`，发给外部系统的句柄是：

```text
TextureHandle { index=2, generation=4 }
```

访问资源时不能直接把 Handle 当成指针，而是交回管理器查询：

```cpp
Texture* texture = textureManager.get(handle);
```

管理器的检查逻辑可以简化为：

```cpp
Texture* TextureManager::get(TextureHandle handle) {
    if (handle.index >= slots_.size()) {
        return nullptr;
    }

    Slot& slot = slots_[handle.index];
    if (slot.generation != handle.generation || !slot.texture) {
        return nullptr;
    }

    return slot.texture.get();
}
```

当 `Texture B` 被卸载时：

```text
slot 2: generation=4, Texture B
             ↓ 销毁并递增 generation
slot 2: generation=5, 空
```

外部遗留的 `{index=2, generation=4}` 再来查询时，generation 不匹配，因此会被识别为失效句柄。以后即使 `slot 2` 被复用来存放 Texture C，旧句柄也不会错误指向新资源：

```text
旧句柄：{index=2, generation=4} → 失效
新句柄：{index=2, generation=5} → Texture C
```

集中管理的主要价值是让一个系统统一负责：

- 资源去重和缓存；
- 加载、取消、卸载和热重载；
- CPU/GPU 内存预算；
- 失效检测和占位资源；
- 设备丢失后的重建；
- 统计哪些资源长期没有使用。

Handle 也不是没有代价。每次访问多一次查表和有效性检查；异步任务和渲染线程使用资源时，管理器仍需通过 Fence、帧延迟销毁或临时 pin 等机制，保证资源不会在执行途中消失。

因此两者不是绝对替代关系：

- 生命周期天然由少数业务对象共同决定时，`shared_ptr` 简单直接；
- 资源数量大、需要预算、流式加载和统一卸载时，资源管理器加 Handle 通常更可控。

### 2. 任务系统

任务系统不仅是线程池，还需要描述依赖关系和完成语义：

- 任务粒度过小，调度成本会超过并行收益；
- 粒度过大，核心之间负载不均；
- 工作窃取可以改善动态负载；
- 等待依赖时应尽量帮助执行其他任务，而不是阻塞工作线程；
- 任务捕获的对象必须活到任务完成或取消。

任务图中的“完成”还要区分 CPU 工作完成、命令提交完成和 GPU 真正执行完成，这三者通常不是同一时刻。

### 3. 帧内存与跨帧对象

一帧内产生的大量临时命令、可见性结果和排序键，可以放入线性分配器，在帧结束后整体重置。这样既减少通用堆压力，也让释放成本接近常数。

但任何可能跨帧使用的数据都不能直接引用这块内存。异步渲染、延迟提交和后台任务会扩大实际生命周期，必须通过多缓冲、Fence 或显式所有权保证安全。

### 4. 移动端约束

移动设备上的性能是 CPU、GPU、内存带宽、功耗和散热共同决定的。短时间跑满不代表可以持续稳定运行。

因此需要关注：

- 低端设备的内存预算与峰值；
- 统一内存架构下 CPU/GPU 对带宽的竞争；
- 温控降频后的持续帧率；
- 后台切换和系统回收资源后的恢复路径；
- 不同图形 API、驱动和芯片上的行为差异；
- 分档画质、动态分辨率和降级策略。

---

## 八、一套统一的分析框架

遇到 C++ 或引擎问题时，可以依次检查五层：

| 层次 | 核心问题 |
|---|---|
| 生命周期 | 谁拥有它？何时创建、取消和销毁？ |
| 正确性 | 是否存在越界、失效引用、数据竞争或错误状态转换？ |
| 成本 | 时间复杂度、空间成本、分配次数和同步成本是什么？ |
| 硬件 | 数据是否连续？是否产生 cache miss、带宽压力或 CPU/GPU 等待？ |
| 系统 | 这个选择如何影响帧时间、峰值内存、可维护性和跨平台行为？ |

这个框架把语言规则和系统实践连接起来。理解一个机制，不只要知道“它是什么”，还要知道它如何实现、成本何时出现、失效方式是什么，以及它进入实时系统后会影响哪条关键路径。

---

## 延伸阅读路线

1. C++ 对象生命周期、值类别与移动语义；
2. 标准容器的失效规则和异常安全；
3. 操作系统的虚拟内存、线程与同步原语；
4. C++ 内存模型与 happens-before；
5. CPU Cache、SIMD 与数据导向设计；
6. 资源系统、任务图和渲染帧流水线；
7. 以真实采样数据驱动的性能分析。

这些主题不是彼此独立的知识点。一次容器扩容可能同时涉及移动语义、地址失效、堆分配、缓存局部性和帧时间尖峰；一次异步加载问题也可能同时涉及资源所有权、任务取消、线程可见性与 GPU 生命周期。把它们放在同一张系统地图中理解，才真正形成可复用的工程能力。
