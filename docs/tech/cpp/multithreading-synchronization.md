# 多线程、数据竞争与同步原语

多线程的目标不是“线程越多越快”，而是把能够并行的工作安全地分配到多个执行上下文，同时保持数据依赖、生命周期和退出顺序正确。

---

## 一、进程与线程

进程通常拥有独立的虚拟地址空间和系统资源；同一进程中的线程共享代码、堆、全局数据与大部分进程资源，但每个线程拥有自己的栈和寄存器状态。

```text
Process
├── Shared：代码、Heap、全局数据、文件与系统资源
├── Thread A：寄存器 + Stack A
├── Thread B：寄存器 + Stack B
└── Thread C：寄存器 + Stack C
```

共享地址空间让线程间交换数据很方便，也意味着错误同步可以直接破坏整个进程。

## 二、并发、并行与上下文切换

- 并发：多个任务在时间上交错推进；
- 并行：多个任务在不同 CPU 核心上同时执行。

线程多于可用核心时，操作系统需要进行上下文切换：保存当前线程寄存器和调度状态，再恢复另一个线程。切换本身、缓存扰动和调度延迟都会产生成本。

因此把一个小任务拆成过多线程，可能比单线程更慢。

## 三、线程生命周期

```cpp
std::thread worker([] {
    doWork();
});

worker.join();
```

`join()` 等待线程结束。`detach()` 让线程脱离当前对象独立运行，但会显著增加对象生命周期、错误报告和进程退出管理的难度，通常不应作为默认选择。

C++20 的 `std::jthread` 在析构时自动请求停止并 join：

```cpp
std::jthread worker([](std::stop_token token) {
    while (!token.stop_requested()) {
        processOneBatch();
    }
});
```

停止令牌是协作式取消：任务必须在合适位置主动检查并收敛状态。

## 四、什么是数据竞争

如果两个线程并发访问同一内存位置：

- 至少一个访问是写；
- 访问不是受支持的原子操作；
- 两者之间没有建立正确同步；

就会发生 Data Race。C++ 中的数据竞争属于未定义行为。

```cpp
int counter = 0;

// 线程 A
++counter;

// 线程 B
++counter;
```

`++counter` 不是不可分割的单一步骤，可以概念性地拆为：

```text
读取 counter
加一
写回 counter
```

两个线程可能都读取旧值 0，最后都写回 1，丢失一次更新。编译器还会基于“程序不存在数据竞争”的语言前提进行优化，因此实际结果不只是不准确计数，还可能出现更难预测的行为。

## 五、可见性与 happens-before

```cpp
int data = 0;
bool ready = false;
```

线程 A：

```cpp
data = 42;
ready = true;
```

线程 B：

```cpp
if (ready) {
    use(data);
}
```

没有同步时，线程 B 不能依赖看到 `ready == true` 就一定看到 `data == 42`。编译器、CPU 和缓存系统都可能改变普通内存操作对其他线程可见的顺序。

同步原语的核心作用是建立 happens-before 关系，让一个线程在同步点之前的写入，对另一个线程在对应同步点之后的读取可见。

`volatile` 主要用于特定硬件和可观察访问语义，不提供普通 C++ 线程间同步，也不能替代 mutex 或 atomic。

## 六、Mutex：保护共享不变量

```cpp
class ScoreBoard {
public:
    void addScore(int value)
    {
        std::lock_guard lock(mutex_);
        score_ += value;
    }

    int score() const
    {
        std::lock_guard lock(mutex_);
        return score_;
    }

private:
    mutable std::mutex mutex_;
    int score_ = 0;
};
```

mutex 不只是保护一个变量，更重要的是保护一组必须保持一致的不变量。例如队列的 head、tail 和 size 应在同一个协议下更新。

### RAII 加锁

```cpp
{
    std::lock_guard lock(mutex);
    updateSharedState();
} // 自动解锁
```

不要手写容易遗漏的：

```cpp
mutex.lock();
doWork();
mutex.unlock();
```

提前返回或异常会跳过 `unlock()`。`lock_guard`、`unique_lock` 和 `scoped_lock` 把锁生命周期绑定到作用域。

## 七、临界区应该多大

锁范围过大：

- 并行度下降；
- 等待时间增加；
- 长操作阻塞其他线程；
- 容易把 I/O、回调或 GPU 操作放进锁内。

锁范围过小：

- 同一不变量被拆成多个不安全步骤；
- 加锁次数增加；
- 代码难以推断；
- 可能暴露中间状态。

常见做法是先在锁外准备独立数据，再在短临界区内提交状态：

```cpp
Result result = performExpensiveWork();

{
    std::lock_guard lock(mutex_);
    results_.push_back(std::move(result));
}
```

不要在持锁期间调用无法控制的外部回调，因为回调可能再次获取同一把锁或等待其他资源。

## 八、锁住容器不等于保护对象生命周期

下面的资源管理器看起来已经为查找和删除都加了锁：

```cpp
class TextureManager {
public:
    Texture* find(int id)
    {
        std::lock_guard lock(mutex_);
        auto it = textures_.find(id);
        return it == textures_.end() ? nullptr : it->second.get();
    }

    void remove(int id)
    {
        std::lock_guard lock(mutex_);
        textures_.erase(id);
    }

private:
    std::mutex mutex_;
    std::unordered_map<int, std::unique_ptr<Texture>> textures_;
};
```

mutex 确实保护了容器内部结构，但 `find()` 返回的裸指针在解锁后逃出了临界区：

```text
渲染线程                         资源线程

find()
  加锁并取得 Texture*
  解锁
                                 remove()
                                   erase 并销毁 Texture
继续使用 Texture*  ← 悬空指针
```

这里的根因不是“裸指针必然错误”，而是一个不拥有对象的引用离开了临界区，并且没有其他协议保证对象继续存活。如果资源保证存活到程序结束、只在固定安全阶段销毁，或者外层已有稳定所有者，裸指针仍然可以安全使用。

### 用 `shared_ptr` 延长 CPU 对象生命周期

一种直接做法是在锁内复制 `shared_ptr`：

```cpp
std::shared_ptr<Texture> find(int id)
{
    std::lock_guard lock(mutex_);
    auto it = textures_.find(id);
    return it == textures_.end() ? nullptr : it->second;
}
```

调用方持有返回值期间，即使管理器从容器中删除资源，`Texture` 对象也不会立即析构。两种机制解决不同问题：

- mutex 保护容器查找、插入和删除的一致性；
- `shared_ptr` 保护对象离开容器后的 CPU 生命周期。

这不意味着资源管理器必须普遍使用 `shared_ptr`。共享所有权会让最终销毁位置和时间更难控制，热点路径上的引用计数也可能带来额外同步成本。

### Handle 仍然需要回收协议

带代数的 Handle 可以在解析时识别已经失效或被复用的槽位：

```cpp
struct TextureHandle {
    std::uint32_t index;
    std::uint32_t generation;
};
```

但 Handle 本身通常不拥有资源。代码如果先把 Handle 解析成裸指针，再允许另一个线程立刻销毁资源，仍可能发生 use-after-free。因此集中资源管理还需要配合一种明确机制：

- 解析后取得临时强引用或 pin；
- 销毁前等待所有使用者离开安全区；
- 按帧或 Epoch 延迟回收；
- 只在拥有资源的固定线程销毁；
- GPU 资源等待对应 Fence 后再释放。

锁、所有权和 Handle 分别回答不同问题：能否并发修改、谁保证对象存活、如何稳定标识并验证资源。不能只加入其中一层，就假设另外两层自动成立。

## 九、死锁

线程 A：

```text
持有 Lock A
等待 Lock B
```

线程 B：

```text
持有 Lock B
等待 Lock A
```

双方永久等待形成死锁。

经典四个必要条件是：

1. 互斥使用资源；
2. 持有一个资源时继续等待其他资源；
3. 资源不能被外部强制抢占；
4. 存在循环等待。

破坏任意一个条件都可以避免死锁。

### 固定加锁顺序

所有代码统一先锁 A，再锁 B：

```text
Lock A → Lock B → Lock C
```

### 同时获取多把锁

```cpp
std::scoped_lock lock(mutexA, mutexB);
```

标准库会使用避免简单锁序死锁的策略获取多把锁。

### 不持锁等待跨系统操作

线程等待 I/O、任务、Fence 或另一个线程时，应检查是否仍持有对方完成工作所需的锁。

## 十、`unique_lock`

`lock_guard` 简单轻量；`unique_lock` 支持延迟加锁、提前解锁、转移锁所有权，并且是条件变量等待所需的锁类型。

```cpp
std::unique_lock lock(mutex_, std::defer_lock);
prepare();
lock.lock();
commit();
lock.unlock();
```

灵活性也增加了状态复杂度，因此不需要时优先 `lock_guard`。

## 十一、读写锁 `shared_mutex`

读多写少的数据可以允许多个读者并发访问：

```cpp
std::shared_mutex mutex_;

Value read(Key key)
{
    std::shared_lock lock(mutex_);
    return table_.at(key);
}

void write(Key key, Value value)
{
    std::unique_lock lock(mutex_);
    table_.insert_or_assign(key, std::move(value));
}
```

`shared_mutex` 不一定比普通 mutex 快。它的内部状态更复杂，读锁也有同步成本，还可能出现读者或写者饥饿。临界区很短、竞争不高时，普通 mutex 往往更简单。

选择应基于读写比例、临界区长度和实际采样。

## 十二、条件变量

条件变量用于等待“某个受 mutex 保护的条件成立”，而不是用来保存事件本身。

```cpp
std::unique_lock lock(mutex_);
condition_.wait(lock, [this] {
    return stopped_ || !queue_.empty();
});
```

等待过程会原子性地：

1. 释放 mutex；
2. 阻塞当前线程；
3. 被通知后重新获取 mutex；
4. 检查谓词。

### 为什么必须有谓词

条件变量允许虚假唤醒；通知也可能发生在等待之前。真正的状态是 `stopped_` 和 `queue_`，通知只提示等待者重新检查状态。

错误思维：

```text
notify = 永久保存的一次事件
```

正确思维：

```text
共享状态由 mutex 保护
notify 促使等待线程重新检查状态
```

## 十三、有关闭语义的阻塞队列

```cpp
template <typename T>
class BlockingQueue {
public:
    bool push(T value)
    {
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

    std::optional<T> pop()
    {
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

    void stop()
    {
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

这里最重要的是完整协议：停止后拒绝新任务、唤醒所有消费者、消费者在队列排空后退出。

## 十四、Semaphore

信号量维护可用许可数量：

```text
初始许可 = 3

acquire → 2
acquire → 1
release → 2
```

适合：

- 限制并发 I/O 数量；
- 管理固定数量资源；
- 生产者与消费者计数；
- 控制同时运行的昂贵任务。

C++20 示例：

```cpp
std::counting_semaphore<8> slots(4);

slots.acquire();
performLimitedWork();
slots.release();
```

mutex 主要表达独占临界区，semaphore 主要表达数量许可。信号量本身不自动保护复杂共享不变量。

## 十五、Latch 与 Barrier

`latch` 是一次性倒计时同步点：多个任务完成后，等待者继续执行。

`barrier` 可以重复使用：一组线程都到达某一阶段后，再共同进入下一阶段。

```text
Phase 1：所有工作线程完成动画采样
    ↓ barrier
Phase 2：开始骨骼矩阵计算
```

如果任务之间只有局部依赖，完整 barrier 可能让快速线程等待最慢线程。任务图通常能表达更细粒度依赖。

## 十六、线程安全不等于可扩展

给所有操作加一把全局锁，可以获得正确性，却可能把系统重新串行化：

```text
8 个工作线程
    ↓
争用同一 Global Mutex
    ↓
实际一次只能有 1 个线程工作
```

优化前先区分：

- 正确性问题：是否有数据竞争、死锁、遗漏唤醒；
- 可扩展性问题：锁竞争、缓存抖动、负载不均；
- 任务粒度问题：调度成本是否超过工作量。

---

## 本章结论

1. 同一进程的线程共享地址空间，但各自拥有栈和寄存器状态。
2. 数据竞争是未定义行为，不只是“少算一次”。
3. mutex 应保护共享不变量，锁生命周期应使用 RAII。
4. 死锁常来自不一致锁序和持锁等待跨系统操作。
5. `shared_mutex` 适用于经测量确实读多写少的场景，不是默认优化。
6. 条件变量必须围绕受 mutex 保护的谓词使用。
7. semaphore 表达有限许可，不自动维护复杂状态一致性。
8. 线程安全只保证正确性，不保证系统能够随核心数扩展。
9. 锁住资源容器不等于保护逃逸指针的生命周期；锁、所有权和 Handle 解决的是不同问题。

[← 上一章：内存安全、OOM 与诊断](./memory-safety-debugging.md) · [下一章：Atomic、内存序与任务系统 →](./atomics-memory-order-task-system.md)
