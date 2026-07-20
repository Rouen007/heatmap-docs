# 内存安全、OOM 与诊断方法

内存泄漏、越界、Use After Free 和 OOM 最后都可能表现为随机崩溃或内存增长，但根因并不相同。

| 问题 | 本质 |
|---|---|
| Memory Leak | 资源仍存在，但程序失去正确释放路径 |
| Out of Bounds | 访问对象有效范围之外 |
| Use After Free | 对象生命周期结束后继续访问旧地址 |
| Double Free | 同一资源被释放两次 |
| Invalid Free | 释放了不应释放或不是分配起点的地址 |
| Uninitialized Read | 读取尚未建立有效值的内存 |
| OOM | 当前内存申请无法得到满足 |
| Stack Overflow | 当前线程的栈空间耗尽 |

---

## 一、Memory Leak

```cpp
void createPlayer()
{
    Player* player = new Player();
} // 指针消失，但 Player 没有释放
```

```text
player 变量：生命周期结束
Heap 中的 Player：仍然存在，但释放路径丢失
```

持续泄漏会让内存随时间增长，最终可能触发 OOM。泄漏是原因，OOM 是可能的结果，两者不是同一概念。

`shared_ptr` 引用环也会产生逻辑泄漏：

```cpp
struct Node {
    std::shared_ptr<Node> next;
};
```

两个 Node 相互持有时，外部所有者离开后强引用计数仍无法归零。

## 二、Out of Bounds 与 Buffer Overflow

```cpp
int values[4] = {1, 2, 3, 4};
values[4] = 100; // 合法索引只有 0..3
```

越界写可能破坏相邻变量、对象成员、指针、vptr、分配器元数据或返回信息。

`vector::operator[]` 不检查边界：

```cpp
std::vector<int> values = {1, 2, 3};
int value = values[10]; // 未定义行为
```

需要检查时可以使用 `at()`，或在进入性能关键循环前集中验证范围。

Buffer Overflow 是越界写的常见形式：

```cpp
char destination[8];
std::memcpy(destination, source, 32); // 写出目标范围
```

复制长度必须同时受源数据长度和目标容量约束，字符串还要考虑终止字符。

## 三、Use After Free

```cpp
Player* player = new Player();
delete player;
player->update(); // Use After Free
```

删除后指针仍保存旧地址，但对象已经不存在。地址不为空不代表对象仍处于生命周期中。

设置为空只能保护当前变量，不能处理别名：

```cpp
Player* a = new Player();
Player* b = a;

delete a;
a = nullptr;
b->update(); // b 仍然悬空
```

根本解决方法是明确所有权和借用边界。

### 容器与视图产生的悬空引用

```cpp
Entity* player = &entities[0];
entities.push_back(Entity{}); // 可能扩容
player->update();             // 可能悬空
```

`std::span` 和 `std::string_view` 都不拥有数据：

```cpp
std::string_view view = text;
text += veryLongText; // text 可能重新分配
use(view);            // view 可能悬空
```

借用视图不会延长底层对象生命周期。

### 返回局部对象地址

```cpp
Player* createPlayer()
{
    Player player;
    return &player; // 返回时 player 已析构
}
```

应该按值返回：

```cpp
Player createPlayer()
{
    Player player;
    return player;
}
```

编译器通常可以使用返回值优化或移动语义。

### 异步任务捕获失效 `this`

```cpp
void Scene::loadAsync()
{
    taskSystem.enqueue([this] {
        loadResources();
    });
}
```

如果 Scene 在任务执行前销毁，后台任务会访问失效 `this`。需要使用等待、取消令牌、稳定 Handle、`weak_ptr`、独立任务上下文或 Job Fence 明确任务生命周期。

## 四、Double Free 与 Invalid Free

```cpp
Player* player = new Player();
delete player;
delete player; // Double Free
```

第二次释放可能破坏分配器空闲结构，问题也可能在后续分配时才暴露。

Invalid Free 包括：

```cpp
int value = 10;
delete &value; // 释放栈地址
```

```cpp
int* values = new int[10];
delete[] (values + 2); // 不是原始分配起点
```

```cpp
int* values = new int[10];
delete values; // 应使用 delete[]
```

分配与释放必须匹配：

| 分配方式 | 释放方式 |
|---|---|
| `new T` | `delete` |
| `new T[]` | `delete[]` |
| `malloc/calloc/realloc` | `free` |
| 平台资源创建 API | 对应平台销毁 API |
| 自定义分配器 | 由同一分配器释放 |

RAII 和唯一所有权用于让正确释放路径固化在类型中。

## 五、Uninitialized Read

```cpp
int value;
std::cout << value;
```

读取未初始化的基本类型会得到不确定状态，并可能触发未定义行为。应建立明确初始值：

```cpp
int value = 0;
```

结构体填充字节也可能未初始化，因此不应默认用 `memcmp` 比较整个对象原始内存，或直接把内存布局当作稳定序列化格式。

## 六、OOM 的来源

OOM 表示当前申请无法满足，不一定是“物理内存完全为零”。可能原因包括：

- 进程达到内存预算；
- 加载峰值过高；
- 泄漏长期积累；
- 地址空间耗尽；
- 内存碎片；
- GPU 或专用资源堆耗尽；
- 单次申请过大；
- 系统内存压力策略。

`new` 分配失败通常抛出 `std::bad_alloc`，`malloc` 通常返回 `nullptr`。移动平台还可能在应用处理失败前，由系统直接终止进程。

### 峰值比稳定值更危险

```text
旧资源仍存在：500 MB
新资源加载中：500 MB
临时解压缓冲：200 MB
────────────────────
瞬时峰值：1200 MB
```

最终稳定状态可能只有 500 MB，但加载过程已经超过预算。还要统计容器扩容的新旧内存重叠、CPU/GPU 双份资源、格式转换临时数据和延迟销毁队列。

## 七、为什么崩溃位置不一定是根因

假设堆布局：

```text
[Buffer A][Allocator Metadata][Object B]
```

Buffer A 在 Frame 100 越界，破坏分配器元数据。程序可能继续运行，到 Frame 120 正常释放 Object B 时，分配器才读取损坏数据并崩溃。

```text
Frame 100：真正错误写入
Frame 105：程序继续运行
Frame 120：free/delete 检测到损坏并崩溃
```

崩溃调用栈可能只显示 `free`、`delete` 或 Object B 析构，但 Object B 并非根因。

> 崩溃位置往往是损坏被检测的位置，不一定是最初写坏内存的位置。

## 八、Use After Free 为什么可能暂时正常

释放后，旧数据不一定立即被覆盖：

```text
释放前：[Player 数据]
释放后：[旧字节暂时残留]
```

旧指针第一次访问可能看似正常。稍后同一地址被分配给 AudioCommand，旧 Player 指针写入时实际破坏的是音频对象，最终可能在另一个线程中崩溃。

这类错误具有明显的时间延迟和跨系统表现。

## 九、vptr 与并发破坏

具有虚函数的对象通常含 vptr。越界写覆盖 vptr 后，下一次虚调用可能跳到垃圾地址，表现为非法指令或随机函数跳转。

没有同步的容器并发访问也可能表现为内存损坏：

```text
线程 A：vector.push_back，触发扩容并释放旧内存
线程 B：仍读取旧元素地址
```

表面像 Use After Free，根因却是数据竞争。

## 十、检测工具

### AddressSanitizer

适合检测 Heap/Stack Buffer Overflow、Use After Free、Double Free、Use After Scope 和部分 Invalid Free。

```text
-fsanitize=address
```

### UndefinedBehaviorSanitizer

用于发现部分未定义行为，如错误对齐、非法移位、部分整数溢出和无效转换。

```text
-fsanitize=undefined
```

### LeakSanitizer 与平台工具

可以结合 LeakSanitizer、Xcode Instruments、Android Studio Memory Profiler、堆快照、分配调用栈和 GPU 资源跟踪工具。

工具最终要帮助回答：

```text
谁分配的？
分配了多少？
谁还持有？
什么时候应该释放？
```

## 十一、调试分配器技术

### 填充特殊字节

在新分配、已释放和 Guard 区域写入不同模式，帮助识别未初始化或已释放内存。具体字节值因工具而异。

### Canary

```text
[Canary][User Buffer][Canary]
```

检查 Canary 是否被修改，可以发现缓冲区前后越界。

### Guard Page

```text
[有效页面][不可访问 Guard Page]
```

越界进入 Guard Page 时立即触发错误，使崩溃更接近真正写坏的位置。

### Quarantine

释放后暂时不复用内存，让旧指针更容易被检测，而不是立即破坏新对象。

## 十二、预防原则

### 所有权

- 默认值语义；
- 动态对象优先 `unique_ptr`；
- 只有共享生命周期才使用 `shared_ptr`；
- 借用不负责释放；
- 跨系统资源使用 Manager + Handle。

### 边界和视图

- 使用 `vector`、`array`、`span`、`string`、`string_view` 表达范围；
- 记住 `span` 和 `string_view` 不拥有数据；
- 外部输入必须运行时校验，不能只依赖 Debug Assert；
- 在热循环前集中验证边界。

### 异步生命周期

每个任务都需要明确所有者、完成条件、取消语义和捕获数据的有效期。

### 尽早暴露

- 在测试版本启用 Sanitizer；
- 使用调试分配器和 Guard；
- 覆盖扩容、删除、取消和并发时序；
- 不让错误静默传播到其他系统。

## 十三、排查流程

1. 保留第一现场和崩溃地址。
2. 判断地址属于栈、堆、模块、资源池还是已释放区域。
3. 检查对象生命周期、所有权和所有别名。
4. 检查附近容器是否扩容、删除或并发修改。
5. 检查索引、复制长度和外部输入。
6. 使用 AddressSanitizer、Canary 或 Guard Page 让错误提前暴露。
7. 检查崩溃地址是否曾被其他类型复用。
8. 检查异步任务、回调和跨线程销毁。
9. 同时观察增长趋势、稳定值、峰值和碎片。
10. 修复后增加能够覆盖原始错误时序的回归测试。

---

## 本章结论

1. 泄漏是失去释放路径，OOM 是申请无法满足。
2. 越界访问破坏对象有效范围之外的数据。
3. Use After Free 是对象生命周期结束后仍通过旧地址访问。
4. Double Free 和 Invalid Free 会破坏分配器状态。
5. 地址不为空不代表对象仍然存在。
6. `span`、`string_view`、裸指针和引用不会延长底层生命周期。
7. 内存损坏可能在很久之后、另一个系统中才被检测。
8. 异步任务和无同步容器访问是常见高风险来源。
9. RAII、Handle、边界检查、Sanitizer 和调试分配器应组合使用。
10. 排查重点是找到最早的错误写入，而不只是最后的崩溃位置。

[← 上一章：栈、堆、虚拟内存与 Page Fault](./memory-stack-heap-virtual.md) · [下一章：多线程与同步原语 →](./multithreading-synchronization.md)
